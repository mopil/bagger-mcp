import { z } from "zod";

const coinIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/, "coin id must be lowercase alnum/dash like 'bitcoin','ethereum','pepe'");

const vsCurrencySchema = z
  .string()
  .regex(/^[a-z]{3,10}$/, "vs_currency must be lowercase like 'usd','krw','btc'");

export const coingeckoListMarketsInputSchema = {
  vs_currency: vsCurrencySchema
    .default("usd")
    .describe("Quote currency (lowercase). Default 'usd'."),
  ids: z
    .array(coinIdSchema)
    .max(100)
    .optional()
    .describe("Filter by coin ids. Use coingecko_get_simple_price if you only need prices."),
  category: z
    .string()
    .optional()
    .describe("Filter by CoinGecko category id (e.g. 'artificial-intelligence', 'real-world-assets-rwa'). Use coingecko_list_categories to discover ids."),
  order: z
    .enum([
      "market_cap_desc",
      "market_cap_asc",
      "volume_desc",
      "volume_asc",
      "id_asc",
      "id_desc",
    ])
    .default("market_cap_desc")
    .describe("Sort order. Default market_cap_desc (top by market cap)."),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(250)
    .default(100)
    .describe("Results per page (1-250)."),
  page: z.number().int().min(1).default(1).describe("Page number."),
  price_change_percentage: z
    .string()
    .regex(/^(1h|24h|7d|14d|30d|200d|1y)(,(1h|24h|7d|14d|30d|200d|1y))*$/)
    .optional()
    .describe("Comma-separated change windows. Allowed: 1h,24h,7d,14d,30d,200d,1y. e.g. '1h,24h,7d,30d'."),
} satisfies z.ZodRawShape;

export const coingeckoSimplePriceInputSchema = {
  ids: z
    .array(coinIdSchema)
    .min(1)
    .max(250)
    .describe("Coin ids, e.g. ['bitcoin','ethereum','pepe']."),
  vs_currencies: z
    .array(vsCurrencySchema)
    .min(1)
    .max(20)
    .default(["usd"])
    .describe("Quote currencies, e.g. ['usd','krw']."),
  include_market_cap: z.boolean().optional(),
  include_24hr_vol: z.boolean().optional(),
  include_24hr_change: z.boolean().optional(),
  include_last_updated_at: z.boolean().optional(),
} satisfies z.ZodRawShape;

export const coingeckoGlobalInputSchema = {} satisfies z.ZodRawShape;

export const coingeckoTrendingInputSchema = {} satisfies z.ZodRawShape;

export const coingeckoListCategoriesInputSchema = {
  order: z
    .enum([
      "market_cap_desc",
      "market_cap_asc",
      "name_desc",
      "name_asc",
      "market_cap_change_24h_desc",
      "market_cap_change_24h_asc",
    ])
    .default("market_cap_desc")
    .describe("Sort categories by this field. Default market_cap_desc."),
} satisfies z.ZodRawShape;

export type CoingeckoListMarketsInput = z.infer<z.ZodObject<typeof coingeckoListMarketsInputSchema>>;
export type CoingeckoSimplePriceInput = z.infer<z.ZodObject<typeof coingeckoSimplePriceInputSchema>>;
export type CoingeckoListCategoriesInput = z.infer<z.ZodObject<typeof coingeckoListCategoriesInputSchema>>;
