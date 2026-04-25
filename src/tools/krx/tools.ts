import { defineServiceTool } from "../defineTool.js";
import type { ServiceRegistry } from "../../mcp/services.js";
import { krxDailyInputSchema, toKrxDailyParams } from "./schema.js";

const tool = defineServiceTool<ServiceRegistry>();

export const krxTools = [
  tool({
    name: "krx_get_kospi_index_daily",
    description:
      "Get all KOSPI-family index quotes (KOSPI, KOSPI200, sector indices, etc.) for a single trading day. basDd is YYYYMMDD. Returns empty rows on market holidays.",
    inputSchema: krxDailyInputSchema,
    run(args, { krxService }) {
      return krxService.getKospiIndexDaily(toKrxDailyParams(args));
    },
  }),
  tool({
    name: "krx_get_kosdaq_index_daily",
    description:
      "Get all KOSDAQ-family index quotes (KOSDAQ Composite, KOSDAQ150, Star, sector indices) for a single trading day. basDd is YYYYMMDD.",
    inputSchema: krxDailyInputSchema,
    run(args, { krxService }) {
      return krxService.getKosdaqIndexDaily(toKrxDailyParams(args));
    },
  }),
  tool({
    name: "krx_get_stock_daily_kospi",
    description:
      "Get end-of-day OHLCV, change %, market cap, and shares outstanding for every KOSPI-listed stock on a given trading day. Use for full-market screening. basDd is YYYYMMDD.",
    inputSchema: krxDailyInputSchema,
    run(args, { krxService }) {
      return krxService.getStockDailyKospi(toKrxDailyParams(args));
    },
  }),
  tool({
    name: "krx_get_stock_daily_kosdaq",
    description:
      "Get end-of-day trading data for every KOSDAQ-listed stock on a given trading day, including market segment (Venture/Premier/Middle/Technology Growth). basDd is YYYYMMDD.",
    inputSchema: krxDailyInputSchema,
    run(args, { krxService }) {
      return krxService.getStockDailyKosdaq(toKrxDailyParams(args));
    },
  }),
  tool({
    name: "krx_get_stock_base_info_kospi",
    description:
      "Get static metadata for every KOSPI-listed issue (code, name, listing date, security type, segment, par value, shares outstanding). No price data. Use to cache the symbol universe.",
    inputSchema: krxDailyInputSchema,
    run(args, { krxService }) {
      return krxService.getStockBaseInfoKospi(toKrxDailyParams(args));
    },
  }),
  tool({
    name: "krx_get_stock_base_info_kosdaq",
    description:
      "Get static metadata for every KOSDAQ-listed issue (code, name, listing date, security type, segment, par value, shares outstanding). No price data.",
    inputSchema: krxDailyInputSchema,
    run(args, { krxService }) {
      return krxService.getStockBaseInfoKosdaq(toKrxDailyParams(args));
    },
  }),
  tool({
    name: "krx_get_etf_daily",
    description:
      "Get end-of-day data for every Korean ETF including NAV, AUM, and tracked underlying index. Use to analyze NAV-price premium/discount and asset-flow trends. basDd is YYYYMMDD.",
    inputSchema: krxDailyInputSchema,
    run(args, { krxService }) {
      return krxService.getEtfDaily(toKrxDailyParams(args));
    },
  }),
];
