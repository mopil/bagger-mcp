import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import type { AppConfig } from "../config.js";
import { createMcpServer } from "../mcp/createServer.js";
import { TelegramService } from "../tools/telegram/service.js";

export function createApp(config: AppConfig) {
  const telegramService = new TelegramService({
    apiId: config.telegramApiId,
    apiHash: config.telegramApiHash,
    session: config.telegramSession,
  });
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const mcpPath = `/mcp/${config.pathSecret}`;

  const app = express();
  app.set("trust proxy", true);
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  app.post(mcpPath, async (req: Request, res: Response) => {
    const sessionId = req.header("mcp-session-id");

    try {
      const transport = await getOrCreateTransport({
        sessionId,
        body: req.body,
        res,
        transports,
        telegramService,
      });
      if (!transport) {
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      sendInternalError(res, error);
    }
  });

  app.get(mcpPath, async (req: Request, res: Response) => {
    const transport = requireSessionTransport(req, res, transports);
    if (!transport) {
      return;
    }

    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      sendInternalError(res, error);
    }
  });

  app.delete(mcpPath, async (req: Request, res: Response) => {
    const transport = requireSessionTransport(req, res, transports);
    if (!transport) {
      return;
    }

    try {
      await transport.close();
      res.status(204).end();
    } catch (error) {
      sendInternalError(res, error);
    }
  });

  return app;
}

function requireSessionTransport(
  req: Request,
  res: Response,
  transports: Map<string, StreamableHTTPServerTransport>,
): StreamableHTTPServerTransport | null {
  const sessionId = req.header("mcp-session-id");

  if (!sessionId) {
    res.status(400).json({
      error: "Bad Request",
      message: "Missing mcp-session-id header.",
    });
    return null;
  }

  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({
      error: "Not Found",
      message: "Unknown MCP session.",
    });
    return null;
  }

  return transport;
}

async function getOrCreateTransport({
  sessionId,
  body,
  res,
  transports,
  telegramService,
}: {
  sessionId: string | undefined;
  body: unknown;
  res: Response;
  transports: Map<string, StreamableHTTPServerTransport>;
  telegramService: TelegramService;
}): Promise<StreamableHTTPServerTransport | null> {
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

  const server = createMcpServer(telegramService);
  await server.connect(transport);
  const originalOnClose = transport.onclose;
  transport.onclose = () => {
    originalOnClose?.();
    void server.close();
  };

  return transport;
}

function sendInternalError(res: Response, error: unknown): void {
  if (res.headersSent) {
    return;
  }

  res.status(500).json({
    error: "Internal Server Error",
    message: error instanceof Error ? error.message : "Unknown error",
  });
}
