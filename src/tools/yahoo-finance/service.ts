import YahooFinance from "yahoo-finance2";
import type {
  FinancialStatementParams,
  HistoricalStockPricesParams,
  HolderInfoParams,
  RecommendationsParams,
  StockActionsParams,
  StockInfoParams,
  YahooFinanceNewsParams,
} from "./schema.js";

const DEFAULT_NEWS_COUNT = 5;
const DEFAULT_HISTORICAL_LIMIT = 120;
const DEFAULT_ACTIONS_LIMIT = 20;
const DEFAULT_FINANCIAL_STATEMENT_LIMIT = 8;
const MAX_NEWS_COUNT = 20;
const MAX_HISTORICAL_LIMIT = 1000;
const MAX_ACTIONS_LIMIT = 200;
const MAX_FINANCIAL_STATEMENT_LIMIT = 40;
const YAHOO_REQUEST_TIMEOUT_MS = 15_000;
const YAHOO_CACHE_TTL_MS = 5 * 60 * 1000;
const BUSINESS_SUMMARY_LIMIT = 1200;
const ISO_DATE_ERROR_SUFFIX = "Use a valid calendar date in YYYY-MM-DD format.";

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

interface HistoricalPriceRow {
  date: Date;
  open: number | null | undefined;
  high: number | null | undefined;
  low: number | null | undefined;
  close: number | null | undefined;
  adjClose?: number | null;
  volume: number | null | undefined;
}

interface HistoricalDividendRow {
  date: Date;
  dividends?: number | null;
}

interface HistoricalSplitRow {
  date: Date;
  stockSplits?: string | null;
}

export class YahooFinanceService {
  private readonly client = new YahooFinance();
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  async getHistoricalStockPrices(params: HistoricalStockPricesParams) {
    const toDate = normalizeOptionalDate(params.toDate);
    validateDateRange(params.fromDate, toDate);
    const limit = normalizeHistoricalLimit(params.limit);
    const requestOptions = buildHistoricalRequestOptions({
      period1: params.fromDate,
      period2: toDate,
      interval: params.interval,
      events: "history",
    });

    const cacheKey = buildCacheKey("historical", { ...params, toDate, limit });
    const rows = await this.getCached<HistoricalPriceRow[]>(cacheKey, () =>
      withTimeout(
        this.executeHistoricalRequest<HistoricalPriceRow[]>(params.symbol, requestOptions),
        YAHOO_REQUEST_TIMEOUT_MS,
        "Yahoo Finance historical request timed out.",
      ));

    return {
      symbol: params.symbol.toUpperCase(),
      interval: params.interval ?? "1d",
      fromDate: params.fromDate,
      toDate: toDate ?? null,
      prices: rows
        .map((row) => ({
          date: row.date.toISOString(),
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          adjClose: row.adjClose ?? null,
          volume: row.volume,
        }))
        .sort((left, right) => right.date.localeCompare(left.date))
        .slice(0, limit),
    };
  }

