import { withProxy } from "../../http/proxy.js";

import type {
  TossGetBuyableAmountInput,
  TossGetExchangeRateInput,
  TossGetMarketCalendarInput,
  TossGetPortfolioInput,
  TossGetSellableQuantityInput,
  TossGetStockInfoInput,
  TossListOrdersInput,
} from "./schema.js";

const TOSS_BASE_URL = "https://openapi.tossinvest.com";
const REQUEST_TIMEOUT_MS = 15_000;
// 토큰 만료 직전 호출에서 401이 나지 않도록 만료 60초 전에 미리 재발급한다.
const TOKEN_SAFETY_WINDOW_MS = 60_000;
// 계좌 목록은 거의 바뀌지 않으므로 짧게 캐싱해 매 호출의 라운드트립을 없앤다.
const ACCOUNTS_TTL_MS = 5 * 60 * 1000;
// include_warnings는 종목당 1회 호출 → 과도한 팬아웃/타임아웃 방지.
const MAX_WARNING_SYMBOLS = 20;

export interface TossInvestServiceOptions {
  clientId?: string;
  clientSecret?: string;
  // 고정 IP egress 프록시 URL. 예: http://user:pass@1.2.3.4:8888 (HTTP CONNECT 터널).
  proxyUrl?: string;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

interface TossAccount {
  accountNo?: string;
  accountSeq?: number;
  accountType?: string;
  [key: string]: unknown;
}

interface AccountsCache {
  accounts: TossAccount[];
  expiresAt: number;
}

export class TossInvestService {
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly proxyUrl?: string;
  private tokenCache: TokenCache | null = null;
  private tokenInFlight: Promise<string> | null = null;
  private accountsCache: AccountsCache | null = null;
  private accountsInFlight: Promise<TossAccount[]> | null = null;

  constructor(options: TossInvestServiceOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.proxyUrl = options.proxyUrl;
  }

  async getPortfolio(input: TossGetPortfolioInput) {
    // account_seq가 명시되면 계좌 목록 조회(라운드트립 1회)를 건너뛴다.
    let accounts: TossAccount[] = [];
    let accountSeq = input.account_seq;
    if (accountSeq == null) {
      accounts = await this.getAccounts();
      accountSeq = pickDefaultAccount(accounts);
      if (accountSeq == null) {
        throw new Error("조회 가능한 계좌가 없습니다. 토스증권 Open API에 연동된 계좌를 확인하세요.");
      }
    }

    const query = new URLSearchParams();
    if (input.symbol) query.set("symbol", input.symbol);
    const holdings = await this.accountRequest("/api/v1/holdings", accountSeq, query);

    return { accountSeq, accountCount: accounts.length, accounts, holdings };
  }

  async listOrders(input: TossListOrdersInput) {
    const accountSeq = await this.resolveAccountSeq(input.account_seq);
    const query = new URLSearchParams({ status: input.status, limit: String(input.limit) });
    if (input.symbol) query.set("symbol", input.symbol);
    if (input.from) query.set("from", input.from);
    if (input.to) query.set("to", input.to);
    if (input.cursor) query.set("cursor", input.cursor);
    const result = await this.accountRequest("/api/v1/orders", accountSeq, query);
    return { accountSeq, status: input.status, orders: result };
  }

  async getBuyableAmount(input: TossGetBuyableAmountInput) {
    const accountSeq = await this.resolveAccountSeq(input.account_seq);
    const query = new URLSearchParams({ currency: input.currency });
    const result = await this.accountRequest("/api/v1/buying-power", accountSeq, query);
    return { accountSeq, currency: input.currency, ...asObject(result) };
  }

  async getSellableQuantity(input: TossGetSellableQuantityInput) {
    const accountSeq = await this.resolveAccountSeq(input.account_seq);
    const query = new URLSearchParams({ symbol: input.symbol });
    const result = await this.accountRequest("/api/v1/sellable-quantity", accountSeq, query);
    return { accountSeq, symbol: input.symbol, ...asObject(result) };
  }

  async getStockInfo(input: TossGetStockInfoInput) {
    if (input.include_warnings && input.symbols.length > MAX_WARNING_SYMBOLS) {
      throw new Error(
        `include_warnings는 종목 ${MAX_WARNING_SYMBOLS}개 이하에서만 가능합니다 (요청: ${input.symbols.length}개). symbols를 줄이세요.`,
      );
    }

    const query = new URLSearchParams({ symbols: input.symbols.join(",") });
    const stocks = await this.request(`/api/v1/stocks?${query.toString()}`);

    if (!input.include_warnings) {
      return { count: input.symbols.length, stocks };
    }

    const warnings = await Promise.all(
      input.symbols.map(async (symbol) => {
        const result = await this.request(
          `/api/v1/stocks/${encodeURIComponent(symbol)}/warnings`,
        );
        return { symbol, warnings: result };
      }),
    );
    return { count: input.symbols.length, stocks, warnings };
  }

  async getExchangeRate(input: TossGetExchangeRateInput) {
    const query = new URLSearchParams({
      baseCurrency: input.base_currency,
      quoteCurrency: input.quote_currency,
    });
    if (input.date_time) query.set("dateTime", input.date_time);
    const result = await this.request(`/api/v1/exchange-rate?${query.toString()}`);
    return asObject(result);
  }

