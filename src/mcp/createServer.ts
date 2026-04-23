import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerTools } from "./registry.js";
import type { ServiceRegistry } from "./services.js";

const SERVER_INSTRUCTIONS = `The memory_* tools operate on a long-term memory GitHub repo with a two-stage capture→ingest pipeline. The repo is self-describing: conventions (layout, frontmatter, links, domains) live inside it.

## Repo layout
- sources/_inbox/  — raw captures awaiting structuring
- sources/YYYY/MM/ — ingested originals (IMMUTABLE archive)
- wiki/            — structured knowledge (pages, index.md, log.md)
- CLAUDE.md, .meta/{conventions,workflows}.md — schema the agent must honor

## Tools

Read (no restrictions, call freely):
- memory_read(path), memory_list(path?), memory_search(query)

Write (pipeline-specific, no general-purpose write exists):
- memory_capture — Stage 1. Lightweight dump of raw material into sources/_inbox/. Single file, auto frontmatter, auto date prefix. Safe to call without explicit consent — just announce the path afterward.
- memory_ingest — Stage 2. Batch-structure _inbox entries into wiki pages in ONE atomic commit. Never call without the user explicitly asking ("ingest", "_inbox 정리" etc.) AND without presenting a proposal first.
- memory_lint — Wiki maintenance (orphans, broken links, duplicates, stale, inbox aging). operation: lint | prune | refactor. Archive is immutable.

## Session protocol

1. First time touching writes this session: memory_read CLAUDE.md, README.md, and every file under .meta/. Follow them.
2. Capture opportunistically during conversation when permanent-value signal appears (see CLAUDE.md criteria).
3. Ingest only on explicit trigger. Follow the procedure in the memory_ingest description.
4. Lint only on explicit request or as a monthly self-proposal. Follow memory_lint description.

All write tools commit atomically — the repo never ends up half-applied.`;

export function createMcpServer(services: ServiceRegistry): McpServer {
  const server = new McpServer(
    {
      name: "bagger-mcp",
      version: "0.1.0",
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  registerTools(server, services);

  return server;
}
