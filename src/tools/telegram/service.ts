import { Api } from "telegram";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import type { TelegramListDialogsParams, TelegramReadChannelParams } from "./schema.js";

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

const DIALOG_CACHE_TTL_MS = 60_000;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export class TelegramService {
  private readonly options: TelegramClientOptions;
  private client: TelegramClient | null = null;
  private connectPromise: Promise<boolean> | null = null;
  private dialogsRefreshPromise: Promise<TelegramDialogSummary[]> | null = null;
  private dialogsCache:
    | {
        expiresAt: number;
        dialogs: TelegramDialogSummary[];
      }
    | null = null;

  constructor(options: TelegramClientOptions) {
    this.options = options;
  }

  async listDialogs(params: TelegramListDialogsParams = {}): Promise<TelegramDialogSummary[]> {
    const dialogs = await this.getDialogsCached();
    const query = normalizeQuery(params.query);
    const limit = normalizeDialogsLimit(params.limit);

    const filteredDialogs = query
      ? dialogs.filter((dialog) => matchesDialogQuery(dialog, query))
      : dialogs;

    return filteredDialogs.slice(0, limit);
  }

  async readChannel(params: TelegramReadChannelParams): Promise<{
    dialog: TelegramDialogSummary;
    messages: TelegramMessageSummary[];
    nextOffsetId: number | null;
  }> {
    await this.ensureConnected();
    const client = this.getOrCreateClient();

    const dialogs = await this.getDialogsCached();
    const dialog = resolveDialog(dialogs, params.channel);
    const cutoffTime = Date.now() - normalizeHours(params.hours) * 60 * 60 * 1000;
    const limit = normalizeLimit(params.limit);
    const offsetId = normalizeOffsetId(params.offsetId);

    const messages = await client.getMessages(dialog.accessKey, { limit, offsetId });

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
    const oldestMessage = summarizedMessages[summarizedMessages.length - 1];

    return {
      dialog,
      messages: summarizedMessages,
      nextOffsetId: oldestMessage?.id ?? null,
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

  private async getDialogsCached(): Promise<TelegramDialogSummary[]> {
    await this.ensureConnected();

    if (this.dialogsCache && this.dialogsCache.expiresAt > Date.now()) {
      return this.dialogsCache.dialogs;
    }

    if (this.dialogsRefreshPromise) {
      return this.dialogsRefreshPromise;
    }

    const client = this.getOrCreateClient();
    this.dialogsRefreshPromise = client.getDialogs({})
      .then((fetchedDialogs) => {
        const dialogs = fetchedDialogs
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

        this.dialogsCache = {
          dialogs,
          expiresAt: Date.now() + DIALOG_CACHE_TTL_MS,
        };

        return dialogs;
      })
      .finally(() => {
        this.dialogsRefreshPromise = null;
      });

    return this.dialogsRefreshPromise;
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

function normalizeOffsetId(offsetId: number | undefined): number {
  if (offsetId === undefined) {
    return 0;
  }

  if (!Number.isInteger(offsetId) || offsetId < 0) {
    throw new Error("offsetId must be a non-negative integer");
  }

  return offsetId;
}

function normalizeDialogsLimit(limit = 100): number {
  if (!Number.isInteger(limit) || limit <= 0 || limit > 200) {
    throw new Error("limit must be an integer between 1 and 200");
  }

  return limit;
}

function normalizeQuery(query: string | undefined): string | null {
  if (query === undefined) {
    return null;
  }

  const normalized = normalize(query);
  return normalized.length > 0 ? normalized : null;
}

function matchesDialogQuery(dialog: TelegramDialogSummary, query: string): boolean {
  return (
    normalize(dialog.id) === query ||
    normalize(dialog.accessKey) === query ||
    normalize(dialog.title).includes(query) ||
    (dialog.username !== null && normalize(dialog.username).includes(query))
  );
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
