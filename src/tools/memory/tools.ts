import type { ServiceRegistry } from "../../mcp/services.js";
import { defineServiceTool } from "../defineTool.js";
import {
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
  ticker: string;
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

function buildDecisionLine(args: DecisionLogFields, dateTime: string): string {
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
  const head = `- ${dateTime}${id} ${cleanField(args.ticker)} ${args.action}${size}`;
  return `${head} | ${fields.join(" | ")}`;
}

function insertDecisionEntry(content: string, line: string): string {
  if (content.includes(DECISION_LOG_MARKER)) {
    return content.replace(DECISION_LOG_MARKER, `${DECISION_LOG_MARKER}\n${line}`);
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

date/time default to KST now; pass only to override. result defaults to tbd; set win/loss/flat on the exit line. Aggregation into metrics is a desktop skill, not a tool.`,
    inputSchema: decisionLogAppendInputSchema,
    async run(args, { memoryService }) {
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
      const commitMessage = `decision-log: ${idTag}${args.ticker} ${args.action}${resultTag}`;
      const result = await memoryService.write(path, updated, commitMessage);
      return { result, appended: line, path };
    },
  }),
];
