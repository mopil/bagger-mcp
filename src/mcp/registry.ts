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

// 도구를 그룹 단위로 묶어 ENABLED_TOOL_GROUPS로 켜고 끈다.
// 배경: 58개 도구의 tools/list 페이로드가 ~50KB인데, Railway 7일 로그 집계상
//   실제로 호출되는 건 12개뿐이었다. 클라이언트(claude.ai 커넥터 등)는 이 스키마를
//   대화 시작마다 통째로 싣기 때문에, 안 쓰는 그룹은 등록하지 않는 편이 이득이다.
//   코드는 남겨두고 등록만 건너뛰므로, 필요해지면 환경변수 한 줄로 되살린다.
const ALL_GROUP_NAMES = [
  "telegram",
  "grok",
  "yahoo",
  "krx",
  "upbit",
  "bithumb",
  "binance",
  "coingecko",
  "dart",
  "naverland",
  "tossinvest",
  "molit",
  "memory",
] as const;

type ToolGroupName = (typeof ALL_GROUP_NAMES)[number];

// 기본 비활성: 7일 로그에서 호출 0회였고 상시 필요하지 않은 그룹(크립토 시세·부동산).
// 계절적으로 필요해지면 ENABLED_TOOL_GROUPS에 추가하면 된다. grok(x_search)은 기본 유지.
const DEFAULT_DISABLED_GROUPS: ToolGroupName[] = [
  "upbit",
  "bithumb",
  "binance",
  "coingecko",
  "naverland",
  "molit",
];

// ENABLED_TOOL_GROUPS 해석:
//   미설정  → 기본 활성 집합(= 전체 - DEFAULT_DISABLED_GROUPS)
//   "all"   → 전체
//   "a,b,c" → 명시한 그룹만
function resolveEnabledGroups(): Set<ToolGroupName> {
  const raw = process.env.ENABLED_TOOL_GROUPS?.trim();

  if (!raw) {
    return new Set(ALL_GROUP_NAMES.filter((name) => !DEFAULT_DISABLED_GROUPS.includes(name)));
  }

  if (raw.toLowerCase() === "all") {
    return new Set(ALL_GROUP_NAMES);
  }

  const requested = raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  const unknown = requested.filter(
    (name) => !(ALL_GROUP_NAMES as readonly string[]).includes(name),
  );
  if (unknown.length > 0) {
    // 오타로 그룹이 통째로 사라지면 원인 추적이 어려우므로 기동 시점에 바로 알린다.
    logger.warn("mcp.unknown_tool_groups", { unknown, known: ALL_GROUP_NAMES });
  }

  return new Set(ALL_GROUP_NAMES.filter((name) => requested.includes(name)));
}

const enabledGroups = resolveEnabledGroups();
const on = (name: ToolGroupName) => enabledGroups.has(name);

const registry = [
  ...(on("telegram") ? telegramTools : []),
  ...(on("grok") ? grokTools : []),
  ...(on("yahoo") ? yahooFinanceTools : []),
  ...(on("krx") ? krxTools : []),
  ...(on("upbit") ? upbitTools : []),
  ...(on("bithumb") ? bithumbTools : []),
  ...(on("binance") ? binanceTools : []),
  ...(on("coingecko") ? coingeckoTools : []),
  ...(on("dart") ? dartTools : []),
  ...(on("naverland") ? naverlandTools : []),
  ...(on("tossinvest") ? tossInvestTools : []),
  ...(on("molit") ? molitTools : []),
  ...(on("memory") ? memoryTools : []),
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

  logger.info("mcp.tools_registered", {
    count: registry.length,
    groups: [...enabledGroups],
    skipped: ALL_GROUP_NAMES.filter((name) => !enabledGroups.has(name)),
  });
}
