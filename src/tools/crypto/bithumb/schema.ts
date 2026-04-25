import { z } from "zod";

const marketSchema = z
  .string()
  .regex(/^[A-Z]+-[A-Z0-9]+$/, "market must look like KRW-BTC, BTC-ETH");

const marketsSchema = z
  .array(marketSchema)
  .min(1, "at least one market is required")
  .max(100, "at most 100 markets per request");

const countSchema = z
  .number()
  .int()
  .min(1)
  .max(200)
  .optional()
  .describe("Number of candles to fetch (1-200, default 200).");

const toSchema = z
  .string()
  .optional()
  .describe(
    "End time (exclusive). ISO 8601 like '2026-04-26T00:00:00Z' or 'yyyy-MM-dd HH:mm:ss' (KST). Omit for latest.",
  );

export const bithumbListMarketsInputSchema = {} satisfies z.ZodRawShape;

export const bithumbGetTickerInputSchema = {
  markets: marketsSchema.describe("List of market codes, e.g. ['KRW-BTC','KRW-ETH']."),
} satisfies z.ZodRawShape;

export const bithumbCandleIntervalSchema = z.enum(["1h", "4h", "day", "week", "month"]);
export type BithumbCandleInterval = z.infer<typeof bithumbCandleIntervalSchema>;

export const bithumbGetCandlesInputSchema = {
  market: marketSchema.describe("Market code, e.g. 'KRW-BTC'."),
  interval: bithumbCandleIntervalSchema.describe(
    "Candle interval. '1h'/'4h' map to minute candles (60/240); 'day'/'week'/'month' to their own endpoints.",
  ),
  count: countSchema,
  to: toSchema,
} satisfies z.ZodRawShape;

export type BithumbGetTickerInput = z.infer<z.ZodObject<typeof bithumbGetTickerInputSchema>>;
export type BithumbGetCandlesInput = z.infer<z.ZodObject<typeof bithumbGetCandlesInputSchema>>;
