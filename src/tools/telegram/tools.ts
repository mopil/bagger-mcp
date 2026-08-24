import { defineServiceTool } from "../defineTool.js";
import type { ServiceRegistry } from "../../mcp/services.js";
import {
  telegramListChannelsInputSchema,
  telegramReadChannelsInputSchema,
  telegramSendMessageInputSchema,
  toTelegramListDialogsParams,
  toTelegramReadChannelsParams,
  toTelegramSendMessageParams,
} from "./schema.js";

const tool = defineServiceTool<ServiceRegistry>();

export const telegramTools = [
  tool({
    name: "telegram_list_channels",
    description: "List Telegram dialogs available to the configured session. Use query and smaller limits to narrow search and reduce response size.",
    inputSchema: telegramListChannelsInputSchema,
    async run(args, { telegramService }) {
      const dialogs = await telegramService.listDialogs(toTelegramListDialogsParams(args));
      return { dialogs };
    },
  }),
  tool({
    name: "telegram_read_channels",
    description: "Read recent messages from multiple Telegram dialogs in one request.",
    inputSchema: telegramReadChannelsInputSchema,
    run(args, { telegramService }) {
      return telegramService.readChannels(toTelegramReadChannelsParams(args));
    },
  }),
  tool({
    name: "telegram_send_message",
    description:
      "Send a text message from the configured Telegram account. Defaults to the user's own Saved Messages; any other target must be listed in TELEGRAM_SEND_ALLOWLIST. Text longer than Telegram's 4096-character limit is split at line boundaries and sent as consecutive messages.",
    inputSchema: telegramSendMessageInputSchema,
    run(args, { telegramService }) {
      return telegramService.sendMessage(toTelegramSendMessageParams(args));
    },
  }),
];
