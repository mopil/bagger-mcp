import { z } from "zod";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD format");
const optionalIsoDateSchema = isoDateSchema.nullish();
const optionalHandleListSchema = z.array(z.string().min(1)).max(10).nullish();
const optionalBooleanSchema = z.boolean().nullish();

export const xSearchInputSchema = {
  query: z.string().min(1),
  allowedXHandles: optionalHandleListSchema,
  excludedXHandles: optionalHandleListSchema,
  fromDate: optionalIsoDateSchema,
  toDate: optionalIsoDateSchema,
  enableImageUnderstanding: optionalBooleanSchema,
  enableVideoUnderstanding: optionalBooleanSchema,
} satisfies z.ZodRawShape;

const xSearchInputObjectSchema = z.object(xSearchInputSchema);

export type XSearchInput = z.infer<typeof xSearchInputObjectSchema>;

export interface XSearchParams {
  query: string;
  allowedXHandles?: string[];
  excludedXHandles?: string[];
  fromDate?: string;
  toDate?: string;
  enableImageUnderstanding?: boolean;
  enableVideoUnderstanding?: boolean;
}

export function toXSearchParams(input: XSearchInput): XSearchParams {
  return {
    query: input.query,
    allowedXHandles: input.allowedXHandles ?? undefined,
    excludedXHandles: input.excludedXHandles ?? undefined,
    fromDate: input.fromDate ?? undefined,
    toDate: input.toDate ?? undefined,
    enableImageUnderstanding: input.enableImageUnderstanding ?? undefined,
    enableVideoUnderstanding: input.enableVideoUnderstanding ?? undefined,
  };
}
