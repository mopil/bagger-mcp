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
- 손절 집행률: - (exit=stop 중 executed∈{planned, changed-residual} 비율)
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
    if (args.action === "addbuy" && (!args.gate || args.gate.length === 0)) {
      warnings.push(
        "addbuy(추매)에 gate가 없습니다 — 추세상단 재량추매는 '비중확대 자리 손실' 메타패턴의 주원인입니다. 통과 게이트를 넣거나, 정말 재량이면 빈 채로 두되 그 사실을 자각하세요.",
      );
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
    if (args.exitReason === "stop" && !args.executed) {
      warnings.push(
        "exit=stop인데 executed가 없습니다 — planned/changed-residual/changed-violation/skipped 중 하나로 집행 방식을 기록해야 손절 집행률이 잡힙니다.",
      );
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
      "Read a single file from the memory-space GitHub repo and return its UTF-8 content plus sha. Start with wiki/routing.md (small) when you need to find where a topic lives — it maps topics to pages. Some pages run to tens of KB, so pick targets from routing.md or memory_search snippets rather than reading large files speculatively.",
    inputSchema: memoryReadInputSchema,
    async run(args, { memoryService }) {
      const file = await memoryService.read(args.path);
      return { file };
    },
  }),
  tool({
    name: "memory_search",
    description:
      `Search the user's long-term investing memory (mopil/memory-space) — their own principles, theses, past decisions, and logged mistakes.

CALL THIS BEFORE ANSWERING when the user asks about a ticker, sector, macro read, entry/exit/sizing, or "what do you think about X". They have written on it before; answering from general knowledge while their own prior reasoning sits unread is the failure mode this tool exists to prevent. Cheap to call, so bias toward calling it.

Backed by GitHub Code Search: LEXICAL matching, not semantic, and weak on Korean tokenization. A single query missing does NOT mean nothing is stored. Retry with the ticker, the English term, the Korean term, and the concept name (e.g. "HBM" / "메모리" / "memory-cycle"), and try the frontmatter aliases line, which carries KR/EN synonyms and tickers for this purpose. If several queries still miss, memory_read wiki/routing.md and follow the map before concluding the memory is silent.

Narrow with the path qualifier — wiki/investing/principles (judgment rules), wiki/investing/theses (market reads), wiki/investing/lessons (postmortems), wiki/logs/decisions (executed trades). Prefer wiki/ over sources/, which is raw and noisy. Note: only the default branch is indexed, and newly pushed files take a short while to become searchable.`,
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
      `Append one trade-decision line to the month partition under ${DECISION_LOG_DIR}/ (YYYY-MM.md, from the entry date; auto-created on first append). Call at the moment an enter/addbuy/trim/exit decision is made. Newest on top.

Always set id (e.g. TSLA-1) on enter and reuse it for that position — EV/win-rate/holding-period aggregation pairs enter→exit by id.

Fields by action (send only what applies):
- enter/addbuy: id, ticker, action, size, trigger, gate, stop, target, memo
- trim/exit: id, ticker, action, size, exitReason, executed, pnl, result
- review (회고): action, memo (required), reviewType — trade fields are ignored.

date/time default to KST now. Omit fields with no value. The response returns a warnings array naming anything missing — fix that line via decision_log_amend instead of appending a correction line.`,
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
      `Correct an existing decision line under ${DECISION_LOG_DIR}/ and leave an audit entry. Use this instead of appending an ad-hoc 정정 라인 when a logged line had a wrong/missing field.

- find: a substring that matches exactly one entry line in that month's file (0 or 2+ matches errors — make it more specific).
- Resend the FULL corrected fields (same as decision_log_append); the line is rebuilt from them. The original timestamp is preserved.
- An audit line is inserted at the top of the same file, so corrections stay traceable.

date selects the month partition (the entry's month, default current). reason is required.`,
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
