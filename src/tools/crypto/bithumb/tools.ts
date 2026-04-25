import { defineServiceTool } from "../../defineTool.js";
import type { ServiceRegistry } from "../../../mcp/services.js";
import {
  bithumbGetCandlesInputSchema,
  bithumbGetTickerInputSchema,
  bithumbListMarketsInputSchema,
} from "./schema.js";

const tool = defineServiceTool<ServiceRegistry>();

const RATE_LIMIT_NOTE =
  "[Public API — rate-limited per IP. Batch via multi-market params; avoid loops.]";

export const bithumbTools = [
  tool({
    name: "bithumb_list_markets",
    description: `${RATE_LIMIT_NOTE} List every market code on Bithumb (KRW/BTC) with Korean/English names and warning flags. Cached for 1 hour. Use to resolve symbols before calling other Bithumb tools.`,
    inputSchema: bithumbListMarketsInputSchema,
    run(_args, { bithumbService }) {
      return bithumbService.listMarkets();
    },
  }),
  tool({
    name: "bithumb_get_ticker",
    description: `${RATE_LIMIT_NOTE} Get current price snapshot for one or more Bithumb markets in a SINGLE call (pass all markets in one array — do NOT loop per symbol). Returns trade_price, change, 24h volume, 52w high/low. Useful for cross-checking Upbit prices (KR exchange spread).`,
    inputSchema: bithumbGetTickerInputSchema,
    run(args, { bithumbService }) {
      return bithumbService.getTicker(args);
    },
  }),
  tool({
    name: "bithumb_get_candles",
    description: `${RATE_LIMIT_NOTE} Get OHLCV candles for a single Bithumb market. interval is one of '1h','4h','day','week','month'. Up to 200 candles per call. Use 'to' (ISO 8601 or 'yyyy-MM-dd HH:mm:ss' KST) to paginate backward. Note: each market needs its own call.`,
    inputSchema: bithumbGetCandlesInputSchema,
    run(args, { bithumbService }) {
      return bithumbService.getCandles(args);
    },
  }),
];
