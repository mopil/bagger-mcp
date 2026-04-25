import type {
  CoingeckoListCategoriesInput,
  CoingeckoListMarketsInput,
  CoingeckoSimplePriceInput,
} from "./schema.js";

const COINGECKO_PUBLIC_BASE = "https://api.coingecko.com/api/v3";
const COINGECKO_PRO_BASE = "https://pro-api.coingecko.com/api/v3";
const COINGECKO_REQUEST_TIMEOUT_MS = 15_000;
// Free tier hard cap is 30 req/min. 2200ms ≈ 27 req/min keeps us below.
const COINGECKO_MIN_INTERVAL_MS = 2200;

// Cache TTLs tuned to balance freshness vs the strict 30/min budget.
const TTL_MARKETS_MS = 60 * 1000;
const TTL_TRENDING_MS = 5 * 60 * 1000;
const TTL_GLOBAL_MS = 60 * 1000;
const TTL_CATEGORIES_MS = 10 * 60 * 1000;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

export interface CoingeckoServiceOptions {
  apiKey?: string;
  baseUrl?: string;
}

export class CoingeckoService {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly isProKey: boolean;
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private nextSlot = 0;

  constructor(options: CoingeckoServiceOptions = {}) {
    this.apiKey = options.apiKey;
    // Pro keys (paid) tend to start with "CG-"; demo (free) keys also start with "CG-".
    // Without knowing tier, default to demo-key header if any key is provided.
    this.isProKey = false;
    this.baseUrl = options.baseUrl ?? (this.isProKey ? COINGECKO_PRO_BASE : COINGECKO_PUBLIC_BASE);
  }

  async listCoinsMarkets(input: CoingeckoListMarketsInput) {
    const params: Record<string, string> = {
      vs_currency: input.vs_currency,
      order: input.order,
      per_page: String(input.per_page),
      page: String(input.page),
    };
    if (input.ids && input.ids.length > 0) params.ids = input.ids.join(",");
    if (input.category) params.category = input.category;
    if (input.price_change_percentage) params.price_change_percentage = input.price_change_percentage;

    const cacheKey = `markets:${new URLSearchParams(params).toString()}`;
    const rows = await this.getCached(cacheKey, TTL_MARKETS_MS, async () => {
      const json = await this.requestJson<unknown>("coins/markets", params);
      if (!Array.isArray(json)) {
        throw new Error("CoinGecko coins/markets response was not an array.");
      }
      return json as Array<Record<string, unknown>>;
    });
    return { rowCount: rows.length, rows };
  }

  async getSimplePrice(input: CoingeckoSimplePriceInput) {
    const params: Record<string, string> = {
      ids: input.ids.join(","),
      vs_currencies: input.vs_currencies.join(","),
    };
    if (input.include_market_cap) params.include_market_cap = "true";
    if (input.include_24hr_vol) params.include_24hr_vol = "true";
    if (input.include_24hr_change) params.include_24hr_change = "true";
    if (input.include_last_updated_at) params.include_last_updated_at = "true";

    const json = await this.requestJson<Record<string, Record<string, number>>>(
      "simple/price",
      params,
    );
    return { prices: json };
  }

  async getGlobal() {
    return this.getCached("global", TTL_GLOBAL_MS, async () => {
      const json = await this.requestJson<{ data?: Record<string, unknown> }>("global", {});
      return json.data ?? {};
    });
  }

  async getTrending() {
    return this.getCached("trending", TTL_TRENDING_MS, async () => {
      const json = await this.requestJson<Record<string, unknown>>("search/trending", {});
      return json;
    });
  }

  async listCategories(input: CoingeckoListCategoriesInput) {
    const cacheKey = `categories:${input.order}`;
    const rows = await this.getCached(cacheKey, TTL_CATEGORIES_MS, async () => {
      const json = await this.requestJson<unknown>("coins/categories", { order: input.order });
      if (!Array.isArray(json)) {
        throw new Error("CoinGecko coins/categories response was not an array.");
      }
      return json as Array<Record<string, unknown>>;
    });
    return { rowCount: rows.length, rows };
  }

  private async requestJson<T>(path: string, params: Record<string, string>): Promise<T> {
    await this.throttle();

    const query = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/${path}${query ? `?${query}` : ""}`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), COINGECKO_REQUEST_TIMEOUT_MS);

    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) {
      headers[this.isProKey ? "x-cg-pro-api-key" : "x-cg-demo-api-key"] = this.apiKey;
    }

    try {
      const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `CoinGecko request failed: ${response.status} ${response.statusText} for ${path}?${query}. Body: ${truncate(body, 300)}`,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`CoinGecko request timed out after ${COINGECKO_REQUEST_TIMEOUT_MS}ms for ${path}?${query}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const wait = this.nextSlot - now;
    this.nextSlot = Math.max(now, this.nextSlot) + COINGECKO_MIN_INTERVAL_MS;
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  private async getCached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }

    const inFlight = this.inFlight.get(key);
    if (inFlight) {
      return inFlight as Promise<T>;
    }

    const promise = loader()
      .then((value) => {
        this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
