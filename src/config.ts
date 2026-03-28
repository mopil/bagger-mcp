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
  pathSecret: string;
  telegramApiId: number;
  telegramApiHash: string;
  telegramSession: string;
  xaiApiKey: string;
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
    pathSecret: requireEnv("MCP_PATH_SECRET"),
    telegramApiId,
    telegramApiHash: requireEnv("TELEGRAM_API_HASH"),
    telegramSession: requireEnv("TELEGRAM_SESSION"),
    xaiApiKey: requireEnv("XAI_API_KEY"),
  };
}
