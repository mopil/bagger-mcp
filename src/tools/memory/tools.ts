import type { ServiceRegistry } from "../../mcp/services.js";
import { defineServiceTool } from "../defineTool.js";
import {
  decisionLogAmendInputSchema,
  decisionLogAppendInputSchema,
  memoryCaptureInputSchema,
  memoryListInputSchema,
  memoryReadInputSchema,
  memorySearchInputSchema,
} from "./schema.js";

const tool = defineServiceTool<ServiceRegistry>();

const INBOX_PREFIX = "sources/_inbox/";
// Decision log is partitioned by month: wiki/logs/decisions/YYYY-MM.md.
// The month is derived from the entry date (KST), and a fresh partition is
// auto-created on the first append of a new month. Schema/field docs live in
// wiki/logs/decisions/decisions-index.md.
const DECISION_LOG_DIR = "wiki/logs/decisions";
const DECISION_LOG_MARKER = "<!-- DECISION_LOG_INSERT_AFTER -->";

function decisionLogPath(date: string): string {
  // date is YYYY-MM-DD → partition file YYYY-MM.md
  return `${DECISION_LOG_DIR}/${date.slice(0, 7)}.md`;
}

// Minimal lean template for a freshly-rolled monthly partition. Mirrors the
// shape the desktop /ingest skill produces; schema docs are NOT duplicated here
// (they live in decisions-index.md) to keep each partition light.
function decisionLogMonthTemplate(date: string): string {
  const ym = date.slice(0, 7);
  const created = `${ym}-01`;
  return `---
type: journal
created: ${created}
updated: ${date}
tags: [journal, decision-log, audit]
month: ${ym}
status: active
---

# Decision Log — ${ym}

스키마·필드 정의·집행지표는 [[decisions-index]]. 이 파일은 **${ym} 결정 entry**만 담는 월별 파티션. 최신이 위로. \`decision_log_append\` 도구가 아래 마커 다음 줄에 append (수동 추가도 허용).

## Entries

${DECISION_LOG_MARKER}

---

## 집계 (사후 작성)

- 총 entry: - / 마감 포지션(id): -
- 결과: win - / loss - / flat - / tbd -
- 진입 게이트 통과율: - (gate 평균 통과 수 ÷ 3)
- 손절 집행률: - (exit=stop 중 executed=planned 비율)
- EV per trade: - (마감 포지션 pnl 평균)
- 가장 자주 호출된 원칙: -
- 가장 자주 위반된 원칙: -
- 메모:

(매월 말 또는 lessons ingest 시 [[principles-reverse-index]] 재집계 + [[rule-calibration-protocol]] 4가드 검토)
`;
}

