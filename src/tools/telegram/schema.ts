import { z } from "zod";

const optionalStringSchema = z.string().min(1).nullish();
const optionalIntSchema = (max: number) => z.number().int().min(1).max(max).nullish();
const optionalPositiveNumberSchema = z.number().positive().nullish();
const optionalOffsetIdSchema = z.number().int().min(0).nullish();

export const telegramListChannelsInputSchema = {
  query: optionalStringSchema,
  limit: optionalIntSchema(200),
} satisfies z.ZodRawShape;

const telegramReadChannelItemSchema = z.object({
  channel: z.string().min(1),
  offsetId: optionalOffsetIdSchema,
});

export const telegramReadChannelsInputSchema = {
  channels: z.array(telegramReadChannelItemSchema).min(1).max(50),
  hours: optionalPositiveNumberSchema,
  limit: optionalIntSchema(200),
} satisfies z.ZodRawShape;

const telegramListChannelsObjectSchema = z.object(telegramListChannelsInputSchema);
const telegramReadChannelsObjectSchema = z.object(telegramReadChannelsInputSchema);

export type TelegramListChannelsInput = z.infer<typeof telegramListChannelsObjectSchema>;
export type TelegramReadChannelsInput = z.infer<typeof telegramReadChannelsObjectSchema>;

export interface TelegramListDialogsParams {
  query?: string;
  limit?: number;
}

export interface TelegramReadChannelsParams {
  channels: Array<{
    channel: string;
    offsetId?: number;
  }>;
  hours?: number;
  limit?: number;
}

export function toTelegramListDialogsParams(input: TelegramListChannelsInput): TelegramListDialogsParams {
  return {
    query: input.query ?? undefined,
    limit: input.limit ?? undefined,
  };
}

export function toTelegramReadChannelsParams(input: TelegramReadChannelsInput): TelegramReadChannelsParams {
  return {
    channels: input.channels.map((item) => ({
      channel: item.channel,
      offsetId: item.offsetId ?? undefined,
    })),
    hours: input.hours ?? undefined,
    limit: input.limit ?? undefined,
  };
}
