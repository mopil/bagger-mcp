import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { formatError, toErrorPayload } from "../errors.js";
import { logger } from "../logger.js";
import { binanceTools } from "../tools/crypto/binance/tools.js";
import { bithumbTools } from "../tools/crypto/bithumb/tools.js";
import { coingeckoTools } from "../tools/crypto/coingecko/tools.js";
import { dartTools } from "../tools/dart/tools.js";
import { grokTools } from "../tools/grok/tools.js";
import { krxTools } from "../tools/krx/tools.js";
import { memoryTools } from "../tools/memory/tools.js";
import { molitTools } from "../tools/molit/tools.js";
import { naverlandTools } from "../tools/naverland/tools.js";
import { telegramTools } from "../tools/telegram/tools.js";
import { tossInvestTools } from "../tools/tossinvest/tools.js";
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
  ...tossInvestTools,
  ...molitTools,
  ...memoryTools,
];

function summarizeArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object") {
    return { argKeys: [] };
  }
  return { argKeys: Object.keys(args as Record<string, unknown>) };
}

// 클라이언트(예: Claude Desktop)의 MCP 요청 타임아웃(기본 60s)보다 짧게 잡아,
// 클라이언트가 "this operation was aborted"로 요청을 끊기 전에 서버가 의미 있는
// 에러 메시지를 먼저 돌려주도록 한다. MCP_TOOL_TIMEOUT_MS로 조정 가능.
const TOOL_TIMEOUT_MS = (() => {
  const raw = Number(process.env.MCP_TOOL_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 55_000;
})();

function toolErrorResult(toolName: string, durationMs: number, error: unknown) {
  const payload = toErrorPayload(error);
  const text = `도구 '${toolName}' 실행 실패 (${durationMs}ms): ${formatError(error)}`;
  return {
    content: [{ type: "text" as const, text }],
    // 에이전트가 파싱할 수 있도록 구조화된 에러도 함께 반환.
    structuredContent: { error: { tool: toolName, durationMs, ...payload } },
    isError: true,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, toolName: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `'${toolName}' 도구가 ${Math.round(ms / 1000)}초 내에 응답하지 않았습니다. ` +
            `외부 API 지연 또는 rate limit일 수 있습니다. 조회 범위(max_pages, max_complexes 등)를 줄여 다시 시도하세요.`,
        ),
      );
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
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
          const result = await withTimeout(
            tool.execute(args as never, services),
            TOOL_TIMEOUT_MS,
            tool.name,
          );
          toolLogger.info("tool.ok", { durationMs: Date.now() - start });
          return result;
        } catch (error) {
          const durationMs = Date.now() - start;
          toolLogger.error("tool.error", { durationMs, err: error });
          // throw 대신 isError 결과로 반환 → 실제 에러 메시지(원인 cause 포함)가 클라이언트에 노출된다.
          return toolErrorResult(tool.name, durationMs, error);
        }
      },
    );
  }

  logger.info("mcp.tools_registered", { count: registry.length });
}
