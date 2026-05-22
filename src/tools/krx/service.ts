import type { KrxDailyParams } from "./schema.js";

const KRX_BASE_URL = "http://data-dbg.krx.co.kr/svc/apis";
const KRX_REQUEST_TIMEOUT_MS = 15_000;
const KRX_CACHE_TTL_TODAY_MS = 10 * 60 * 1000;
const KRX_CACHE_TTL_PAST_MS = 24 * 60 * 60 * 1000;

function ttlForBasDd(basDd: string): number {
  const today = new Date();
  const yyyymmdd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  return basDd < yyyymmdd ? KRX_CACHE_TTL_PAST_MS : KRX_CACHE_TTL_TODAY_MS;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

interface KrxResponse {
  OutBlock_1?: Array<Record<string, unknown>>;
}

export interface KrxServiceOptions {
  authKey: string;
}

export class KrxService {
  private readonly authKey: string;
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(options: KrxServiceOptions) {
    this.authKey = options.authKey;
  }

  getKospiIndexDaily(params: KrxDailyParams) {
    return this.fetchEndpoint("idx/kospi_dd_trd", params);
  }

  getKosdaqIndexDaily(params: KrxDailyParams) {
    return this.fetchEndpoint("idx/kosdaq_dd_trd", params);
  }

  getStockDailyKospi(params: KrxDailyParams) {
    return this.fetchEndpoint("sto/stk_bydd_trd", params);
  }

  getStockDailyKosdaq(params: KrxDailyParams) {
    return this.fetchEndpoint("sto/ksq_bydd_trd", params);
  }

  getStockBaseInfoKospi(params: KrxDailyParams) {
    return this.fetchEndpoint("sto/stk_isu_base_info", params);
  }

  getStockBaseInfoKosdaq(params: KrxDailyParams) {
    return this.fetchEndpoint("sto/ksq_isu_base_info", params);
  }

  getEtfDaily(params: KrxDailyParams) {
    return this.fetchEndpoint("etp/etf_bydd_trd", params);
  }

  private async fetchEndpoint(path: string, params: KrxDailyParams) {
    const cacheKey = `${path}:${params.basDd}`;
    const ttl = ttlForBasDd(params.basDd);
    const rows = await this.getCached(cacheKey, ttl, () => this.requestJson(path, params));

    return {
      endpoint: path,
      basDd: params.basDd,
      rowCount: rows.length,
      rows,
    };
  }

  private async requestJson(path: string, params: KrxDailyParams): Promise<Array<Record<string, unknown>>> {
    const url = `${KRX_BASE_URL}/${path}?basDd=${encodeURIComponent(params.basDd)}`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), KRX_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          AUTH_KEY: this.authKey,
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `KRX request failed: ${response.status} ${response.statusText} for ${path}?basDd=${params.basDd}. Body: ${truncate(body, 300)}`,
        );
      }

      const json = (await response.json()) as KrxResponse;
      return json.OutBlock_1 ?? [];
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`KRX request timed out after ${KRX_REQUEST_TIMEOUT_MS}ms for ${path}?basDd=${params.basDd}`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
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
