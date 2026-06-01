import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { logger } from "../logger.js";
import { binanceTools } from "../tools/crypto/binance/tools.js";
import { bithumbTools } from "../tools/crypto/bithumb/tools.js";
import { coingeckoTools } from "../tools/crypto/coingecko/tools.js";
import { dartTools } from "../tools/dart/tools.js";
import { grokTools } from "../tools/grok/tools.js";
import { krxTools } from "../tools/krx/tools.js";
import { memoryTools } from "../tools/memory/tools.js";
import { naverlandTools } from "../tools/naverland/tools.js";
import { telegramTools } from "../tools/telegram/tools.js";
import { upbitTools } from "../tools/crypto/upbit/tools.js";
import { yahooFinanceTools } from "../tools/yahoo-finance/tools.js";
import type { ServiceRegistry } from "./services.js";

const registry = [
  ...telegramTools,
  ...grokTools,
  ...yahooFinanceTools,
  ...krxTools,
  ...upbitTools,
  ...bithumbTools,
  ...binanceTools,
  ...coingeckoTools,
  ...dartTools,
  ...naverlandTools,
  ...memoryTools,
];

function summarizeArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object") {
    return { argKeys: [] };
  }
  return { argKeys: Object.keys(args as Record<string, unknown>) };
}

export function registerTools(server: McpServer, services: ServiceRegistry): void {
  for (const tool of registry) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args: unknown) => {
        const toolLogger = logger.child({ tool: tool.name });
        const start = Date.now();
        toolLogger.debug("tool.start", summarizeArgs(args));

        try {
          const result = await tool.execute(args as never, services);
          toolLogger.info("tool.ok", { durationMs: Date.now() - start });
          return result;
        } catch (error) {
          toolLogger.error("tool.error", {
            durationMs: Date.now() - start,
            err: error,
          });
          throw error;
        }
      },
    );
  }

  logger.info("mcp.tools_registered", { count: registry.length });
}
