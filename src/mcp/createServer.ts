import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerGrokTools } from "../tools/grok/register.js";
import type { GrokService } from "../tools/grok/service.js";
import { registerTelegramTools } from "../tools/telegram/register.js";
import type { TelegramService } from "../tools/telegram/service.js";
import { registerYahooFinanceTools } from "../tools/yahoo-finance/register.js";
import type { YahooFinanceService } from "../tools/yahoo-finance/service.js";

export function createMcpServer(services: {
  telegramService: TelegramService;
  grokService: GrokService;
  yahooFinanceService: YahooFinanceService;
}): McpServer {
  const server = new McpServer({
    name: "bagger-mcp",
    version: "0.1.0",
  });

  registerTelegramTools(server, services.telegramService);
  registerGrokTools(server, services.grokService);
  registerYahooFinanceTools(server, services.yahooFinanceService);

  return server;
}
