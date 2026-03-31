import { z } from "zod";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD format");
const intervalSchema = z.enum(["1d", "1wk", "1mo"]);
const statementTypeSchema = z.enum(["income_statement", "balance_sheet", "cash_flow"]);
const statementFrequencySchema = z.enum(["quarterly", "annual", "trailing"]);
const optionalIsoDateSchema = isoDateSchema.nullish();
const optionalIntervalSchema = intervalSchema.nullish();
const optionalStatementFrequencySchema = statementFrequencySchema.nullish();
const optionalLimitSchema = (max: number) => z.number().int().min(1).max(max).nullish();

export const historicalStockPricesInputSchema = {
  symbol: z.string().min(1),
  fromDate: isoDateSchema,
  toDate: optionalIsoDateSchema,
  interval: optionalIntervalSchema,
  limit: optionalLimitSchema(1000),
} satisfies z.ZodRawShape;

export const stockInfoInputSchema = {
  symbol: z.string().min(1),
} satisfies z.ZodRawShape;

export const yahooFinanceNewsInputSchema = {
  query: z.string().min(1),
  newsCount: optionalLimitSchema(20),
} satisfies z.ZodRawShape;

export const stockActionsInputSchema = {
  symbol: z.string().min(1),
  fromDate: isoDateSchema,
  toDate: optionalIsoDateSchema,
  limit: optionalLimitSchema(200),
} satisfies z.ZodRawShape;

export const financialStatementInputSchema = {
  symbol: z.string().min(1),
  statementType: statementTypeSchema,
  frequency: optionalStatementFrequencySchema,
  fromDate: isoDateSchema,
  toDate: optionalIsoDateSchema,
  limit: optionalLimitSchema(40),
} satisfies z.ZodRawShape;

export const holderInfoInputSchema = {
  symbol: z.string().min(1),
} satisfies z.ZodRawShape;

export const recommendationsInputSchema = {
  symbol: z.string().min(1),
} satisfies z.ZodRawShape;

const historicalStockPricesInputObjectSchema = z.object(historicalStockPricesInputSchema);
const stockInfoInputObjectSchema = z.object(stockInfoInputSchema);
const yahooFinanceNewsInputObjectSchema = z.object(yahooFinanceNewsInputSchema);
const stockActionsInputObjectSchema = z.object(stockActionsInputSchema);
const financialStatementInputObjectSchema = z.object(financialStatementInputSchema);
const holderInfoInputObjectSchema = z.object(holderInfoInputSchema);
const recommendationsInputObjectSchema = z.object(recommendationsInputSchema);

export type HistoricalStockPricesInput = z.infer<typeof historicalStockPricesInputObjectSchema>;
export type StockInfoInput = z.infer<typeof stockInfoInputObjectSchema>;
export type YahooFinanceNewsInput = z.infer<typeof yahooFinanceNewsInputObjectSchema>;
export type StockActionsInput = z.infer<typeof stockActionsInputObjectSchema>;
export type FinancialStatementInput = z.infer<typeof financialStatementInputObjectSchema>;
export type HolderInfoInput = z.infer<typeof holderInfoInputObjectSchema>;
export type RecommendationsInput = z.infer<typeof recommendationsInputObjectSchema>;

export interface HistoricalStockPricesParams {
  symbol: string;
  fromDate: string;
  toDate?: string;
  interval?: "1d" | "1wk" | "1mo";
  limit?: number;
}

export interface StockInfoParams {
  symbol: string;
}

export interface YahooFinanceNewsParams {
  query: string;
  newsCount?: number;
}

export interface StockActionsParams {
  symbol: string;
  fromDate: string;
  toDate?: string;
  limit?: number;
}

export interface FinancialStatementParams {
  symbol: string;
  statementType: "income_statement" | "balance_sheet" | "cash_flow";
  frequency?: "quarterly" | "annual" | "trailing";
  fromDate: string;
  toDate?: string;
  limit?: number;
}

export interface HolderInfoParams {
  symbol: string;
}

export interface RecommendationsParams {
  symbol: string;
}

export function toHistoricalStockPricesParams(input: HistoricalStockPricesInput): HistoricalStockPricesParams {
  return {
    symbol: input.symbol,
    fromDate: input.fromDate,
    toDate: input.toDate ?? undefined,
    interval: input.interval ?? undefined,
    limit: input.limit ?? undefined,
  };
}

export function toStockInfoParams(input: StockInfoInput): StockInfoParams {
  return {
    symbol: input.symbol,
  };
}

export function toYahooFinanceNewsParams(input: YahooFinanceNewsInput): YahooFinanceNewsParams {
  return {
    query: input.query,
    newsCount: input.newsCount ?? undefined,
  };
}

export function toStockActionsParams(input: StockActionsInput): StockActionsParams {
  return {
    symbol: input.symbol,
    fromDate: input.fromDate,
    toDate: input.toDate ?? undefined,
    limit: input.limit ?? undefined,
  };
}

export function toFinancialStatementParams(input: FinancialStatementInput): FinancialStatementParams {
  return {
    symbol: input.symbol,
    statementType: input.statementType,
    frequency: input.frequency ?? undefined,
    fromDate: input.fromDate,
    toDate: input.toDate ?? undefined,
    limit: input.limit ?? undefined,
  };
}

export function toHolderInfoParams(input: HolderInfoInput): HolderInfoParams {
  return {
    symbol: input.symbol,
  };
}

export function toRecommendationsParams(input: RecommendationsInput): RecommendationsParams {
  return {
    symbol: input.symbol,
  };
}