interface DecisionLogFields {
  id?: string | null;
  ticker?: string | null;
  action: string;
  size?: string | null;
  trigger?: string | null;
  gate?: string[] | null;
  stop?: string | null;
  target?: string | null;
  exitReason?: string | null;
  executed?: string | null;
  pnl?: string | null;
  result?: string | null;
  principles?: string[] | null;
  memo?: string | null;
  reviewType?: string | null;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function nowDateTimeKst(): { date: string; time: string } {
  // Server TZ is unknown; compute KST (UTC+9) explicitly so US-market trades
  // logged in KST evening/night don't land on the wrong UTC date.
  const iso = new Date(Date.now() + KST_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

// Collapse whitespace/newlines so a freeform value can't break the one-line entry.
function cleanField(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildReviewLine(args: DecisionLogFields, dateTime: string): string {
  const fields: string[] = [];
  if (args.reviewType) fields.push(`type=${args.reviewType}`);
  if (args.principles && args.principles.length > 0) {
    fields.push(`principles=[${args.principles.join(",")}]`);
  }
  if (args.memo) fields.push(`memo=${JSON.stringify(cleanField(args.memo))}`);

  const id = args.id ? ` [${cleanField(args.id)}]` : "";
  const ticker = args.ticker ? ` ${cleanField(args.ticker)}` : "";
  return `- ${dateTime}${id} review${ticker} | ${fields.join(" | ")}`;
}

// review는 memo, 매매 라인은 ticker가 반드시 있어야 한다. 누락 시 명확한 에러.
function assertRequiredFields(args: DecisionLogFields): void {
  if (args.action === "review") {
    if (!args.memo) throw new Error("review(회고) 라인은 memo가 필수입니다.");
  } else if (!args.ticker) {
    throw new Error(`${args.action} 라인은 ticker가 필수입니다.`);
  }
}

// 기존 라인 맨 앞 "- YYYY-MM-DD HH:MM" 타임스탬프를 추출 (amend 시 원본 시각 보존용).
function extractTimestamp(line: string): string | null {
  const m = line.match(/^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\b/);
  return m ? m[1] : null;
}

// 액션별로 채워졌어야 할 핵심 필드가 비어 있으면 경고를 모은다.
// 차단(throw) 대신 응답에 실어, 모델이 정정 라인 땜질 대신 처음부터 보강하도록 유도한다.
function decisionWarnings(args: DecisionLogFields): string[] {
  const warnings: string[] = [];
  if (args.action === "review") return warnings;

  if (!args.id) {
    warnings.push(
      "id가 없습니다 — 포지션의 enter→exit를 묶어 EV·승률을 집계하려면 id 필수. enter에서 부여하고(예: TSLA-1) 같은 포지션에서 재사용하세요.",
    );
  }
  if (args.action === "enter" || args.action === "addbuy") {
    if (!args.stop) {
      warnings.push("진입 라인에 stop(손절선)이 없습니다 — 손절 계획이 정말 없다면 무시, 아니면 stop을 넣으세요.");
    }
  } else if (args.action === "trim" || args.action === "exit") {
    if (!args.pnl) {
      warnings.push("청산 라인에 pnl(실현 손익)이 없습니다 — 정정 라인 만들지 말고 지금 pnl을 채워 다시 호출하세요.");
    }
    if (!args.result || args.result === "tbd") {
      warnings.push("청산 라인인데 result가 tbd입니다 — win/loss/flat 중 하나로 설정하세요.");
    }
    if (args.action === "exit" && !args.exitReason) {
      warnings.push("exit 라인에 exitReason이 없습니다 — stop/target/time/thesis/discretionary 중 하나를 넣어야 손절 집행률을 잴 수 있습니다.");
    }
  }
  return warnings;
}

function buildDecisionLine(args: DecisionLogFields, dateTime: string): string {
  if (args.action === "review") return buildReviewLine(args, dateTime);

  const fields: string[] = [];
  if (args.trigger) fields.push(`trigger=${args.trigger}`);
  if (args.gate && args.gate.length > 0) fields.push(`gate=${args.gate.join("+")}`);
  if (args.stop) fields.push(`stop=${cleanField(args.stop)}`);
  if (args.target) fields.push(`target=${cleanField(args.target)}`);
  if (args.exitReason) fields.push(`exit=${args.exitReason}`);
  if (args.executed) fields.push(`executed=${args.executed}`);
  if (args.pnl) fields.push(`pnl=${cleanField(args.pnl)}`);
  if (args.principles && args.principles.length > 0) {
    fields.push(`principles=[${args.principles.join(",")}]`);
  }
  if (args.memo) fields.push(`memo=${JSON.stringify(cleanField(args.memo))}`);
  fields.push(`result=${args.result ?? "tbd"}`);

  const size = args.size ? ` ${cleanField(args.size)}` : "";
  const id = args.id ? ` [${cleanField(args.id)}]` : "";
  const head = `- ${dateTime}${id} ${cleanField(args.ticker ?? "")} ${args.action}${size}`;
  return `${head} | ${fields.join(" | ")}`;
}

function insertDecisionEntry(content: string, line: string): string {
  if (content.includes(DECISION_LOG_MARKER)) {
    // 함수형 replacement: line에 $&·$$ 등 특수 패턴이 있어도 그대로 삽입.
    return content.replace(DECISION_LOG_MARKER, () => `${DECISION_LOG_MARKER}\n${line}`);
  }
  const idx = content.indexOf("## Entries");
  if (idx !== -1) {
    const lineEnd = content.indexOf("\n", idx);
    const pos = lineEnd === -1 ? content.length : lineEnd + 1;
    return `${content.slice(0, pos)}\n${line}\n${content.slice(pos)}`;
  }
  return content.endsWith("\n") ? `${content}${line}\n` : `${content}\n${line}\n`;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildCaptureFrontmatter(args: {
  captured: string;
  origin: string;
  context: string;
  url?: string | null;
}): string {
  const lines = [
    "---",
    `captured: ${args.captured}`,
    `origin: ${args.origin}`,
    `context: ${escapeYamlString(args.context)}`,
  ];
  if (args.url) {
    lines.push(`url: ${escapeYamlString(args.url)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function escapeYamlString(value: string): string {
  if (/^[\w\-./: ]+$/.test(value) && !/^[-?:,\[\]{}#&*!|>'%@`]/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function hasFrontmatter(content: string): boolean {
  return /^---\r?\n/.test(content);
}

export const memoryTools = [
  tool({
    name: "memory_list",
    description:
      "List files and subdirectories in the memory-space GitHub repo at the given path. Omit path to list the repo root.",
    inputSchema: memoryListInputSchema,
    async run(args, { memoryService }) {
      const entries = await memoryService.list(args.path ?? undefined);
      return { entries };
    },
  }),
  tool({
    name: "memory_read",
    description:
      "Read a single file from the memory-space GitHub repo and return its UTF-8 content plus sha.",
    inputSchema: memoryReadInputSchema,
    async run(args, { memoryService }) {
      const file = await memoryService.read(args.path);
      return { file };
    },
  }),
  tool({
    name: "memory_search",
    description:
      "Full-text search across the memory-space GitHub repo via GitHub Code Search API. Optional extension and path qualifiers narrow the scope. Note: GitHub Code Search only indexes the default branch; newly pushed files take a short while to become searchable.",
    inputSchema: memorySearchInputSchema,
    async run(args, { memoryService }) {
      const result = await memoryService.search(args.query, {
        extension: args.extension ?? undefined,
        path: args.path ?? undefined,
      });
      return { result };
    },
  }),
  tool({
    name: "memory_capture",
    description:
      `Append a raw entry to sources/_inbox/ in the memory-space repo. Single-file commit, lightweight — safe to call without explicit consent. Announce the stored path in one line after.

Path is auto-derived: sources/_inbox/<date>-<slug>.md. date defaults to today; slug must be kebab-case (Korean allowed). Frontmatter is prepended unless content already starts with '---'.

Capture criteria, structuring rules, ingest/lint procedures all live in the repo itself: read CLAUDE.md and .meta/workflows.md for the SSOT. Ingest and lint are NOT exposed as tools — run them via the /ingest and /lint skills inside a local clone of memory-space.`,
    inputSchema: memoryCaptureInputSchema,
    async run(args, { memoryService }) {
      const date = args.date ?? todayIsoDate();
      const filename = `${date}-${args.slug}.md`;
      const path = `${INBOX_PREFIX}${filename}`;

      const body = hasFrontmatter(args.content)
        ? args.content
        : buildCaptureFrontmatter({
            captured: date,
            origin: args.origin,
            context: args.context,
            url: args.url ?? undefined,
          }) + args.content;

      const commitMessage = `capture: _inbox/${filename} — ${args.context}`;
      const result = await memoryService.write(path, body, commitMessage);
      return { result };
    },
  }),
  tool({
    name: "decision_log_append",
    description:
      `Append one structured decision line to the month partition under ${DECISION_LOG_DIR}/ (YYYY-MM.md, derived from the entry date) in the memory-space repo. A new month's file is auto-created from a lean template on first append. Cross-client, in-the-moment trade-decision capture — call right when an enter/addbuy/trim/exit decision is made. Read-modify-write, newest on top.

Captures execution telemetry for the "repeatable +EV system" goal. The three target metrics and what feeds them:
- 진입 게이트 통과율 ← gate (which entry gates passed; empty = impulse — log it honestly).
- 손절 집행률 (the key weakness metric) ← exitReason=stop 케이스 중 executed=planned 비율. exitReason(why) and executed(how) are orthogonal — fill both on exits.
- EV per trade / 승률 / 보유기간 ← REQUIRES id to pair a position's enter→addbuy→trim→exit. Always set id (e.g. TSLA-1) starting on enter and reuse it for that position. Without id the lifecycle can't be reconstructed.

Field subsets by action (only send what applies — keeps each call light):
- enter/addbuy: id, ticker, action, size, trigger, gate, stop, target, memo
- trim/exit: id, ticker, action, size, exitReason, executed, pnl, result
- review (회고): action, memo (필수), reviewType, optionally ticker/id/principles — 휩쏘·판단복기 등 사후 메모. 매매 필드는 무시됨.

date/time default to KST now; pass only to override. result defaults to tbd; set win/loss/flat on the exit line. Aggregation into metrics is a desktop skill, not a tool.

값 입력 규칙(자주 틀리는 부분): 값이 없는 필드는 보내지 말고 생략하세요. "null"·"N/A"·"none"·"-" 같은 빈값 표시 문자열은 거부됩니다(에러). pnl·stop·size 같은 자유형식 필드는 실제 값을 그대로 넣고(숫자도 가능), trim/exit 라인은 pnl·result·exitReason을 처음부터 채우세요 — 빠뜨린 뒤 정정 라인으로 땜질하지 마세요. 응답의 warnings 배열에 누락 항목이 표시되면 그 라인을 decision_log_amend로 고치세요.`,
    inputSchema: decisionLogAppendInputSchema,
    async run(args, { memoryService }) {
      assertRequiredFields(args);

      const now = nowDateTimeKst();
      const date = args.date ?? now.date;
      const dateTime = `${date} ${args.time ?? now.time}`;
      const line = buildDecisionLine(args, dateTime);

      const path = decisionLogPath(date);
      const file = await memoryService.readOrNull(path);
      const base = file?.content ?? decisionLogMonthTemplate(date);
      const updated = insertDecisionEntry(base, line);

      const resultTag = args.result && args.result !== "tbd" ? ` (${args.result})` : "";
      const idTag = args.id ? `${args.id} ` : "";
      const commitMessage =
        args.action === "review"
          ? `decision-log: 회고${args.reviewType ? ` ${args.reviewType}` : ""}${args.ticker ? ` ${args.ticker}` : ""}`
          : `decision-log: ${idTag}${args.ticker} ${args.action}${resultTag}`;
      const result = await memoryService.write(path, updated, commitMessage);
      const warnings = decisionWarnings(args);
      return { result, appended: line, path, warnings };
    },
  }),
  tool({
    name: "decision_log_amend",
    description:
      `Correct an existing decision line in the month partition under ${DECISION_LOG_DIR}/ and leave a separate audit entry. Use this instead of appending ad-hoc "정정 라인" when a previously logged line had a wrong/missing field (e.g. forgot pnl, result tbd→loss, "null" was written by mistake).

How it works:
- find: a unique substring that locates the target line in that month's file (must match exactly one entry line; if 0 or 2+, it errors — make find more specific).
- Then resend the FULL corrected fields (same fields as decision_log_append) — the line is rebuilt from them so formatting stays consistent. The original timestamp is preserved automatically; date/time are only used to pick the month partition.
- An audit line ('✎ amend | reason=... | before=... | after=...') is inserted at the top of the same file, so every correction is traceable in-log (git history also records it).

date selects the partition (entry's month); default = current month. reason is required and goes into the audit line.`,
    inputSchema: decisionLogAmendInputSchema,
    async run(args, { memoryService }) {
      assertRequiredFields(args);

      const now = nowDateTimeKst();
      const partitionDate = args.date ?? now.date;
      const path = decisionLogPath(partitionDate);

      const file = await memoryService.readOrNull(path);
      if (!file) {
        throw new Error(
          `대상 월 로그 파일이 없습니다: ${path}. date를 수정 대상 entry의 날짜(YYYY-MM-DD)로 지정하세요.`,
        );
      }

      const lines = file.content.split("\n");
      const matches = lines.filter(
        (l) => l.trimStart().startsWith("- ") && l.includes(args.find),
      );
      if (matches.length === 0) {
        throw new Error(`"${args.find}"에 매칭되는 라인이 ${path}에 없습니다. find를 확인하세요.`);
      }
      if (matches.length > 1) {
        throw new Error(
          `"${args.find}"가 ${matches.length}개 라인에 매칭됩니다. find를 더 구체적으로 적어 1개만 매칭되게 하세요.`,
        );
      }

      const before = matches[0];
      const dateTime = extractTimestamp(before) ?? `${partitionDate} ${args.time ?? now.time}`;
      const after = buildDecisionLine(args, dateTime);

      const auditTime = `${now.date} ${now.time}`;
      const auditLine = `- ${auditTime} ✎ amend | reason=${JSON.stringify(cleanField(args.reason))} | before=${JSON.stringify(before.trim())} | after=${JSON.stringify(after)}`;

      // 함수형 replacement: after에 $&·$$ 등 특수 패턴이 있어도 그대로 치환.
      const replaced = file.content.replace(before, () => after);
      const updated = insertDecisionEntry(replaced, auditLine);

      const commitMessage = `decision-log(amend): ${cleanField(args.reason)}`;
      const result = await memoryService.write(path, updated, commitMessage);
      const warnings = decisionWarnings(args);
      return { result, path, before: before.trim(), after, audit: auditLine, warnings };
    },
  }),
];
