import type { NextFunction, Request, Response } from "express";

export function createApiKeyMiddleware(expectedApiKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const providedApiKey = req.header("x-api-key");

    if (!providedApiKey || providedApiKey !== expectedApiKey) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Missing or invalid x-api-key header.",
      });
      return;
    }

    next();
  };
}