  async getStockInfo(params: StockInfoParams) {
    const cacheKey = buildCacheKey("stock-info", params);
    return this.getCached(cacheKey, async () => {
      const [quote, summary] = await withTimeout(
        Promise.all([
          this.client.quote(params.symbol),
          this.client.quoteSummary(params.symbol, {
            modules: ["price", "summaryDetail", "summaryProfile", "financialData", "defaultKeyStatistics"],
          }),
        ]),
        YAHOO_REQUEST_TIMEOUT_MS,
        "Yahoo Finance stock info request timed out.",
      );

      return {
        symbol: quote.symbol,
        companyName: quote.longName ?? quote.shortName ?? quote.symbol,
        exchange: quote.fullExchangeName,
        currency: quote.currency ?? null,
        marketState: quote.marketState,
        price: {
          regularMarketPrice: quote.regularMarketPrice ?? null,
          regularMarketChange: quote.regularMarketChange ?? null,
          regularMarketChangePercent: quote.regularMarketChangePercent ?? null,
          regularMarketOpen: quote.regularMarketOpen ?? null,
          regularMarketDayHigh: quote.regularMarketDayHigh ?? null,
          regularMarketDayLow: quote.regularMarketDayLow ?? null,
          regularMarketVolume: quote.regularMarketVolume ?? null,
          marketCap: quote.marketCap ?? null,
          fiftyTwoWeekLow: quote.fiftyTwoWeekLow ?? null,
          fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh ?? null,
        },
        valuation: {
          trailingPE: quote.trailingPE ?? summary.summaryDetail?.trailingPE ?? null,
          forwardPE: quote.forwardPE ?? summary.summaryDetail?.forwardPE ?? null,
          priceToBook: quote.priceToBook ?? summary.defaultKeyStatistics?.priceToBook ?? null,
          enterpriseToEbitda: summary.defaultKeyStatistics?.enterpriseToEbitda ?? null,
          enterpriseToRevenue: summary.defaultKeyStatistics?.enterpriseToRevenue ?? null,
        },
        business: {
          sector: summary.summaryProfile?.sector ?? null,
          industry: summary.summaryProfile?.industry ?? null,
          website: summary.summaryProfile?.website ?? null,
          country: summary.summaryProfile?.country ?? null,
          employees: summary.summaryProfile?.fullTimeEmployees ?? null,
          longBusinessSummary: truncateText(summary.summaryProfile?.longBusinessSummary ?? null, BUSINESS_SUMMARY_LIMIT),
        },
        financials: {
          totalRevenue: summary.financialData?.totalRevenue ?? null,
          revenueGrowth: summary.financialData?.revenueGrowth ?? null,
          grossMargins: summary.financialData?.grossMargins ?? null,
          operatingMargins: summary.financialData?.operatingMargins ?? null,
          profitMargins: summary.financialData?.profitMargins ?? null,
          returnOnEquity: summary.financialData?.returnOnEquity ?? null,
          returnOnAssets: summary.financialData?.returnOnAssets ?? null,
          debtToEquity: summary.financialData?.debtToEquity ?? null,
          currentRatio: summary.financialData?.currentRatio ?? null,
          freeCashflow: summary.financialData?.freeCashflow ?? null,
          operatingCashflow: summary.financialData?.operatingCashflow ?? null,
        },
      };
    });
  }

  async getYahooFinanceNews(params: YahooFinanceNewsParams) {
    const newsCount = normalizeNewsCount(params.newsCount);
    const cacheKey = buildCacheKey("news", { ...params, newsCount });
    const result = await this.getCached(cacheKey, () =>
      withTimeout(
        this.client.search(params.query, {
          newsCount,
          quotesCount: 0,
        }),
        YAHOO_REQUEST_TIMEOUT_MS,
        "Yahoo Finance news request timed out.",
      ));

    return {
      query: params.query,
      newsCount: result.news.length,
      news: result.news.map((item) => ({
        uuid: item.uuid,
        title: item.title,
        publisher: item.publisher,
        link: item.link,
        providerPublishTime: item.providerPublishTime.toISOString(),
        type: item.type,
        relatedTickers: item.relatedTickers ?? [],
      })),
    };
  }

  async getStockActions(params: StockActionsParams) {
    const toDate = normalizeOptionalDate(params.toDate);
    validateDateRange(params.fromDate, toDate);
    const limit = normalizeActionsLimit(params.limit);
    const cacheKey = buildCacheKey("actions", { ...params, toDate, limit });
    const dividendsOptions = buildHistoricalRequestOptions({
      period1: params.fromDate,
      period2: toDate,
      events: "dividends",
    });
    const splitsOptions = buildHistoricalRequestOptions({
      period1: params.fromDate,
      period2: toDate,
      events: "split",
    });
    const [dividends, splits] = await this.getCached<[HistoricalDividendRow[], HistoricalSplitRow[]]>(cacheKey, () =>
      withTimeout(
        Promise.all([
          this.executeHistoricalRequest<HistoricalDividendRow[]>(params.symbol, dividendsOptions),
          this.executeHistoricalRequest<HistoricalSplitRow[]>(params.symbol, splitsOptions),
        ]),
        YAHOO_REQUEST_TIMEOUT_MS,
        "Yahoo Finance stock actions request timed out.",
      ));

    return {
      symbol: params.symbol.toUpperCase(),
      fromDate: params.fromDate,
      toDate: toDate ?? null,
      dividends: dividends
        .map((row) => ({
          date: row.date.toISOString(),
          dividends: row.dividends,
        }))
        .sort((left, right) => right.date.localeCompare(left.date))
        .slice(0, limit),
      splits: splits
        .map((row) => ({
          date: row.date.toISOString(),
          stockSplits: row.stockSplits,
        }))
        .sort((left, right) => right.date.localeCompare(left.date))
        .slice(0, limit),
    };
  }

