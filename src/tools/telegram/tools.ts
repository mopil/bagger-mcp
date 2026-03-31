import { defineServiceTool } from "../defineTool.js";
import type { ServiceRegistry } from "../../mcp/services.js";
import {
  telegramListChannelsInputSchema,
  telegramReadChannelInputSchema,
  toTelegramListDialogsParams,
  toTelegramReadChannelParams,
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
    name: "telegram_read_channel",
    description: "Read recent messages from a Telegram dialog by username, title, or numeric id.",
    inputSchema: telegramReadChannelInputSchema,
    run(args, { telegramService }) {
      return telegramService.readChannel(toTelegramReadChannelParams(args));
    },
  }),
];
