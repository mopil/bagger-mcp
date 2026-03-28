import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerTelegramTools } from "../tools/telegram/register.js";
import type { TelegramService } from "../tools/telegram/service.js";

export function createMcpServer(telegramService: TelegramService): McpServer {
  const server = new McpServer({
    name: "bagger-mcp",
    version: "0.1.0",
  });

  registerTelegramTools(server, telegramService);

  return server;
}
