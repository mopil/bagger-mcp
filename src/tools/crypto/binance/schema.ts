import { z } from "zod";

const symbolSchema = z
  .string()
  .regex(/^[A-Z0-9]+$/, "symbol must be uppercase alnum like BTCUSDT, 1INCHUSDT");

const symbolsSchema = z
  .array(symbolSchema)
  .min(1, "at least one symbol is required")
  .max(100, "at most 100 symbols per request");

export const binanceListSymbolsInputSchema = {} satisfies z.ZodRawShape;

export const binanceGetTickerInputSchema = {
  symbols: symbolsSchema.describe(
    "List of symbols (no separator). e.g. ['BTCUSDT','ETHUSDT'].",
  ),
} satisfies z.ZodRawShape;

export const binanceKlineIntervalSchema = z.enum(["1h", "4h", "day", "week", "month"]);
export type BinanceKlineInterval = z.infer<typeof binanceKlineIntervalSchema>;

export const binanceGetKlinesInputSchema = {
  symbol: symbolSchema.describe("Symbol with no separator, e.g. 'BTCUSDT'."),
  interval: binanceKlineIntervalSchema.describe(
    "Candle interval. '1h'/'4h'/'day'/'week'/'month' map to Binance 1h/4h/1d/1w/1M.",
  ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("Number of klines to fetch (1-1000, default 500)."),
  startTime: z
    .number()
    .int()
    .optional()
    .describe("Start time in milliseconds since epoch (UTC). Optional."),
  endTime: z
    .number()
    .int()
    .optional()
    .describe("End time in milliseconds since epoch (UTC). Optional. Omit for latest."),
} satisfies z.ZodRawShape;

export type BinanceGetTickerInput = z.infer<z.ZodObject<typeof binanceGetTickerInputSchema>>;
export type BinanceGetKlinesInput = z.infer<z.ZodObject<typeof binanceGetKlinesInputSchema>>;