  async getFinancialStatement(params: FinancialStatementParams) {
    const toDate = normalizeOptionalDate(params.toDate);
    validateDateRange(params.fromDate, toDate);

    const frequency = params.frequency ?? "quarterly";
    const limit = normalizeFinancialStatementLimit(params.limit);
    const cacheKey = buildCacheKey("financial-statement", { ...params, toDate, frequency, limit });
    const rows = await this.getCached(cacheKey, () =>
      withTimeout(
        this.client.fundamentalsTimeSeries(params.symbol, {
          period1: params.fromDate,
          ...(toDate ? { period2: toDate } : {}),
          type: frequency,
          module: mapStatementTypeToModule(params.statementType),
        }),
        YAHOO_REQUEST_TIMEOUT_MS,
        "Yahoo Finance financial statement request timed out.",
      ));

    const statements = rows
      .map((row) => serializeRecord(row))
      .sort((left, right) => String(right.date).localeCompare(String(left.date)))
      .slice(0, limit);

    return {
      symbol: params.symbol.toUpperCase(),
      statementType: params.statementType,
      frequency,
      fromDate: params.fromDate,
      toDate: toDate ?? null,
      statements,
      rowCount: statements.length,
    };
  }

  async getHolderInfo(params: HolderInfoParams) {
    const cacheKey = buildCacheKey("holder-info", params);
    return this.getCached(cacheKey, async () => {
      const summary = await withTimeout(
        this.client.quoteSummary(params.symbol, {
          modules: [
            "institutionOwnership",
            "fundOwnership",
            "majorHoldersBreakdown",
            "insiderHolders",
            "majorDirectHolders",
          ],
        }),
        YAHOO_REQUEST_TIMEOUT_MS,
        "Yahoo Finance holder info request timed out.",
      );

      return {
        symbol: params.symbol.toUpperCase(),
        majorHoldersBreakdown: {
          insidersPercentHeld: summary.majorHoldersBreakdown?.insidersPercentHeld ?? null,
          institutionsPercentHeld: summary.majorHoldersBreakdown?.institutionsPercentHeld ?? null,
          institutionsFloatPercentHeld: summary.majorHoldersBreakdown?.institutionsFloatPercentHeld ?? null,
          institutionsCount: summary.majorHoldersBreakdown?.institutionsCount ?? null,
        },
        topInstitutionOwners: (summary.institutionOwnership?.ownershipList ?? [])
          .slice(0, 5)
          .map((holder) => ({
            organization: holder.organization ?? null,
            reportDate: holder.reportDate instanceof Date ? holder.reportDate.toISOString() : null,
            pctHeld: holder.pctHeld ?? null,
            position: holder.position ?? null,
            value: holder.value ?? null,
          })),
        topFundOwners: (summary.fundOwnership?.ownershipList ?? [])
          .slice(0, 5)
          .map((holder) => ({
            organization: holder.organization ?? null,
            reportDate: holder.reportDate instanceof Date ? holder.reportDate.toISOString() : null,
            pctHeld: holder.pctHeld ?? null,
            position: holder.position ?? null,
            value: holder.value ?? null,
          })),
        insiderHolders: (summary.insiderHolders?.holders ?? [])
          .slice(0, 5)
          .map((holder) => serializeRecord(holder)),
        majorDirectHolders: (summary.majorDirectHolders?.holders ?? [])
          .slice(0, 5)
          .map((holder) => serializeRecord(holder)),
      };
    });
  }

  async getRecommendations(params: RecommendationsParams) {
    const cacheKey = buildCacheKey("recommendations", params);
    const result = await this.getCached(cacheKey, () =>
      withTimeout(
        this.client.recommendationsBySymbol(params.symbol),
        YAHOO_REQUEST_TIMEOUT_MS,
        "Yahoo Finance recommendations request timed out.",
      ));

    return {
      symbol: result.symbol,
      recommendedSymbols: result.recommendedSymbols.slice(0, 5),
    };
  }

