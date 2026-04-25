import type { ServiceRegistry } from "../../mcp/services.js";
import { defineServiceTool } from "../defineTool.js";
import {
  memoryCaptureInputSchema,
  memoryListInputSchema,
  memoryReadInputSchema,
  memorySearchInputSchema,
} from "./schema.js";

const tool = defineServiceTool<ServiceRegistry>();

const INBOX_PREFIX = "sources/_inbox/";

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
];
