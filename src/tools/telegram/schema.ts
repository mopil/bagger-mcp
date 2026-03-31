import { z } from "zod";

const optionalStringSchema = z.string().min(1).nullish();
const optionalIntSchema = (max: number) => z.number().int().min(1).max(max).nullish();
const optionalPositiveNumberSchema = z.number().positive().nullish();
const optionalOffsetIdSchema = z.number().int().min(0).nullish();

export const telegramListChannelsInputSchema = {
  query: optionalStringSchema,
  limit: optionalIntSchema(200),
} satisfies z.ZodRawShape;

export const telegramReadChannelInputSchema = {
  channel: z.string().min(1),
  hours: optionalPositiveNumberSchema,
  limit: optionalIntSchema(200),
  offsetId: optionalOffsetIdSchema,
} satisfies z.ZodRawShape;

const telegramListChannelsObjectSchema = z.object(telegramListChannelsInputSchema);
const telegramReadChannelObjectSchema = z.object(telegramReadChannelInputSchema);

export type TelegramListChannelsInput = z.infer<typeof telegramListChannelsObjectSchema>;
export type TelegramReadChannelInput = z.infer<typeof telegramReadChannelObjectSchema>;

export interface TelegramListDialogsParams {
  query?: string;
  limit?: number;
}

export interface TelegramReadChannelParams {
  channel: string;
  hours?: number;
  limit?: number;
  offsetId?: number;
}

export function toTelegramListDialogsParams(input: TelegramListChannelsInput): TelegramListDialogsParams {
  return {
    query: input.query ?? undefined,
    limit: input.limit ?? undefined,
  };
}

export function toTelegramReadChannelParams(input: TelegramReadChannelInput): TelegramReadChannelParams {
  return {
    channel: input.channel,
    hours: input.hours ?? undefined,
    limit: input.limit ?? undefined,
    offsetId: input.offsetId ?? undefined,
  };
}
