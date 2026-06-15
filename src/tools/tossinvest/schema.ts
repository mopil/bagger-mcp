import { z } from "zod";

const symbolSchema = z
  .string()
  .regex(/^[A-Za-z0-9.\-]+$/, "symbol은 영문/숫자/.- 만 허용");

const ymdSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜는 YYYY-MM-DD 형식 (예: 2026-06-15)");

const accountSeqSchema = z
  .number()
  .int()
  .positive()
  .optional()
  .describe(
    "조회할 계좌 일련번호(accountSeq). 생략 시 BROKERAGE(위탁) 계좌를 자동 선택. 계좌 목록은 portfolio 응답의 accounts에서 확인.",
  );

export const tossGetPortfolioInputSchema = {
  account_seq: accountSeqSchema,
  symbol: symbolSchema
    .optional()
    .describe("특정 종목만 조회할 때 종목코드 (예: '005930', 'AAPL'). 생략 시 전체 보유종목."),
} satisfies z.ZodRawShape;

export const tossListOrdersInputSchema = {
  status: z
    .enum(["OPEN", "CLOSED"])
    .describe("OPEN: 미체결/접수 주문, CLOSED: 체결·취소 완료된 주문(체결 내역). 집행 측정엔 CLOSED."),
  symbol: symbolSchema.optional().describe("특정 종목으로 필터 (선택)."),
  from: ymdSchema.optional().describe("조회 시작일 YYYY-MM-DD (KST). CLOSED에만 유효."),
  to: ymdSchema.optional().describe("조회 종료일 YYYY-MM-DD (KST). CLOSED에만 유효."),
  cursor: z.string().optional().describe("다음 페이지 커서(직전 응답의 nextCursor). OPEN은 무시됨."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("페이지당 주문 수 (1~100, 기본 20)."),
  account_seq: accountSeqSchema,
} satisfies z.ZodRawShape;

export const tossGetBuyableAmountInputSchema = {
  currency: z
    .enum(["KRW", "USD"])
    .default("KRW")
    .describe("현금 기반 주문가능금액을 조회할 통화. KRW 국내, USD 해외. 기본 KRW."),
  account_seq: accountSeqSchema,
} satisfies z.ZodRawShape;

export const tossGetSellableQuantityInputSchema = {
  symbol: symbolSchema.describe("매도가능수량을 조회할 종목코드 (예: '005930', 'AAPL')."),
  account_seq: accountSeqSchema,
} satisfies z.ZodRawShape;

export const tossGetStockInfoInputSchema = {
  symbols: z
    .array(symbolSchema)
    .min(1)
    .max(200)
    .describe("종목코드 배열 (최대 200). 예: ['005930', 'AAPL']."),
  include_warnings: z
    .boolean()
    .default(false)
    .describe(
      "true면 종목별 투자경고/거래정지/VI 등 warning도 병렬 조회(symbols 최대 20개로 제한). 진입 게이트 위험종목 필터용.",
    ),
} satisfies z.ZodRawShape;

export const tossGetExchangeRateInputSchema = {
  base_currency: z
    .enum(["KRW", "USD"])
    .default("USD")
    .describe("기준통화. 기본 USD (USD/KRW 환율)."),
  quote_currency: z.enum(["KRW", "USD"]).default("KRW").describe("상대통화. 기본 KRW."),
  date_time: z.string().optional().describe("기준 시각 ISO 8601 (선택). 생략 시 최신."),
} satisfies z.ZodRawShape;

export const tossGetMarketCalendarInputSchema = {
  country: z.enum(["KR", "US"]).default("KR").describe("시장 국가. KR 국내, US 해외."),
  date: ymdSchema.optional().describe("기준일 YYYY-MM-DD (선택). 생략 시 오늘."),
} satisfies z.ZodRawShape;

export type TossGetPortfolioInput = z.infer<z.ZodObject<typeof tossGetPortfolioInputSchema>>;
export type TossListOrdersInput = z.infer<z.ZodObject<typeof tossListOrdersInputSchema>>;
export type TossGetBuyableAmountInput = z.infer<z.ZodObject<typeof tossGetBuyableAmountInputSchema>>;
export type TossGetSellableQuantityInput = z.infer<
  z.ZodObject<typeof tossGetSellableQuantityInputSchema>
>;
export type TossGetStockInfoInput = z.infer<z.ZodObject<typeof tossGetStockInfoInputSchema>>;
export type TossGetExchangeRateInput = z.infer<z.ZodObject<typeof tossGetExchangeRateInputSchema>>;
export type TossGetMarketCalendarInput = z.infer<
  z.ZodObject<typeof tossGetMarketCalendarInputSchema>
>;
