import { defineServiceTool } from "../../defineTool.js";
import type { ServiceRegistry } from "../../../mcp/services.js";
import {
  coingeckoGlobalInputSchema,
  coingeckoListCategoriesInputSchema,
  coingeckoListMarketsInputSchema,
  coingeckoSimplePriceInputSchema,
  coingeckoTrendingInputSchema,
} from "./schema.js";

const tool = defineServiceTool<ServiceRegistry>();

const RATE_LIMIT_NOTE =
  "[Public API — STRICT 30 req/min hard cap (free tier). Server throttles to ~27/min and caches; AVOID per-coin loops, batch ids in one call.]";

export const coingeckoTools = [
  tool({
    name: "coingecko_list_coins_markets",
    description: `${RATE_LIMIT_NOTE} Top coins by market cap with price, volume, and multi-period change %. Supports filtering by category id (e.g. 'artificial-intelligence') and explicit ids list. Use price_change_percentage='1h,24h,7d,30d' for momentum analysis. Cached 60s per param set.`,
    inputSchema: coingeckoListMarketsInputSchema,
    run(args, { coingeckoService }) {
      return coingeckoService.listCoinsMarkets(args);
    },
  }),
  tool({
    name: "coingecko_get_simple_price",
    description: `${RATE_LIMIT_NOTE} Get current prices for many coins in many currencies in a SINGLE call. Pass all coin ids in 'ids' and all quote currencies in 'vs_currencies' (e.g. ['usd','krw']) — do NOT loop. No cache (real-time).`,
    inputSchema: coingeckoSimplePriceInputSchema,
    run(args, { coingeckoService }) {
      return coingeckoService.getSimplePrice(args);
    },
  }),
  tool({
    name: "coingecko_get_global",
    description: `${RATE_LIMIT_NOTE} Global crypto market metrics: total market cap, 24h volume, BTC dominance, ETH dominance, active cryptocurrencies. Cached 60s.`,
    inputSchema: coingeckoGlobalInputSchema,
    run(_args, { coingeckoService }) {
      return coingeckoService.getGlobal();
    },
  }),
  tool({
    name: "coingecko_search_trending",
    description: `${RATE_LIMIT_NOTE} Top trending coins/NFTs/categories on CoinGecko (search-volume based). Use to spot what retail is searching right now. Cached 5min.`,
    inputSchema: coingeckoTrendingInputSchema,
    run(_args, { coingeckoService }) {
      return coingeckoService.getTrending();
    },
  }),
  tool({
    name: "coingecko_list_categories",
    description: `${RATE_LIMIT_NOTE} List all coin categories (AI, RWA, DePIN, Memecoin, Korean Coins, etc.) with market cap, 24h volume, top coins, and 24h market cap change. Cached 10min. Use the returned 'id' to filter coingecko_list_coins_markets by category.`,
    inputSchema: coingeckoListCategoriesInputSchema,
    run(args, { coingeckoService }) {
      return coingeckoService.listCategories(args);
    },
  }),
];
