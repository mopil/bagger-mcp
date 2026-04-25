import { defineServiceTool } from "../defineTool.js";
import type { ServiceRegistry } from "../../mcp/services.js";
import {
  bithumbGetCandlesInputSchema,
  bithumbGetTickerInputSchema,
  bithumbListMarketsInputSchema,
} from "./schema.js";

const tool = defineServiceTool<ServiceRegistry>();

export const bithumbTools = [
  tool({
    name: "bithumb_list_markets",
    description:
      "List every market code on Bithumb (KRW/BTC) with Korean/English names and warning flags. Cached for 1 hour. Use to resolve symbols before calling other Bithumb tools.",
    inputSchema: bithumbListMarketsInputSchema,
    run(_args, { bithumbService }) {
      return bithumbService.listMarkets();
    },
  }),
  tool({
    name: "bithumb_get_ticker",
    description:
      "Get current price snapshot for one or more Bithumb markets in a single call. Returns trade_price, change, 24h volume, 52w high/low, etc. Useful for cross-checking Upbit prices (kimchi spread between KR exchanges).",
    inputSchema: bithumbGetTickerInputSchema,
    run(args, { bithumbService }) {
      return bithumbService.getTicker(args);
    },
  }),
  tool({
    name: "bithumb_get_candles",
    description:
      "Get OHLCV candles for a single Bithumb market. interval is one of '1h','4h','day','week','month'. Up to 200 candles per call. Use 'to' (ISO 8601 or 'yyyy-MM-dd HH:mm:ss' KST) to paginate backward.",
    inputSchema: bithumbGetCandlesInputSchema,
    run(args, { bithumbService }) {
      return bithumbService.getCandles(args);
    },
  }),
];
