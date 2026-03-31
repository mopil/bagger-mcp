import { defineServiceTool } from "../defineTool.js";
import type { ServiceRegistry } from "../../mcp/services.js";
import {
  financialStatementInputSchema,
  holderInfoInputSchema,
  historicalStockPricesInputSchema,
  recommendationsInputSchema,
  stockActionsInputSchema,
  stockInfoInputSchema,
  toFinancialStatementParams,
  toHistoricalStockPricesParams,
  toHolderInfoParams,
  toRecommendationsParams,
  toStockActionsParams,
  toStockInfoParams,
  toYahooFinanceNewsParams,
  yahooFinanceNewsInputSchema,
} from "./schema.js";

const tool = defineServiceTool<ServiceRegistry>();

export const yahooFinanceTools = [
  tool({
    name: "get_historical_stock_prices",
    description: "Get historical OHLCV stock prices from Yahoo Finance. Use narrower date ranges and larger intervals to reduce response size.",
    inputSchema: historicalStockPricesInputSchema,
    run(args, { yahooFinanceService }) {
      return yahooFinanceService.getHistoricalStockPrices(toHistoricalStockPricesParams(args));
    },
  }),
  tool({
    name: "get_stock_info",
    description: "Get current stock info, valuation, profile, and key statistics from Yahoo Finance.",
    inputSchema: stockInfoInputSchema,
    run(args, { yahooFinanceService }) {
      return yahooFinanceService.getStockInfo(toStockInfoParams(args));
    },
  }),
  tool({
    name: "get_yahoo_finance_news",
    description: "Search Yahoo Finance news by symbol or company name. Defaults are intentionally small to reduce latency and token usage.",
    inputSchema: yahooFinanceNewsInputSchema,
    run(args, { yahooFinanceService }) {
      return yahooFinanceService.getYahooFinanceNews(toYahooFinanceNewsParams(args));
    },
  }),
  tool({
    name: "get_stock_actions",
    description: "Get dividend and split history for a stock over a date range.",
    inputSchema: stockActionsInputSchema,
    run(args, { yahooFinanceService }) {
      return yahooFinanceService.getStockActions(toStockActionsParams(args));
    },
  }),
  tool({
    name: "get_financial_statement",
    description: "Get time-series financial statements from Yahoo Finance. Defaults are capped to recent rows to keep payloads small.",
    inputSchema: financialStatementInputSchema,
    run(args, { yahooFinanceService }) {
      return yahooFinanceService.getFinancialStatement(toFinancialStatementParams(args));
    },
  }),
  tool({
    name: "get_holder_info",
    description: "Get institutional, fund, insider, and major holder ownership data for a stock.",
    inputSchema: holderInfoInputSchema,
    run(args, { yahooFinanceService }) {
      return yahooFinanceService.getHolderInfo(toHolderInfoParams(args));
    },
  }),
  tool({
    name: "get_recommendations",
    description: "Get Yahoo Finance related-stock recommendations for a symbol.",
    inputSchema: recommendationsInputSchema,
    run(args, { yahooFinanceService }) {
      return yahooFinanceService.getRecommendations(toRecommendationsParams(args));
    },
  }),
];
