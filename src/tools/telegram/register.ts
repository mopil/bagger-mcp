import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { TelegramService } from "./service.js";

const DIALOG_TEXT_PREVIEW_LIMIT = 10;
const MESSAGE_TEXT_PREVIEW_LIMIT = 3;
const MESSAGE_TEXT_LINE_LIMIT = 160;
const optionalStringSchema = z.string().min(1).nullish();
const optionalIntSchema = (max: number) => z.number().int().min(1).max(max).nullish();
const optionalPositiveNumberSchema = z.number().positive().nullish();
const optionalOffsetIdSchema = z.number().int().min(0).nullish();
const optionalBooleanSchema = z.boolean().nullish();

export function registerTelegramTools(server: McpServer, telegramService: TelegramService): void {
  server.registerTool(
    "telegram_list_channels",
    {
      description: "List Telegram dialogs available to the configured session. Use query and smaller limits to narrow search and reduce response size.",
      inputSchema: {
        query: optionalStringSchema,
        limit: optionalIntSchema(200),
      },
    },
    async ({ query, limit }) => {
      const dialogs = await telegramService.listDialogs({
        query: query ?? undefined,
        limit: limit ?? undefined,
      });

      return {
        content: [
          {
            type: "text",
            text: formatDialogsText(dialogs),
          },
        ],
        structuredContent: {
          dialogs,
        },
      };
    },
  );

  server.registerTool(
    "telegram_read_channel",
    {
      description: "Read recent messages from a Telegram dialog by username, title, or numeric id. Use smaller limits and includeTextPreview=false when structuredContent is enough and you want to minimize text tokens.",
      inputSchema: {
        channel: z.string().min(1),
        hours: optionalPositiveNumberSchema,
        limit: optionalIntSchema(200),
        offsetId: optionalOffsetIdSchema,
        includeTextPreview: optionalBooleanSchema,
      },
    },
    async ({ channel, hours, limit, offsetId, includeTextPreview }) => {
      const result = await telegramService.readChannel({
        channel,
        hours: hours ?? undefined,
        limit: limit ?? undefined,
        offsetId: offsetId ?? undefined,
      });
      const shouldIncludePreview = includeTextPreview === true;

      return {
        content: shouldIncludePreview
          ? [
              {
                type: "text",
                text: formatMessagesText(result.dialog.title, result.messages, result.nextOffsetId),
              },
            ]
          : [
              {
                type: "text",
                text: `Recent messages for ${result.dialog.title}: ${result.messages.length} found. nextOffsetId=${result.nextOffsetId ?? "null"}. Full data is in structuredContent.`,
              },
            ],
        structuredContent: result,
      };
    },
  );
}

function formatDialogsText(dialogs: Awaited<ReturnType<TelegramService["listDialogs"]>>): string {
  if (dialogs.length === 0) {
    return "No Telegram dialogs found.";
  }

  const preview = dialogs
    .slice(0, DIALOG_TEXT_PREVIEW_LIMIT)
    .map((dialog) => {
      const username = dialog.username ? ` @${dialog.username}` : "";
      return `${dialog.title}${username} [${dialog.type}] id=${dialog.id}`;
    })
    .join("\n");
  const suffix = dialogs.length > DIALOG_TEXT_PREVIEW_LIMIT
    ? `\n... ${dialogs.length - DIALOG_TEXT_PREVIEW_LIMIT} more dialogs in structuredContent`
    : "";

  return `Found ${dialogs.length} dialogs.\n${preview}${suffix}`;
}

function formatMessagesText(
  dialogTitle: string,
  messages: Awaited<ReturnType<TelegramService["readChannel"]>>["messages"],
  nextOffsetId: number | null,
): string {
  if (messages.length === 0) {
    return `No messages found for ${dialogTitle} in the requested time window. nextOffsetId=null`;
  }

  const preview = messages.slice(0, MESSAGE_TEXT_PREVIEW_LIMIT);
  const lines = preview.map((message) => {
    return `[${message.date}] ${message.sender ?? "unknown"}: ${truncateText(message.text || "(no text)", MESSAGE_TEXT_LINE_LIMIT)}`;
  });
  const suffix = messages.length > MESSAGE_TEXT_PREVIEW_LIMIT
    ? `\n... ${messages.length - MESSAGE_TEXT_PREVIEW_LIMIT} more messages in structuredContent`
    : "";

  return [
    `Recent messages for ${dialogTitle}: ${messages.length} found. nextOffsetId=${nextOffsetId ?? "null"}.`,
    ...lines,
  ].join("\n") + suffix;
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
