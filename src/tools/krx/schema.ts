import { z } from "zod";

const basDdSchema = z
  .string()
  .regex(/^\d{8}$/, "basDd must be YYYYMMDD (8 digits)");

export const krxDailyInputSchema = {
  basDd: basDdSchema,
} satisfies z.ZodRawShape;

const krxDailyInputObjectSchema = z.object(krxDailyInputSchema);

export type KrxDailyInput = z.infer<typeof krxDailyInputObjectSchema>;

export interface KrxDailyParams {
  basDd: string;
}

export function toKrxDailyParams(input: KrxDailyInput): KrxDailyParams {
  return { basDd: input.basDd };
}