  private async getCached<T>(key: string, loader: () => Promise<T>): Promise<T> {
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
        this.cache.set(key, {
          value,
          expiresAt: Date.now() + YAHOO_CACHE_TTL_MS,
        });
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  private async executeHistoricalRequest<TResult>(symbol: string, options: HistoricalRequestOptions): Promise<TResult> {
    try {
      return await this.client.historical(symbol, options) as TResult;
    } catch (error) {
      throw wrapHistoricalOptionsError(error, symbol, options);
    }
  }
}

interface HistoricalRequestOptions {
  period1: string;
  period2?: string;
  interval?: HistoricalStockPricesParams["interval"];
  events: "history" | "dividends" | "split";
}

function normalizeNewsCount(newsCount: number | null | undefined = DEFAULT_NEWS_COUNT): number {
  const normalizedNewsCount = newsCount ?? DEFAULT_NEWS_COUNT;
  if (!Number.isInteger(normalizedNewsCount) || normalizedNewsCount <= 0 || normalizedNewsCount > MAX_NEWS_COUNT) {
    throw new Error(`newsCount must be an integer between 1 and ${MAX_NEWS_COUNT}`);
  }

  return normalizedNewsCount;
}

function normalizeHistoricalLimit(limit: number | null | undefined = DEFAULT_HISTORICAL_LIMIT): number {
  const normalizedLimit = limit ?? DEFAULT_HISTORICAL_LIMIT;
  if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0 || normalizedLimit > MAX_HISTORICAL_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_HISTORICAL_LIMIT}`);
  }

  return normalizedLimit;
}

function normalizeActionsLimit(limit: number | null | undefined = DEFAULT_ACTIONS_LIMIT): number {
  const normalizedLimit = limit ?? DEFAULT_ACTIONS_LIMIT;
  if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0 || normalizedLimit > MAX_ACTIONS_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_ACTIONS_LIMIT}`);
  }

  return normalizedLimit;
}

function normalizeFinancialStatementLimit(limit: number | null | undefined = DEFAULT_FINANCIAL_STATEMENT_LIMIT): number {
  const normalizedLimit = limit ?? DEFAULT_FINANCIAL_STATEMENT_LIMIT;
  if (!Number.isInteger(normalizedLimit) || normalizedLimit <= 0 || normalizedLimit > MAX_FINANCIAL_STATEMENT_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_FINANCIAL_STATEMENT_LIMIT}`);
  }

  return normalizedLimit;
}

function validateDateRange(fromDate: string, toDate: string | null | undefined): void {
  assertValidIsoDate("fromDate", fromDate);
  if (toDate) {
    assertValidIsoDate("toDate", toDate);
  }

  if (toDate && fromDate >= toDate) {
    throw new Error(
      `toDate must be later than fromDate. Received fromDate=${fromDate}, toDate=${toDate}.`,
    );
  }
}

function normalizeOptionalDate(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

function mapStatementTypeToModule(statementType: FinancialStatementParams["statementType"]): string {
  switch (statementType) {
    case "income_statement":
      return "financials";
    case "balance_sheet":
      return "balance-sheet";
    case "cash_flow":
      return "cash-flow";
  }
}

function buildHistoricalRequestOptions(options: HistoricalRequestOptions): HistoricalRequestOptions {
  return {
    period1: options.period1,
    ...(options.period2 ? { period2: options.period2 } : {}),
    ...(options.interval ? { interval: options.interval } : {}),
    events: options.events,
  };
}

function wrapHistoricalOptionsError(
  error: unknown,
  symbol: string,
  options: HistoricalRequestOptions,
): Error {
  if (!(error instanceof Error)) {
    return new Error("Unknown Yahoo Finance historical request failure.");
  }

  if (error.name !== "InvalidOptionsError" && !error.message.includes("invalid options")) {
    return error;
  }

  const renderedOptions = JSON.stringify(options);
  const renderedSummary = [
    `period1=${options.period1}`,
    `period2=${options.period2 ?? "<omitted>"}`,
    `interval=${options.interval ?? "<default:1d>"}`,
    `events=${options.events}`,
  ].join(", ");

  return new Error(
    `Yahoo Finance rejected historical options for ${symbol.toUpperCase()}: ${renderedSummary}. ` +
      `Raw options=${renderedOptions}. This usually means one of period1/period2/interval is invalid for the requested range.`,
  );
}

function assertValidIsoDate(fieldName: "fromDate" | "toDate", value: string): void {
  const date = new Date(`${value}T00:00:00.000Z`);
  const isValid = Number.isFinite(date.getTime()) && date.toISOString().startsWith(`${value}T`);
  if (!isValid) {
    throw new Error(`${fieldName} is invalid: "${value}". ${ISO_DATE_ERROR_SUFFIX}`);
  }
}

function serializeRecord<T extends object>(record: T) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => {
      if (value instanceof Date) {
        return [key, value.toISOString()];
      }

      return [key, value];
    }),
  );
}

function buildCacheKey(scope: string, params: object): string {
  return `${scope}:${JSON.stringify(params)}`;
}

function truncateText(value: string | null, maxLength: number): string | null {
  if (!value) {
    return value;
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
