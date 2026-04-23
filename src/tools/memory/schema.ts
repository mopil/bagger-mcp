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

const bulkWriteEntry = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const memoryIngestInputSchema = {
  writes: z.array(bulkWriteEntry).min(1).max(100),
  deletes: z.array(z.string().min(1)).max(100).nullish(),
  summary: z.string().min(1).max(300),
} satisfies z.ZodRawShape;

export const memoryLintInputSchema = {
  operation: z.enum(["lint", "prune", "refactor"]).nullish(),
  writes: z.array(bulkWriteEntry).max(100).nullish(),
  deletes: z.array(z.string().min(1)).max(100).nullish(),
  summary: z.string().min(1).max(300),
} satisfies z.ZodRawShape;
