import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { YahooFinanceService } from "./service.js";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD format");
const intervalSchema = z.enum(["1d", "1wk", "1mo"]);
const statementTypeSchema = z.enum(["income_statement", "balance_sheet", "cash_flow"]);
const statementFrequencySchema = z.enum(["quarterly", "annual", "trailing"]);

export function registerYahooFinanceTools(
  server: McpServer,
  yahooFinanceService: YahooFinanceService,
): void {
  server.registerTool(
    "get_historical_stock_prices",
    {
      description: "Get historical OHLCV stock prices from Yahoo Finance. Use narrower date ranges and larger intervals to reduce response size.",
      inputSchema: {
        symbol: z.string().min(1),
        fromDate: isoDateSchema,
        toDate: isoDateSchema.optional(),
        interval: intervalSchema.optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      },
    },
    async (args) => {
      const result = await yahooFinanceService.getHistoricalStockPrices(args);

      return {
        content: [
          {
            type: "text",
            text: formatHistoricalPricesText(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "get_stock_info",
    {
      description: "Get current stock info, valuation, profile, and key statistics from Yahoo Finance.",
      inputSchema: {
        symbol: z.string().min(1),
      },
    },
    async (args) => {
      const result = await yahooFinanceService.getStockInfo(args);

      return {
        content: [
          {
            type: "text",
            text: formatStockInfoText(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "get_yahoo_finance_news",
    {
      description: "Search Yahoo Finance news by symbol or company name. Defaults are intentionally small to reduce latency and token usage.",
      inputSchema: {
        query: z.string().min(1),
        newsCount: z.number().int().min(1).max(20).optional(),
      },
    },
    async (args) => {
      const result = await yahooFinanceService.getYahooFinanceNews(args);

      return {
        content: [
          {
            type: "text",
            text: formatNewsText(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "get_stock_actions",
    {
      description: "Get dividend and split history for a stock over a date range.",
      inputSchema: {
        symbol: z.string().min(1),
        fromDate: isoDateSchema,
        toDate: isoDateSchema.optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async (args) => {
      const result = await yahooFinanceService.getStockActions(args);

      return {
        content: [
          {
            type: "text",
            text: formatStockActionsText(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "get_financial_statement",
    {
      description: "Get time-series financial statements from Yahoo Finance. Defaults are capped to recent rows to keep payloads small.",
      inputSchema: {
        symbol: z.string().min(1),
        statementType: statementTypeSchema,
        frequency: statementFrequencySchema.optional(),
        fromDate: isoDateSchema,
        toDate: isoDateSchema.optional(),
        limit: z.number().int().min(1).max(40).optional(),
      },
    },
    async (args) => {
      const result = await yahooFinanceService.getFinancialStatement(args);

      return {
        content: [
          {
            type: "text",
            text: formatFinancialStatementText(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "get_holder_info",
    {
      description: "Get institutional, fund, insider, and major holder ownership data for a stock.",
      inputSchema: {
        symbol: z.string().min(1),
      },
    },
    async (args) => {
      const result = await yahooFinanceService.getHolderInfo(args);

      return {
        content: [
          {
            type: "text",
            text: formatHolderInfoText(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "get_recommendations",
    {
      description: "Get Yahoo Finance related-stock recommendations for a symbol.",
      inputSchema: {
        symbol: z.string().min(1),
      },
    },
    async (args) => {
      const result = await yahooFinanceService.getRecommendations(args);

      return {
        content: [
          {
            type: "text",
            text: formatRecommendationsText(result),
          },
        ],
        structuredContent: result,
      };
    },
  );
}

function formatHistoricalPricesText(
  result: Awaited<ReturnType<YahooFinanceService["getHistoricalStockPrices"]>>,
): string {
  if (result.prices.length === 0) {
    return `No historical prices found for ${result.symbol}.`;
  }

  const latest = result.prices[result.prices.length - 1];
  return `${result.symbol}: ${result.prices.length} price rows from ${result.fromDate} to ${result.toDate ?? "latest"} at ${result.interval}. Latest close ${latest.close} on ${latest.date}.`;
}

function formatStockInfoText(result: Awaited<ReturnType<YahooFinanceService["getStockInfo"]>>): string {
  return [
    `${result.symbol}: ${result.companyName}`,
    `Price: ${result.price.regularMarketPrice ?? "n/a"} ${result.currency ?? ""}`.trim(),
    `Market cap: ${result.price.marketCap ?? "n/a"}`,
    `52w range: ${result.price.fiftyTwoWeekLow ?? "n/a"} - ${result.price.fiftyTwoWeekHigh ?? "n/a"}`,
  ].join("\n");
}

function formatNewsText(
  result: Awaited<ReturnType<YahooFinanceService["getYahooFinanceNews"]>>,
): string {
  if (result.news.length === 0) {
    return `No Yahoo Finance news found for "${result.query}".`;
  }

  const lines = result.news.slice(0, 5).map((item) => {
    return `- ${item.title} (${item.publisher}, ${item.providerPublishTime})`;
  });
  const suffix = result.news.length > 5
    ? `\n... ${result.news.length - 5} more articles in structuredContent`
    : "";

  return [`Yahoo Finance news for "${result.query}": ${result.news.length} articles.`, ...lines].join("\n") + suffix;
}

function formatStockActionsText(
  result: Awaited<ReturnType<YahooFinanceService["getStockActions"]>>,
): string {
  return `${result.symbol}: ${result.dividends.length} dividends and ${result.splits.length} splits from ${result.fromDate} to ${result.toDate ?? "latest"}.`;
}

function formatFinancialStatementText(
  result: Awaited<ReturnType<YahooFinanceService["getFinancialStatement"]>>,
): string {
  return `${result.symbol}: ${result.statements.length} ${result.frequency} ${result.statementType} rows from ${result.fromDate} to ${result.toDate ?? "latest"}.`;
}

function formatHolderInfoText(
  result: Awaited<ReturnType<YahooFinanceService["getHolderInfo"]>>,
): string {
  const majorHolders = result.majorHoldersBreakdown;

  return [
    `${result.symbol} holder info loaded.`,
    `Institutions hold: ${majorHolders?.institutionsPercentHeld ?? "n/a"}`,
    `Insiders hold: ${majorHolders?.insidersPercentHeld ?? "n/a"}`,
  ].join("\n");
}

function formatRecommendationsText(
  result: Awaited<ReturnType<YahooFinanceService["getRecommendations"]>>,
): string {
  if (result.recommendedSymbols.length === 0) {
    return `No related-stock recommendations found for ${result.symbol}.`;
  }

  const lines = result.recommendedSymbols.slice(0, 5).map((item) => `${item.symbol} (${item.score})`);
  const suffix = result.recommendedSymbols.length > 5
    ? `\n... ${result.recommendedSymbols.length - 5} more recommendations in structuredContent`
    : "";

  return [`Recommendations for ${result.symbol}:`, ...lines].join("\n") + suffix;
}
