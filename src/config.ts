import { config as loadEnv } from "dotenv";

loadEnv();

type EnvValue = string;

function requireEnv(name: string): EnvValue {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export interface AppConfig {
  port: number;
  apiKey: string;
  telegramApiId: number;
  telegramApiHash: string;
  telegramSession: string;
  allowedOrigins: string[];
}

export function getConfig(): AppConfig {
  const port = Number(process.env.PORT ?? 3000);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error("PORT must be a positive number");
  }

  const telegramApiIdRaw = requireEnv("TELEGRAM_API_ID");
  const telegramApiId = Number(telegramApiIdRaw);
  if (!Number.isInteger(telegramApiId) || telegramApiId <= 0) {
    throw new Error("TELEGRAM_API_ID must be a positive integer");
  }

  return {
    port,
    apiKey: requireEnv("MCP_API_KEY"),
    telegramApiId,
    telegramApiHash: requireEnv("TELEGRAM_API_HASH"),
    telegramSession: requireEnv("TELEGRAM_SESSION"),
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  };
}
