import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerTools } from "./registry.js";
import type { ServiceRegistry } from "./services.js";

const SERVER_INSTRUCTIONS = `Tools for the long-term memory GitHub repo (mopil/memory-space). The repo is self-describing — read CLAUDE.md and .meta/workflows.md inside it for conventions, capture criteria, and the full pipeline.

Exposed tools:
- memory_read / memory_list / memory_search — read freely.
- memory_capture — append a single raw entry to sources/_inbox/. Lightweight, safe without explicit consent. Announce the stored path after.

Ingest and lint are NOT exposed as tools. They run in a local clone of memory-space via the /ingest and /lint skills (Claude Code), where local-FS reads make batch cross-source synthesis efficient. From any client, this server's job is capture + read; structuring happens at the desk.`;

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
