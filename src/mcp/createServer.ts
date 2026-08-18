import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerTools } from "./registry.js";
import type { ServiceRegistry } from "./services.js";

const SERVER_INSTRUCTIONS = `Tools for the long-term memory GitHub repo (mopil/memory-space). The repo is self-describing — read CLAUDE.md and .meta/workflows.md inside it for conventions, capture criteria, and the full pipeline.

Exposed tools:
- memory_search / memory_read / memory_list — reading. See the read protocol below; this is not optional background reading.
- memory_capture — append a single raw entry to sources/_inbox/. Lightweight, safe without explicit consent. Announce the stored path after.

READ PROTOCOL — run BEFORE answering, not after.
Whenever the user asks about a ticker, sector, macro read, entry/exit/sizing, or "what do you think about X", the user's own prior reasoning on it very likely already exists here. Answering from general knowledge while that sits unread is the main failure mode of this server.

1. memory_search first. The user's judgment frames, past theses, and logged mistakes outrank anything you would reconstruct from scratch.
2. Search is GitHub Code Search — LEXICAL, not semantic, and weak on Korean tokenization. One query proves nothing. If the first query misses, retry with: the ticker, the English term, the Korean term, and the concept name (e.g. "HBM" / "메모리" / "memory-cycle"). Also grep the frontmatter "aliases" line, which carries KR/EN synonyms and tickers for exactly this reason.
3. If searching still misses, memory_read wiki/routing.md — a small routing map of where things live — and follow it. Do not conclude "nothing is stored" from failed searches alone.
4. Prefer wiki/ over sources/ (sources/ is raw, unstructured, and noisy). Narrow with the path qualifier: wiki/investing/principles, wiki/investing/theses, wiki/investing/lessons, wiki/logs/decisions.
5. Cite what you found by page name so the user can trace it, and say plainly when the memory is silent on a question rather than implying it was consulted.

Some pages are large (tens of KB). Read the routing map or search snippets to pick the right one instead of reading big files speculatively.

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
