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
const DECISION_LOG_PATH = "wiki/investing/lessons/decision-log.md";
const DECISION_LOG_MARKER = "<!-- DECISION_LOG_INSERT_AFTER -->";

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
      `Append one structured decision line to ${DECISION_LOG_PATH} in the memory-space repo. Cross-client, in-the-moment trade-decision capture — call right when an enter/addbuy/trim/exit decision is made. Read-modify-write, newest on top.

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
      const dateTime = `${args.date ?? now.date} ${args.time ?? now.time}`;
      const line = buildDecisionLine(args, dateTime);

      const file = await memoryService.read(DECISION_LOG_PATH);
      const updated = insertDecisionEntry(file.content, line);

      const resultTag = args.result && args.result !== "tbd" ? ` (${args.result})` : "";
      const idTag = args.id ? `${args.id} ` : "";
      const commitMessage = `decision-log: ${idTag}${args.ticker} ${args.action}${resultTag}`;
      const result = await memoryService.write(DECISION_LOG_PATH, updated, commitMessage);
      return { result, appended: line };
    },
  }),
];
