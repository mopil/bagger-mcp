import { z } from "zod";

const optionalString = z.string().min(1).nullish();

export const memoryListInputSchema = {
  path: optionalString,
} satisfies z.ZodRawShape;

export const memoryReadInputSchema = {
  path: z.string().min(1),
} satisfies z.ZodRawShape;

export const memorySearchInputSchema = {
  query: z.string().min(1),
  extension: optionalString,
  path: optionalString,
} satisfies z.ZodRawShape;

export const memoryCaptureInputSchema = {
  slug: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9][a-z0-9\-_가-힣]*$/,
      "slug must be kebab-case (lowercase alphanumeric, hyphen, underscore; Korean allowed). No spaces, no leading date — date is added automatically.",
    ),
  content: z.string().min(1),
  origin: z.enum(["conversation", "paste", "url", "file"]),
  context: z.string().min(1).max(200),
  url: optionalString,
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .nullish(),
} satisfies z.ZodRawShape;

export const decisionLogAppendInputSchema = {
  ticker: z.string().min(1).max(40),
  action: z.enum(["enter", "addbuy", "trim", "exit", "size-up", "size-down"]),
  size: optionalString,
  trigger: z.enum(["event", "chart", "news", "impulse", "scheduled"]).nullish(),
  // Which entry gates passed → measures 진입 게이트 통과율 (entry/addbuy).
  gate: z.array(z.enum(["memo3", "chart", "funda"])).nullish(),
  // Hard floor, e.g. "$X(-8%)" or "-7%".
  stop: optionalString,
  // Time stop, e.g. "6w".
  tstop: optionalString,
  // How the stop was executed on exit → measures 손절 집행률 (the key weakness metric).
  executed: z.enum(["mech", "discretionary", "skipped"]).nullish(),
  // Realized P&L on exit, e.g. "-7.4%" or "+76.7만".
  pnl: optionalString,
  // Principle ids invoked for this decision.
  principles: z.array(z.string().min(1)).nullish(),
  // 3-line entry memo summary (논거 / 손절 / 손절 시 반응).
  memo: z.string().min(1).max(400).nullish(),
  result: z.enum(["tbd", "win", "loss", "breakeven", "rule-violated"]).nullish(),
  // Defaults to KST now; pass only to override.
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .nullish(),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "time must be HH:MM")
    .nullish(),
} satisfies z.ZodRawShape;
