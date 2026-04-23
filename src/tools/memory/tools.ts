import type { ServiceRegistry } from "../../mcp/services.js";
import { defineServiceTool } from "../defineTool.js";
import {
  memoryCaptureInputSchema,
  memoryIngestInputSchema,
  memoryLintInputSchema,
  memoryListInputSchema,
  memoryReadInputSchema,
  memorySearchInputSchema,
} from "./schema.js";

const tool = defineServiceTool<ServiceRegistry>();

const INBOX_PREFIX = "sources/_inbox/";
const WIKI_PREFIX = "wiki/";
const ARCHIVE_PATTERN = /^sources\/\d{4}\/\d{2}\//;

function normalizePath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
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
      "Full-text search across the memory-space GitHub repo via GitHub Code Search API. Optional extension and path qualifiers narrow the scope. Note: GitHub Code Search only indexes the repo's default branch, so results may not reflect other branches. Newly pushed files can take a short while to become searchable.",
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
      `Stage 1 of the capture→ingest pipeline. Drop raw material (conversation snippet, paste, URL content, source file text) into sources/_inbox/ WITHOUT structuring it.

When to call:
- Permanent-value signal in conversation: repeated principle, framework being articulated, structured postmortem, version-tracked convention.
- User pastes a long article, report, transcript, or says "save this".
- Query flow produces a novel synthesis worth preserving for later batch ingest.

When NOT to call:
- Current positions, weekly market state, short-lived events → those belong in userMemories, not this repo.
- Content shorter than ~3 sentences with no context.
- Content already present in _inbox or wiki (avoid duplicate capture).

Behavior:
- Path is auto-derived: sources/_inbox/<date>-<slug>.md. date defaults to today; slug must be kebab-case (Korean allowed), no date prefix (added automatically).
- Frontmatter (captured, origin, context, url) is prepended UNLESS the content already starts with '---'.
- Commit message: "capture: _inbox/<file> — <context>".
- Safe to call without explicit consent (lightweight). Announce the stored path in one line after.
- Never touches wiki/** or index.md/log.md. Wiki writes go through memory_ingest only.`,
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
    name: "memory_ingest",
    description:
      `Stage 2 of the capture→ingest pipeline. Batch-structure sources/_inbox/ entries into wiki pages in ONE atomic commit. This tool is the final commit step; all reasoning happens BEFORE the call.

Trigger: ONLY when the user explicitly asks ("ingest 해줘", "_inbox 정리해줘", "/ingest", or equivalent). Never self-trigger.

Required procedure (do this BEFORE calling the tool):
1. memory_read CLAUDE.md, .meta/conventions.md, .meta/ontology.md, .meta/workflows.md — once per session.
2. memory_list 'sources/_inbox/' — see what is pending. If empty, tell the user and stop.
3. memory_read every pending inbox file (or a user-agreed subset if too many).
4. memory_read 'wiki/index.md' plus any related existing pages (memory_search to find overlap).
5. Extract patterns ACROSS the batch: repeated entities (people/companies/projects/concepts), supporting/contradicting theses, event chains. This cross-source view is the whole reason ingest is batched — do not skip.
6. Draft a proposal: for each outcome list (a) new wiki pages to create with domain/type/id and frontmatter, (b) existing pages to update with what changes, (c) inbox files to archive (source path → sources/YYYY/MM/<slug>.md destination).
7. Present the proposal to the user and get explicit consent. If they adjust, revise and re-confirm.
8. Only then call this tool with a single bundle.

Input composition:
- writes: must include EVERY change as a fully-written file:
  * new/updated wiki/** pages (with proper frontmatter: type, created, updated)
  * updated wiki/index.md (new entries added)
  * updated wiki/log.md (append one line like "YYYY-MM-DD ingest: _inbox N건 → [[a]], [[b]] 생성 / [[c]] 갱신")
  * archive target files at sources/YYYY/MM/<slug>.md (copy the inbox original content verbatim — archive is immutable afterward)
- deletes: the sources/_inbox/** paths being moved to archive (archive-write + inbox-delete MUST be in the same call to avoid data loss).
- summary: one-line commit message; will be prefixed with "ingest:".

Path enforcement (server-side):
- writes: must be under wiki/** or sources/YYYY/MM/**. Violations rejected.
- deletes: must be under sources/_inbox/**. Violations rejected.

Conventions to honor (from .meta/):
- Page filenames kebab-case, minimum frontmatter (type, created, updated).
- Every new page must be registered in wiki/index.md.
- Every page should have at least one [[wikilink]] to avoid orphans.
- Use sourced_from relation or body [[<source-id>]] citation so wiki pages trace back to inbox/archive origins.`,
    inputSchema: memoryIngestInputSchema,
    async run(args, { memoryService }) {
      const writes = args.writes;
      const deletes = args.deletes ?? [];

      const writeViolations = writes
        .map((w) => normalizePath(w.path))
        .filter(
          (p) =>
            !p.startsWith(WIKI_PREFIX) && !ARCHIVE_PATTERN.test(p),
        );
      if (writeViolations.length > 0) {
        throw new Error(
          `memory_ingest writes must target wiki/** or sources/YYYY/MM/**. Offending paths: ${writeViolations.join(", ")}`,
        );
      }

      const deleteViolations = deletes
        .map(normalizePath)
        .filter((p) => !p.startsWith(INBOX_PREFIX));
      if (deleteViolations.length > 0) {
        throw new Error(
          `memory_ingest deletes must target sources/_inbox/** only. Offending paths: ${deleteViolations.join(", ")}`,
        );
      }

      const result = await memoryService.bulkCommit(
        writes,
        deletes,
        `ingest: ${args.summary}`,
      );
      return { result };
    },
  }),
  tool({
    name: "memory_lint",
    description:
      `Wiki maintenance in ONE atomic commit. Like ingest, all reasoning happens BEFORE the call.

Trigger: user requests ("lint 해줘") OR agent self-proposes roughly monthly when staleness is evident. Never silently.

Checks to perform BEFORE drafting changes:
1. memory_read CLAUDE.md and .meta/* once per session.
2. memory_list wiki/ recursively; memory_read wiki/index.md.
3. Orphans: wiki pages nobody links to → evaluate keep-value; if kept, add backlinks elsewhere; if not, delete.
4. Broken links: [[x]] where x.md does not exist → either create a stub or remove the reference.
5. Contradictions: two pages making incompatible claims about the same subject → merge, or add superseded_by, or spin out a "논점" page.
6. Stale: thesis/event pages with old 'updated' that no longer reflect the world → mark stale or supersede.
7. Duplicates: near-identical pages → merge + superseded_by on the loser.
8. Empty template sections → remove.
9. Inbox aging: sources/_inbox/** entries older than ~30 days that were never ingested → propose capture criteria review or direct cleanup.

Operation selection (determines commit prefix):
- lint (default): small cleanups — stubs, backlinks, orphan removals, broken-link fixes.
- prune: removing pages that turned out to be dynamic/ephemeral (belonged in userMemories) or were superseded long ago. Always require explicit user consent.
- refactor: directory/structure reorganization (domain split, type rename). If this changes .meta/conventions.md the update MUST be part of the same commit.

Procedure:
1. Run the checks, compile findings.
2. Draft a proposal grouped by check category.
3. Present to user, get consent.
4. Only then call this tool.

Input:
- writes: wiki/** only (updated pages, stubs, merged survivors, index.md, log.md with a summary line). .meta/** allowed for refactor operation.
- deletes: wiki/** or sources/_inbox/** only. sources/YYYY/MM/** is immutable — rejected server-side.
- summary: one-line commit message; prefixed with "<operation>:".
- At least one write or delete required.`,
    inputSchema: memoryLintInputSchema,
    async run(args, { memoryService }) {
      const operation = args.operation ?? "lint";
      const writes = args.writes ?? [];
      const deletes = args.deletes ?? [];

      if (writes.length === 0 && deletes.length === 0) {
        throw new Error("memory_lint requires at least one write or delete.");
      }

      const allowMeta = operation === "refactor";
      const writeViolations = writes
        .map((w) => normalizePath(w.path))
        .filter(
          (p) => !p.startsWith(WIKI_PREFIX) && !(allowMeta && p.startsWith(".meta/")),
        );
      if (writeViolations.length > 0) {
        throw new Error(
          `memory_lint writes must target wiki/**${allowMeta ? " or .meta/**" : ""}. Offending paths: ${writeViolations.join(", ")}`,
        );
      }

      const deleteViolations = deletes
        .map(normalizePath)
        .filter((p) => !p.startsWith(WIKI_PREFIX) && !p.startsWith(INBOX_PREFIX));
      if (deleteViolations.length > 0) {
        throw new Error(
          `memory_lint deletes must target wiki/** or sources/_inbox/** only (archive sources/YYYY/MM/** is immutable). Offending paths: ${deleteViolations.join(", ")}`,
        );
      }

      const result = await memoryService.bulkCommit(
        writes,
        deletes,
        `${operation}: ${args.summary}`,
      );
      return { result };
    },
  }),
];
