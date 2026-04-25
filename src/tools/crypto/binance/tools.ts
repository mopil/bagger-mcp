import { defineServiceTool } from "../../defineTool.js";
import type { ServiceRegistry } from "../../../mcp/services.js";
import {
  binanceGetKlinesInputSchema,
  binanceGetTickerInputSchema,
  binanceListSymbolsInputSchema,
} from "./schema.js";

const tool = defineServiceTool<ServiceRegistry>();

const RATE_LIMIT_NOTE =
  "[Public API — weight-based rate limit (1200/min per IP). Batch via multi-symbol params; avoid loops.]";

export const binanceTools = [
  tool({
    name: "binance_list_symbols",
    description: `${RATE_LIMIT_NOTE} List all SPOT trading symbols on Binance with status, baseAsset, quoteAsset. Cached for 1 hour. Use to resolve symbols (e.g. find all USDT pairs) before calling other Binance tools.`,
    inputSchema: binanceListSymbolsInputSchema,
    run(_args, { binanceService }) {
      return binanceService.listSymbols();
    },
  }),
  tool({
    name: "binance_get_ticker",
    description: `${RATE_LIMIT_NOTE} Get 24hr rolling stats for one or more Binance SPOT symbols in a SINGLE call (pass all symbols in one array — do NOT loop per symbol). Returns priceChange, priceChangePercent, weightedAvgPrice, last/bid/ask, 24h volume (base/quote), high/low.`,
    inputSchema: binanceGetTickerInputSchema,
    run(args, { binanceService }) {
      return binanceService.getTicker(args);
    },
  }),
  tool({
    name: "binance_get_klines",
    description: `${RATE_LIMIT_NOTE} Get OHLCV klines for a Binance SPOT symbol. interval is '1h','4h','day','week','month' (mapped to Binance 1h/4h/1d/1w/1M). Up to 1000 klines per call. Use startTime/endTime (ms epoch) to paginate. Note: each symbol needs its own call. Returns rows with named fields (open_time, open, high, low, close, volume, close_time, quote_volume, trades, taker_buy_base_volume, taker_buy_quote_volume) instead of Binance's positional array.`,
    inputSchema: binanceGetKlinesInputSchema,
    run(args, { binanceService }) {
      return binanceService.getKlines(args);
    },
  }),
];
