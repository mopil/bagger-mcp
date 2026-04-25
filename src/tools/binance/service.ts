import type {
  BinanceGetKlinesInput,
  BinanceGetTickerInput,
  BinanceKlineInterval,
} from "./schema.js";

const BINANCE_BASE_URL = "https://api.binance.com/api/v3";
const BINANCE_REQUEST_TIMEOUT_MS = 15_000;
const BINANCE_MIN_INTERVAL_MS = 110;
const SYMBOLS_CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const INTERVAL_MAP: Record<BinanceKlineInterval, string> = {
  "1h": "1h",
  "4h": "4h",
  day: "1d",
  week: "1w",
  month: "1M",
};

const KLINE_FIELDS = [
  "open_time",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "close_time",
  "quote_volume",
  "trades",
  "taker_buy_base_volume",
  "taker_buy_quote_volume",
] as const;

export interface BinanceServiceOptions {
  baseUrl?: string;
}

export class BinanceService {
  private readonly baseUrl: string;
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private nextSlot = 0;

  constructor(options: BinanceServiceOptions = {}) {
    this.baseUrl = options.baseUrl ?? BINANCE_BASE_URL;
  }

  listSymbols() {
    return this.getCached("exchangeInfo:SPOT", SYMBOLS_CACHE_TTL_MS, async () => {
      const json = await this.requestJson<{
        symbols?: Array<Record<string, unknown>>;
      }>("exchangeInfo", { permissions: "SPOT" });
      const rows = (json.symbols ?? []).map((s) => ({
        symbol: s.symbol,
        status: s.status,
        baseAsset: s.baseAsset,
        quoteAsset: s.quoteAsset,
        isSpotTradingAllowed: s.isSpotTradingAllowed,
      }));
      return { rowCount: rows.length, rows };
    });
  }

  async getTicker(input: BinanceGetTickerInput) {
    const symbolsParam = JSON.stringify(input.symbols);
    const json = await this.requestJson<unknown>("ticker/24hr", {
      symbols: symbolsParam,
    });
    const rows = Array.isArray(json) ? json : [json];
    return { rowCount: rows.length, rows };
  }

  async getKlines(input: BinanceGetKlinesInput) {
    const params: Record<string, string> = {
      symbol: input.symbol,
      interval: INTERVAL_MAP[input.interval],
    };
    if (input.limit !== undefined) params.limit = String(input.limit);
    if (input.startTime !== undefined) params.startTime = String(input.startTime);
    if (input.endTime !== undefined) params.endTime = String(input.endTime);

    const raw = await this.requestJson<Array<Array<unknown>>>("klines", params);
    if (!Array.isArray(raw)) {
      throw new Error(`Binance klines response was not an array for ${input.symbol}.`);
    }
    const rows = raw.map((row) => {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < KLINE_FIELDS.length; i++) {
        obj[KLINE_FIELDS[i]] = row[i];
      }
      return obj;
    });
    return {
      symbol: input.symbol,
      interval: input.interval,
      rowCount: rows.length,
      rows,
    };
  }

  private async requestJson<T>(path: string, params: Record<string, string>): Promise<T> {
    await this.throttle();

    const query = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/${path}${query ? `?${query}` : ""}`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), BINANCE_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Binance request failed: ${response.status} ${response.statusText} for ${path}?${query}. Body: ${truncate(body, 300)}`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Binance request timed out after ${BINANCE_REQUEST_TIMEOUT_MS}ms for ${path}?${query}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const wait = this.nextSlot - now;
    this.nextSlot = Math.max(now, this.nextSlot) + BINANCE_MIN_INTERVAL_MS;
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
