import YahooFinance from "yahoo-finance2";

type HistoricalInterval = "1d" | "1wk" | "1mo";
type FinancialStatementType = "income_statement" | "balance_sheet" | "cash_flow";
type FinancialStatementFrequency = "quarterly" | "annual" | "trailing";

export interface HistoricalStockPricesParams {
  symbol: string;
  fromDate: string;
  toDate?: string;
  interval?: HistoricalInterval;
}

export interface StockInfoParams {
  symbol: string;
}

export interface YahooFinanceNewsParams {
  query: string;
  newsCount?: number;
}

export interface StockActionsParams {
  symbol: string;
  fromDate: string;
  toDate?: string;
}

export interface FinancialStatementParams {
  symbol: string;
  statementType: FinancialStatementType;
  frequency?: FinancialStatementFrequency;
  fromDate: string;
  toDate?: string;
}

export interface HolderInfoParams {
  symbol: string;
}

export interface RecommendationsParams {
  symbol: string;
}

const DEFAULT_NEWS_COUNT = 10;

export class YahooFinanceService {
  private readonly client = new YahooFinance();

  async getHistoricalStockPrices(params: HistoricalStockPricesParams) {
    validateDateRange(params.fromDate, params.toDate);

    const rows = await this.client.historical(params.symbol, {
      period1: params.fromDate,
      ...(params.toDate ? { period2: params.toDate } : {}),
      ...(params.interval ? { interval: params.interval } : {}),
      events: "history",
    });

    return {
      symbol: params.symbol.toUpperCase(),
      interval: params.interval ?? "1d",
      fromDate: params.fromDate,
      toDate: params.toDate ?? null,
      prices: rows.map((row) => ({
        date: row.date.toISOString(),
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        adjClose: row.adjClose ?? null,
        volume: row.volume,
      })),
    };
  }

  async getStockInfo(params: StockInfoParams) {
    const [quote, summary] = await Promise.all([
      this.client.quote(params.symbol),
      this.client.quoteSummary(params.symbol, {
        modules: ["price", "summaryDetail", "summaryProfile", "financialData", "defaultKeyStatistics"],
      }),
    ]);

    return {
      symbol: quote.symbol,
      quote,
      summary,
    };
  }

  async getYahooFinanceNews(params: YahooFinanceNewsParams) {
    const newsCount = normalizeNewsCount(params.newsCount);
    const result = await this.client.search(params.query, {
      newsCount,
      quotesCount: 0,
    });

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
    validateDateRange(params.fromDate, params.toDate);

    const [dividends, splits] = await Promise.all([
      this.client.historical(params.symbol, {
        period1: params.fromDate,
        ...(params.toDate ? { period2: params.toDate } : {}),
        events: "dividends",
      }),
      this.client.historical(params.symbol, {
        period1: params.fromDate,
        ...(params.toDate ? { period2: params.toDate } : {}),
        events: "split",
      }),
    ]);

    return {
      symbol: params.symbol.toUpperCase(),
      fromDate: params.fromDate,
      toDate: params.toDate ?? null,
      dividends: dividends.map((row) => ({
        date: row.date.toISOString(),
        dividends: row.dividends,
      })),
      splits: splits.map((row) => ({
        date: row.date.toISOString(),
        stockSplits: row.stockSplits,
      })),
    };
  }

  async getFinancialStatement(params: FinancialStatementParams) {
    validateDateRange(params.fromDate, params.toDate);

    const frequency = params.frequency ?? "quarterly";
    const rows = await this.client.fundamentalsTimeSeries(params.symbol, {
      period1: params.fromDate,
      ...(params.toDate ? { period2: params.toDate } : {}),
      type: frequency,
      module: mapStatementTypeToModule(params.statementType),
    });

    return {
      symbol: params.symbol.toUpperCase(),
      statementType: params.statementType,
      frequency,
      fromDate: params.fromDate,
      toDate: params.toDate ?? null,
      statements: rows.map((row) => serializeRecord(row)),
    };
  }

  async getHolderInfo(params: HolderInfoParams) {
    const summary = await this.client.quoteSummary(params.symbol, {
      modules: [
        "institutionOwnership",
        "fundOwnership",
        "majorHoldersBreakdown",
        "insiderHolders",
        "majorDirectHolders",
      ],
    });

    return {
      symbol: params.symbol.toUpperCase(),
      summary,
    };
  }

  async getRecommendations(params: RecommendationsParams) {
    const result = await this.client.recommendationsBySymbol(params.symbol);

    return {
      symbol: result.symbol,
      recommendedSymbols: result.recommendedSymbols,
    };
  }
}

function normalizeNewsCount(newsCount = DEFAULT_NEWS_COUNT): number {
  if (!Number.isInteger(newsCount) || newsCount <= 0 || newsCount > 50) {
    throw new Error("newsCount must be an integer between 1 and 50");
  }

  return newsCount;
}

function validateDateRange(fromDate: string, toDate: string | undefined): void {
  if (toDate && fromDate > toDate) {
    throw new Error("fromDate must be earlier than or equal to toDate.");
  }
}

function mapStatementTypeToModule(statementType: FinancialStatementType): string {
  switch (statementType) {
    case "income_statement":
      return "financials";
    case "balance_sheet":
      return "balance-sheet";
    case "cash_flow":
      return "cash-flow";
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