  async getMarketCalendar(input: TossGetMarketCalendarInput) {
    const query = new URLSearchParams();
    if (input.date) query.set("date", input.date);
    const qs = query.toString();
    const path = `/api/v1/market-calendar/${input.country}${qs ? `?${qs}` : ""}`;
    const result = await this.request(path);
    return { country: input.country, ...asObject(result) };
  }

  // ── 내부 헬퍼 ──────────────────────────────────────────────

  private async resolveAccountSeq(explicit?: number): Promise<number> {
    if (explicit != null) return explicit;
    const accounts = await this.getAccounts();
    const seq = pickDefaultAccount(accounts);
    if (seq == null) {
      throw new Error("조회 가능한 계좌가 없습니다. 토스증권 Open API에 연동된 계좌를 확인하세요.");
    }
    return seq;
  }

  private async getAccounts(): Promise<TossAccount[]> {
    if (this.accountsCache && this.accountsCache.expiresAt > Date.now()) {
      return this.accountsCache.accounts;
    }
    if (this.accountsInFlight) return this.accountsInFlight;

    this.accountsInFlight = this.request("/api/v1/accounts")
      .then((raw) => {
        const accounts = (Array.isArray(raw) ? raw : []) as TossAccount[];
        this.accountsCache = { accounts, expiresAt: Date.now() + ACCOUNTS_TTL_MS };
        return accounts;
      })
      .finally(() => {
        this.accountsInFlight = null;
      });
    return this.accountsInFlight;
  }

  private accountRequest(
    basePath: string,
    accountSeq: number,
    query: URLSearchParams,
  ): Promise<unknown> {
    query.set("accountSeq", String(accountSeq));
    return this.request(`${basePath}?${query.toString()}`, {
      "X-Tossinvest-Account": String(accountSeq),
    });
  }

  // 응답을 unwrap(result 래퍼 제거)해서 반환. 401/403이면 토큰 캐시를 비우고 1회 재발급·재시도.
  private async request(path: string, extraHeaders?: Record<string, string>): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.getAccessToken();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(
          `${TOSS_BASE_URL}${path}`,
          withProxy(
            {
              method: "GET",
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
                ...extraHeaders,
              },
              signal: controller.signal,
            },
            this.proxyUrl,
          ),
        );
        // 401(Unauthorized)만 토큰 만료로 보고 재발급·재시도. 403(Forbidden)은 권한 문제라 재시도 무의미.
        if (response.status === 401 && attempt === 0) {
          this.tokenCache = null;
          continue;
        }
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(
            `토스 API 요청 실패: ${response.status} ${response.statusText} (${path}). ${truncate(body, 300)}`,
          );
        }
        return unwrap(await response.json());
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(
            `토스 API 요청이 ${REQUEST_TIMEOUT_MS}ms 내에 응답하지 않았습니다 (${path}).`,
          );
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`토스 API 인증 재시도에 실패했습니다 (${path}).`);
  }

  private async getAccessToken(): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        "토스증권 Open API 자격증명이 없습니다. 환경변수 TOSS_INVEST_API_KEY / TOSS_INVEST_SECRET_KEY 를 설정하세요.",
      );
    }
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.accessToken;
    }
    if (this.tokenInFlight) return this.tokenInFlight;

    this.tokenInFlight = this.issueToken()
      .then((cache) => {
        this.tokenCache = cache;
        return cache.accessToken;
      })
      .finally(() => {
        this.tokenInFlight = null;
      });
    return this.tokenInFlight;
  }

  private async issueToken(): Promise<TokenCache> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(
        `${TOSS_BASE_URL}/oauth2/token`,
        withProxy(
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body: body.toString(),
            signal: controller.signal,
          },
          this.proxyUrl,
        ),
      );
      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        throw new Error(
          `토스 토큰 발급 실패: ${response.status} ${response.statusText}. ${truncate(errBody, 300)}`,
        );
      }
      const json = (await response.json()) as {
        access_token: string;
        token_type?: string;
        expires_in?: number;
      };
      if (!json.access_token) {
        throw new Error("토스 토큰 응답에 access_token이 없습니다.");
      }
      const expiresInMs = (json.expires_in ?? 3600) * 1000;
      return {
        accessToken: json.access_token,
        expiresAt: Date.now() + Math.max(0, expiresInMs - TOKEN_SAFETY_WINDOW_MS),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`토스 토큰 발급이 ${REQUEST_TIMEOUT_MS}ms 내에 응답하지 않았습니다.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function pickDefaultAccount(accounts: TossAccount[]): number | undefined {
  return accounts.find((a) => a.accountType === "BROKERAGE")?.accountSeq ?? accounts[0]?.accountSeq;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

// 토스 응답은 대부분 {result: ...} 래퍼. 있으면 한 겹 벗겨 반환.
function unwrap(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "result" in raw) {
    return (raw as Record<string, unknown>).result;
  }
  return raw;
}

// 스프레드 대상이 객체가 아닐 때(배열/스칼라) 안전하게 감싼다.
function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}
