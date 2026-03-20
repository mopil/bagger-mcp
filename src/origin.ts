import type { NextFunction, Request, Response } from "express";

export function createOriginGuard(allowedOrigins: string[]) {
  const normalizedAllowedOrigins = new Set(
    allowedOrigins.map((origin) => normalizeOrigin(origin)).filter((origin): origin is string => origin !== null),
  );

  return (req: Request, res: Response, next: NextFunction): void => {
    const originHeader = req.header("origin");

    if (!originHeader) {
      next();
      return;
    }

    const normalizedOrigin = normalizeOrigin(originHeader);
    if (!normalizedOrigin) {
      res.status(400).json({
        error: "Bad Request",
        message: "Invalid Origin header.",
      });
      return;
    }

    const requestOrigin = getRequestOrigin(req);
    if (normalizedOrigin === requestOrigin || normalizedAllowedOrigins.has(normalizedOrigin)) {
      next();
      return;
    }

    res.status(403).json({
      error: "Forbidden",
      message: "Origin is not allowed.",
    });
  };
}

function getRequestOrigin(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

function normalizeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}
