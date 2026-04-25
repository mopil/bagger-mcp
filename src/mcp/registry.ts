import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { bithumbTools } from "../tools/bithumb/tools.js";
import { grokTools } from "../tools/grok/tools.js";
import { krxTools } from "../tools/krx/tools.js";
import { memoryTools } from "../tools/memory/tools.js";
import { telegramTools } from "../tools/telegram/tools.js";
import { upbitTools } from "../tools/upbit/tools.js";
import { yahooFinanceTools } from "../tools/yahoo-finance/tools.js";
import type { ServiceRegistry } from "./services.js";

const registry = [
  ...telegramTools,
  ...grokTools,
  ...yahooFinanceTools,
  ...krxTools,
  ...upbitTools,
  ...bithumbTools,
  ...memoryTools,
];

export function registerTools(server: McpServer, services: ServiceRegistry): void {
  for (const tool of registry) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args: unknown) => tool.execute(args as never, services),
    );
  }
}
