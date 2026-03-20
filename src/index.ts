import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { createApiKeyMiddleware } from "./auth.js";
import { getConfig } from "./config.js";
import { createOriginGuard } from "./origin.js";
import { TelegramService } from "./tools/telegram.js";

const config = getConfig();
const telegramService = new TelegramService({
  apiId: config.telegramApiId,
  apiHash: config.telegramApiHash,
  session: config.telegramSession,
});
const transports = new Map<string, StreamableHTTPServerTransport>();

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

const apiKeyMiddleware = createApiKeyMiddleware(config.apiKey);
const originGuard = createOriginGuard(config.allowedOrigins);

app.post("/mcp", originGuard, apiKeyMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.header("mcp-session-id");
  try {
    const transport = await getOrCreateTransport(sessionId, req.body, res);
    if (!transport) {
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
});

app.get("/mcp", originGuard, apiKeyMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.header("mcp-session-id");

  if (!sessionId) {
    res.status(400).json({
      error: "Bad Request",
      message: "Missing mcp-session-id header.",
    });
    return;
  }

  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({
      error: "Not Found",
      message: "Unknown MCP session.",
    });
    return;
  }

  try {
    await transport.handleRequest(req, res);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
});

app.delete("/mcp", originGuard, apiKeyMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.header("mcp-session-id");

  if (!sessionId) {
    res.status(400).json({
      error: "Bad Request",
      message: "Missing mcp-session-id header.",
    });
    return;
  }

  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({
      error: "Not Found",
      message: "Unknown MCP session.",
    });
    return;
  }

  try {
    await transport.close();
    res.status(204).end();
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
});

const server = app.listen(config.port, () => {
  console.log(`MCP server listening on port ${config.port}`);
});

server.on("error", (error) => {
  console.error("Server failed to start", error);
  process.exitCode = 1;
});

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "bagger-mcp",
    version: "0.1.0",
  });

  server.tool("telegram_list_channels", "List Telegram dialogs available to the configured session.", {}, async () => {
    const dialogs = await telegramService.listDialogs();

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
  });

  server.tool(
    "telegram_read_channel",
    "Read recent messages from a Telegram dialog by username, title, or numeric id.",
    {
      channel: z.string().min(1),
      hours: z.number().positive().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    async ({ channel, hours, limit }) => {
      const result = await telegramService.readChannel({ channel, hours, limit });

      return {
        content: [
          {
            type: "text",
            text: formatMessagesText(result.dialog.title, result.messages),
          },
        ],
        structuredContent: result,
      };
    },
  );

  return server;
}

async function getOrCreateTransport(
  sessionId: string | undefined,
  body: unknown,
  res: Response,
): Promise<StreamableHTTPServerTransport | null> {
  if (sessionId) {
    const existingTransport = transports.get(sessionId);
    if (!existingTransport) {
      res.status(404).json({
        error: "Not Found",
        message: "Unknown MCP session.",
      });
      return null;
    }

    return existingTransport;
  }

  if (!isInitializeRequest(body)) {
    res.status(400).json({
      error: "Bad Request",
      message: "Initialization request required when no MCP session exists.",
    });
    return null;
  }

  let transport: StreamableHTTPServerTransport;
  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (initializedSessionId) => {
      transports.set(initializedSessionId, transport);
    },
  });

  transport.onclose = () => {
    const activeSessionId = transport.sessionId;
    if (activeSessionId) {
      transports.delete(activeSessionId);
    }
  };

  const server = createMcpServer();
  await server.connect(transport);
  const originalOnClose = transport.onclose;
  transport.onclose = () => {
    originalOnClose?.();
    void server.close();
  };

  return transport;
}

function formatDialogsText(dialogs: Awaited<ReturnType<TelegramService["listDialogs"]>>): string {
  if (dialogs.length === 0) {
    return "No Telegram dialogs found.";
  }

  return dialogs
    .map((dialog) => {
      const username = dialog.username ? ` @${dialog.username}` : "";
      return `${dialog.title}${username} [${dialog.type}] id=${dialog.id}`;
    })
    .join("\n");
}

function formatMessagesText(
  dialogTitle: string,
  messages: Awaited<ReturnType<TelegramService["readChannel"]>>["messages"],
): string {
  if (messages.length === 0) {
    return `No messages found for ${dialogTitle} in the requested time window.`;
  }

  const lines = messages.map((message) => {
    return `[${message.date}] ${message.sender ?? "unknown"}: ${message.text || "(no text)"}`;
  });

  return [`Recent messages for ${dialogTitle}:`, ...lines].join("\n");
}
