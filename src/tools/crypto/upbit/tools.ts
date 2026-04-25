import { defineServiceTool } from "../../defineTool.js";
import type { ServiceRegistry } from "../../../mcp/services.js";
import {
  upbitGetCandlesInputSchema,
  upbitGetTickerInputSchema,
  upbitListMarketsInputSchema,
} from "./schema.js";

const tool = defineServiceTool<ServiceRegistry>();

const RATE_LIMIT_NOTE =
  "[Public API — rate-limited to ~10 req/s per IP. Batch via multi-market params; avoid loops.]";

export const upbitTools = [
  tool({
    name: "upbit_list_markets",
    description: `${RATE_LIMIT_NOTE} List every market code on Upbit (KRW/BTC/USDT) with Korean/English names and warning flags. Cached for 1 hour. Use to resolve symbols before calling other Upbit tools.`,
    inputSchema: upbitListMarketsInputSchema,
    run(_args, { upbitService }) {
      return upbitService.listMarkets();
    },
  }),
  tool({
    name: "upbit_get_ticker",
    description: `${RATE_LIMIT_NOTE} Get current price snapshot for one or more Upbit markets in a SINGLE call (pass all markets in one array — do NOT loop per symbol). Returns trade_price, change, 24h volume, 52w high/low. Use for KRW spot prices (kimchi premium, KRW-quoted alts) that Yahoo/Crypto.com don't expose.`,
    inputSchema: upbitGetTickerInputSchema,
    run(args, { upbitService }) {
      return upbitService.getTicker(args);
    },
  }),
  tool({
    name: "upbit_get_candles",
    description: `${RATE_LIMIT_NOTE} Get OHLCV candles for a single Upbit market. interval is one of '1h','4h','day','week','month'. Up to 200 candles per call. Use 'to' (ISO 8601 or 'yyyy-MM-dd HH:mm:ss' KST) to paginate backward. Note: each market needs its own call.`,
    inputSchema: upbitGetCandlesInputSchema,
    run(args, { upbitService }) {
      return upbitService.getCandles(args);
    },
  }),
];
