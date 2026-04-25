import type {
  UpbitCandleInterval,
  UpbitGetCandlesInput,
  UpbitGetTickerInput,
} from "./schema.js";

const UPBIT_BASE_URL = "https://api.upbit.com/v1";
const UPBIT_REQUEST_TIMEOUT_MS = 15_000;
const UPBIT_MIN_INTERVAL_MS = 110;
const MARKETS_CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const INTERVAL_PATH: Record<UpbitCandleInterval, string> = {
  "1h": "candles/minutes/60",
  "4h": "candles/minutes/240",
  day: "candles/days",
  week: "candles/weeks",
  month: "candles/months",
};

export interface UpbitServiceOptions {
  baseUrl?: string;
}

export class UpbitService {
  private readonly baseUrl: string;
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private nextSlot = 0;

  constructor(options: UpbitServiceOptions = {}) {
    this.baseUrl = options.baseUrl ?? UPBIT_BASE_URL;
  }

  listMarkets() {
    return this.getCached("market/all", MARKETS_CACHE_TTL_MS, async () => {
      const rows = await this.requestArray("market/all", { is_details: "true" });
      return { rowCount: rows.length, rows };
    });
  }

  async getTicker(input: UpbitGetTickerInput) {
    const rows = await this.requestArray("ticker", {
      markets: input.markets.join(","),
    });
    return { rowCount: rows.length, rows };
  }

  async getCandles(input: UpbitGetCandlesInput) {
    const path = INTERVAL_PATH[input.interval];
    const params: Record<string, string> = { market: input.market };
    if (input.count !== undefined) params.count = String(input.count);
    if (input.to !== undefined) params.to = input.to;

    const rows = await this.requestArray(path, params);
    return {
      market: input.market,
      interval: input.interval,
      rowCount: rows.length,
      rows,
    };
  }

  private async requestArray(
    path: string,
    params: Record<string, string>,
  ): Promise<Array<Record<string, unknown>>> {
    await this.throttle();

    const query = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/${path}${query ? `?${query}` : ""}`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), UPBIT_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Upbit request failed: ${response.status} ${response.statusText} for ${path}?${query}. Body: ${truncate(body, 300)}`,
        );
      }

      const json = await response.json();
      if (!Array.isArray(json)) {
        throw new Error(
          `Upbit response was not an array for ${path}?${query}. Body: ${truncate(JSON.stringify(json), 300)}`,
        );
      }
      return json as Array<Record<string, unknown>>;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Upbit request timed out after ${UPBIT_REQUEST_TIMEOUT_MS}ms for ${path}?${query}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const wait = this.nextSlot - now;
    this.nextSlot = Math.max(now, this.nextSlot) + UPBIT_MIN_INTERVAL_MS;
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
