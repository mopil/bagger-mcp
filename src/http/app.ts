import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import type { AppConfig } from "../config.js";
import { createMcpServer } from "../mcp/createServer.js";
import { BinanceService } from "../tools/crypto/binance/service.js";
import { BithumbService } from "../tools/crypto/bithumb/service.js";
import { CoingeckoService } from "../tools/crypto/coingecko/service.js";
import { GrokService } from "../tools/grok/service.js";
import { KrxService } from "../tools/krx/service.js";
import { MemoryService } from "../tools/memory/service.js";
import { TelegramService } from "../tools/telegram/service.js";
import { UpbitService } from "../tools/crypto/upbit/service.js";
import { YahooFinanceService } from "../tools/yahoo-finance/service.js";

const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;

interface ManagedTransport {
  transport: StreamableHTTPServerTransport;
  idleTimer: NodeJS.Timeout;
}

export function createApp(config: AppConfig) {
  const telegramService = new TelegramService({
    apiId: config.telegramApiId,
    apiHash: config.telegramApiHash,
    session: config.telegramSession,
  });
  const grokService = new GrokService({
    apiKey: config.xaiApiKey,
  });
  const yahooFinanceService = new YahooFinanceService();
  const memoryService = new MemoryService({
    token: config.githubToken,
  });
  const krxService = new KrxService({
    authKey: config.krxAuthKey,
  });
  const upbitService = new UpbitService();
  const bithumbService = new BithumbService();
  const binanceService = new BinanceService();
  const coingeckoService = new CoingeckoService({ apiKey: config.coingeckoApiKey });
  const transports = new Map<string, ManagedTransport>();
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
        grokService,
        yahooFinanceService,
        memoryService,
        krxService,
        upbitService,
        bithumbService,
        binanceService,
        coingeckoService,
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
  telegramService,
  grokService,
  yahooFinanceService,
  memoryService,
  krxService,
  upbitService,
  bithumbService,
  binanceService,
  coingeckoService,
}: {
  sessionId: string | undefined;
  body: unknown;
  res: Response;
  transports: Map<string, ManagedTransport>;
  telegramService: TelegramService;
  grokService: GrokService;
  yahooFinanceService: YahooFinanceService;
  memoryService: MemoryService;
  krxService: KrxService;
  upbitService: UpbitService;
  bithumbService: BithumbService;
  binanceService: BinanceService;
  coingeckoService: CoingeckoService;
}): Promise<StreamableHTTPServerTransport | null> {
  if (sessionId) {
    const existingManagedTransport = transports.get(sessionId);
    if (!existingManagedTransport) {
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
    }
  };

  const server = createMcpServer({ telegramService, grokService, yahooFinanceService, memoryService, krxService, upbitService, bithumbService, binanceService, coingeckoService });
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
