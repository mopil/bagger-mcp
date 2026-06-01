import express, { type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import type { AppConfig } from "../config.js";
import { logger } from "../logger.js";
import { createMcpServer } from "../mcp/createServer.js";
import type { ServiceRegistry } from "../mcp/services.js";
import { BinanceService } from "../tools/crypto/binance/service.js";
import { BithumbService } from "../tools/crypto/bithumb/service.js";
import { CoingeckoService } from "../tools/crypto/coingecko/service.js";
import { DartService } from "../tools/dart/service.js";
import { GrokService } from "../tools/grok/service.js";
import { KrxService } from "../tools/krx/service.js";
import { MemoryService } from "../tools/memory/service.js";
import { NaverlandService } from "../tools/naverland/service.js";
import { TelegramService } from "../tools/telegram/service.js";
import { UpbitService } from "../tools/crypto/upbit/service.js";
import { YahooFinanceService } from "../tools/yahoo-finance/service.js";

const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;

interface ManagedTransport {
  transport: StreamableHTTPServerTransport;
  idleTimer: NodeJS.Timeout;
}

export function createApp(config: AppConfig) {
  const services: ServiceRegistry = {
    telegramService: new TelegramService({
      apiId: config.telegramApiId,
      apiHash: config.telegramApiHash,
      session: config.telegramSession,
    }),
    grokService: new GrokService({ apiKey: config.xaiApiKey }),
    yahooFinanceService: new YahooFinanceService(),
    memoryService: new MemoryService({ token: config.githubToken }),
    krxService: new KrxService({ authKey: config.krxAuthKey }),
    upbitService: new UpbitService(),
    bithumbService: new BithumbService(),
    binanceService: new BinanceService(),
    coingeckoService: new CoingeckoService({ apiKey: config.coingeckoApiKey }),
    dartService: new DartService({ apiKey: config.dartApiKey }),
    naverlandService: new NaverlandService(),
  };
  services.dartService.warmup();
  const transports = new Map<string, ManagedTransport>();
  const mcpPath = `/mcp/${config.pathSecret}`;

  const app = express();
  app.set("trust proxy", true);
  app.use(express.json({ limit: "1mb" }));
  app.use(requestLoggingMiddleware);

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
        services,
      });
      if (!transport) {
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error("mcp.post_failed", { sessionId, err: error });
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
      logger.error("mcp.get_failed", { sessionId: transport.sessionId, err: error });
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
      logger.error("mcp.delete_failed", { sessionId: transport.sessionId, err: error });
      sendInternalError(res, error);
    }
  });

  return app;
}

function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.header("x-request-id") ?? randomUUID();
  const sessionId = req.header("mcp-session-id");
  const start = Date.now();

  res.setHeader("x-request-id", requestId);

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const level = res.statusCode >= 500 ? "warn" : "info";
    logger[level]("http.request", {
      requestId,
      sessionId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs,
    });
  });

  next();
}

function requireSessionTransport(
  req: Request,
  res: Response,
  transports: Map<string, ManagedTransport>,
): StreamableHTTPServerTransport | null {
  const sessionId = req.header("mcp-session-id");

  if (!sessionId) {
    res.status(400).json({
      error: "Bad Request",
      message: "Missing mcp-session-id header.",
    });
    return null;
  }

  const managedTransport = transports.get(sessionId);
  if (!managedTransport) {
    logger.warn("mcp.session_unknown", { sessionId });
    res.status(404).json({
      error: "Not Found",
      message: "Unknown MCP session.",
    });
    return null;
  }

  refreshTransportIdleTimer(sessionId, managedTransport, transports);
  return managedTransport.transport;
}

async function getOrCreateTransport({
  sessionId,
  body,
  res,
  transports,
  services,
}: {
  sessionId: string | undefined;
  body: unknown;
  res: Response;
  transports: Map<string, ManagedTransport>;
  services: ServiceRegistry;
}): Promise<StreamableHTTPServerTransport | null> {
  if (sessionId) {
    const existingManagedTransport = transports.get(sessionId);
    if (!existingManagedTransport) {
      logger.warn("mcp.session_unknown", { sessionId });
      res.status(404).json({
        error: "Not Found",
        message: "Unknown MCP session.",
      });
      return null;
    }

    refreshTransportIdleTimer(sessionId, existingManagedTransport, transports);
    return existingManagedTransport.transport;
  }

  if (!isInitializeRequest(body)) {
    logger.warn("mcp.init_required");
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
      transports.set(initializedSessionId, {
        transport,
        idleTimer: createIdleTimer(initializedSessionId, transport, transports),
      });
      logger.info("mcp.session_opened", {
        sessionId: initializedSessionId,
        activeSessions: transports.size,
      });
    },
  });

  transport.onclose = () => {
    const activeSessionId = transport.sessionId;
    if (activeSessionId) {
      const managedTransport = transports.get(activeSessionId);
      if (managedTransport) {
        clearTimeout(managedTransport.idleTimer);
      }
      transports.delete(activeSessionId);
      logger.info("mcp.session_closed", {
        sessionId: activeSessionId,
        activeSessions: transports.size,
      });
    }
  };

  const server = createMcpServer(services);
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

function createIdleTimer(
  sessionId: string,
  transport: StreamableHTTPServerTransport,
  transports: Map<string, ManagedTransport>,
): NodeJS.Timeout {
  return setTimeout(() => {
    const managedTransport = transports.get(sessionId);
    if (!managedTransport || managedTransport.transport !== transport) {
      return;
    }

    logger.info("mcp.session_idle_expired", {
      sessionId,
      idleTtlMs: SESSION_IDLE_TTL_MS,
    });
    void transport.close();
  }, SESSION_IDLE_TTL_MS);
}

function refreshTransportIdleTimer(
  sessionId: string,
  managedTransport: ManagedTransport,
  transports: Map<string, ManagedTransport>,
): void {
  clearTimeout(managedTransport.idleTimer);
  managedTransport.idleTimer = createIdleTimer(sessionId, managedTransport.transport, transports);
}
