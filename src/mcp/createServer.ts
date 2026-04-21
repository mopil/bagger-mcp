import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerTools } from "./registry.js";
import type { ServiceRegistry } from "./services.js";

const SERVER_INSTRUCTIONS = `The memory_* tools operate on a GitHub repo that acts as a long-term memory store.
The repo is self-describing: its operating conventions (file layout, frontmatter, filename rules, linking) live inside the repo itself.

Before the first memory_write or memory_delete in a session, call memory_read on the convention files at the repo root — typically "CLAUDE.md" and "README.md", plus any files under ".meta/" — and follow them. If those files are absent, fall back to memory_list to discover the layout.

Never write a new file without first confirming: correct directory, filename casing, and required frontmatter for that repo. commit_message is mandatory on every write/delete and should describe the change in one line.`;

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
