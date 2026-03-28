import { Api } from "telegram";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

export type TelegramDialogType = "channel" | "group" | "user";

export interface TelegramDialogSummary {
  id: string;
  title: string;
  username: string | null;
  type: TelegramDialogType;
  accessKey: string;
}

export interface TelegramMessageSummary {
  id: number;
  date: string;
  text: string;
  sender: string | null;
  views: number | null;
  forwards: number | null;
  replies: number | null;
}

interface TelegramClientOptions {
  apiId: number;
  apiHash: string;
  session: string;
}

export interface TelegramReadChannelParams {
  channel: string;
  hours?: number;
  limit?: number;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export class TelegramService {
  private readonly options: TelegramClientOptions;
  private client: TelegramClient | null = null;
  private connectPromise: Promise<boolean> | null = null;

  constructor(options: TelegramClientOptions) {
    this.options = options;
  }

  async listDialogs(): Promise<TelegramDialogSummary[]> {
    await this.ensureConnected();
    const client = this.getOrCreateClient();

    const dialogs = await client.getDialogs({});

    return dialogs
      .map((dialog) => {
        const entity = dialog.entity;
        if (!entity) {
          return null;
        }

        const type = getDialogType(entity);
        const title = getDialogTitle(dialog);
        const username = getEntityUsername(entity);
        const id = String(getEntityId(entity));

        return {
          id,
          title,
          username,
          type,
          accessKey: username ?? id,
        } satisfies TelegramDialogSummary;
      })
      .filter((dialog): dialog is TelegramDialogSummary => dialog !== null)
      .sort((left, right) => left.title.localeCompare(right.title));
  }

  async readChannel(params: TelegramReadChannelParams): Promise<{
    dialog: TelegramDialogSummary;
    messages: TelegramMessageSummary[];
  }> {
    await this.ensureConnected();
    const client = this.getOrCreateClient();

    const dialogs = await this.listDialogs();
    const dialog = resolveDialog(dialogs, params.channel);
    const cutoffTime = Date.now() - normalizeHours(params.hours) * 60 * 60 * 1000;
    const limit = normalizeLimit(params.limit);

    const messages = await client.getMessages(dialog.accessKey, { limit });

    const summarizedMessages = messages
      .filter((message) => message?.date)
      .map((message) => {
        const sender = getSenderName(message.sender, message.postAuthor);

        return {
          id: Number(message.id),
          date: new Date(message.date * 1000).toISOString(),
          text: message.message ?? "",
          sender,
          views: "views" in message ? message.views ?? null : null,
          forwards: "forwards" in message ? message.forwards ?? null : null,
          replies:
            "replies" in message && message.replies
              ? message.replies.replies ?? null
              : null,
        } satisfies TelegramMessageSummary;
      })
      .filter((message) => new Date(message.date).getTime() >= cutoffTime);

    return {
      dialog,
      messages: summarizedMessages,
    };
  }

  private async ensureConnected(): Promise<void> {
    const client = this.getOrCreateClient();

    if (!this.connectPromise) {
      this.connectPromise = client.connect().catch((error: unknown) => {
        this.connectPromise = null;
        throw error;
      });
    }

    await this.connectPromise;
  }

  private getOrCreateClient(): TelegramClient {
    if (this.client) {
      return this.client;
    }

    this.client = new TelegramClient(
      new StringSession(this.options.session),
      this.options.apiId,
      this.options.apiHash,
      {
        connectionRetries: 5,
      },
    );

    return this.client;
  }
}

function normalizeHours(hours = 24): number {
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error("hours must be a positive number");
  }

  return hours;
}

function normalizeLimit(limit = 50): number {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 200) {
    throw new Error("limit must be an integer between 1 and 200");
  }

  return limit;
}

function resolveDialog(
  dialogs: TelegramDialogSummary[],
  rawChannel: string,
): TelegramDialogSummary {
  const query = normalize(rawChannel);
  const exactMatches = dialogs.filter((dialog) => {
    return (
      normalize(dialog.id) === query ||
      normalize(dialog.accessKey) === query ||
      normalize(dialog.title) === query
    );
  });

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  if (exactMatches.length > 1) {
    throw new Error(`Channel identifier is ambiguous: ${rawChannel}`);
  }

  const partialMatches = dialogs.filter((dialog) => normalize(dialog.title).includes(query));

  if (partialMatches.length === 1) {
    return partialMatches[0];
  }

  if (partialMatches.length > 1) {
    throw new Error(`Channel identifier is ambiguous: ${rawChannel}`);
  }

  throw new Error(`Channel not found: ${rawChannel}`);
}

function getDialogType(entity: unknown): TelegramDialogType {
  if (entity instanceof Api.Channel) {
    return entity.broadcast ? "channel" : "group";
  }

  if (entity instanceof Api.Chat) {
    return "group";
  }

  return "user";
}

function getDialogTitle(dialog: { title?: string; name?: string }): string {
  return dialog.title ?? dialog.name ?? "Untitled";
}

function getEntityUsername(entity: unknown): string | null {
  return hasStringProperty(entity, "username") && entity.username.length > 0
    ? entity.username
    : null;
}

function getEntityId(entity: unknown): string {
  if (!hasProperty(entity, "id")) {
    return "";
  }

  if (typeof entity.id === "bigint") {
    return entity.id.toString();
  }

  return String(entity.id);
}

function getSenderName(sender: unknown, postAuthor: string | undefined): string | null {
  if (postAuthor) {
    return postAuthor;
  }

  if (!sender) {
    return null;
  }

  if (hasStringProperty(sender, "username") && sender.username.length > 0) {
    return sender.username;
  }

  if (hasStringProperty(sender, "title") && sender.title.length > 0) {
    return sender.title;
  }

  if (hasProperty(sender, "firstName") || hasProperty(sender, "lastName")) {
    const firstName = hasStringProperty(sender, "firstName") ? sender.firstName : "";
    const lastName = hasStringProperty(sender, "lastName") ? sender.lastName : "";
    const fullName = `${firstName} ${lastName}`.trim();
    return fullName || null;
  }

  return null;
}

function hasProperty<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, unknown> {
  return typeof value === "object" && value !== null && key in value;
}

function hasStringProperty<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, string> {
  return hasProperty(value, key) && typeof value[key] === "string";
}
