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
  githubToken: string;
  krxAuthKey: string;
  coingeckoApiKey?: string;
  dartApiKey: string;
  tossClientId?: string;
  tossClientSecret?: string;
  // 외부 API egress 프록시 URL(공용). 고정 IP가 필요한 외부 호출에 사용.
  proxyUrl?: string;
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
    githubToken: requireEnv("GITHUB_TOKEN"),
    krxAuthKey: requireEnv("KRX_AUTH_KEY"),
    coingeckoApiKey: process.env.COINGECKO_API_KEY?.trim() || undefined,
    dartApiKey: requireEnv("DART_API_KEY"),
    tossClientId: process.env.TOSS_INVEST_API_KEY?.trim() || undefined,
    tossClientSecret: process.env.TOSS_INVEST_SECRET_KEY?.trim() || undefined,
    // 공용 egress 프록시(고정 IP 화이트리스트 대응). 전용 변수 우선, 표준 HTTPS/HTTP_PROXY로 폴백.
    proxyUrl:
      process.env.OUTBOUND_PROXY_URL?.trim() ||
      process.env.HTTPS_PROXY?.trim() ||
      process.env.HTTP_PROXY?.trim() ||
      undefined,
  };
}
