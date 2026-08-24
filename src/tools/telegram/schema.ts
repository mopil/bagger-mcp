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

export const TELEGRAM_MESSAGE_MAX_LENGTH = 40_000;

export const telegramSendMessageInputSchema = {
  text: z.string().min(1).max(TELEGRAM_MESSAGE_MAX_LENGTH),
  target: optionalStringSchema,
  silent: z.boolean().nullish(),
  /**
   * "account"(기본): 설정된 사용자 세션으로 발송. 내가 보낸 메시지라 나에게 알림이 오지 않는다.
   * "bot": TELEGRAM_BOT_TOKEN 봇으로 발송. 나에게는 수신 메시지가 되므로 알림이 온다.
   */
  via: z.enum(["account", "bot"]).nullish(),
} satisfies z.ZodRawShape;

const telegramListChannelsObjectSchema = z.object(telegramListChannelsInputSchema);
const telegramReadChannelsObjectSchema = z.object(telegramReadChannelsInputSchema);
const telegramSendMessageObjectSchema = z.object(telegramSendMessageInputSchema);

export type TelegramListChannelsInput = z.infer<typeof telegramListChannelsObjectSchema>;
export type TelegramReadChannelsInput = z.infer<typeof telegramReadChannelsObjectSchema>;
export type TelegramSendMessageInput = z.infer<typeof telegramSendMessageObjectSchema>;

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

export type TelegramSendVia = "account" | "bot";

export interface TelegramSendMessageParams {
  text: string;
  target?: string;
  silent?: boolean;
  via?: TelegramSendVia;
}

export function toTelegramSendMessageParams(input: TelegramSendMessageInput): TelegramSendMessageParams {
  return {
    text: input.text,
    target: input.target ?? undefined,
    silent: input.silent ?? undefined,
    via: input.via ?? undefined,
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
