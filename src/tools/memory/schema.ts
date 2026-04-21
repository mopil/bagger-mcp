import { z } from "zod";

const optionalString = z.string().min(1).nullish();

export const memoryListInputSchema = {
  path: optionalString,
} satisfies z.ZodRawShape;

export const memoryReadInputSchema = {
  path: z.string().min(1),
} satisfies z.ZodRawShape;

export const memoryWriteInputSchema = {
  path: z.string().min(1),
  content: z.string(),
  commit_message: z.string().min(1),
} satisfies z.ZodRawShape;

export const memoryDeleteInputSchema = {
  path: z.string().min(1),
  commit_message: z.string().min(1),
} satisfies z.ZodRawShape;

export const memorySearchInputSchema = {
  query: z.string().min(1),
  extension: optionalString,
  path: optionalString,
} satisfies z.ZodRawShape;
