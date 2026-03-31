import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerTools } from "./registry.js";
import type { ServiceRegistry } from "./services.js";

export function createMcpServer(services: ServiceRegistry): McpServer {
  const server = new McpServer({
    name: "bagger-mcp",
    version: "0.1.0",
  });

  registerTools(server, services);

  return server;
}
