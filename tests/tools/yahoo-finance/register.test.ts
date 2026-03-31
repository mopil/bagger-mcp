import assert from "node:assert/strict";

import { YahooFinanceService } from "../../../src/tools/yahoo-finance/service.js";

const service = new YahooFinanceService();
let historicalOptions: Record<string, unknown> | undefined;

(service as any).client = {
  historical: async (_symbol: string, options: Record<string, unknown>) => {
    historicalOptions = options;
    return [
      {
        date: new Date("2025-01-03T00:00:00.000Z"),
        open: 102,
        high: 103,
        low: 101,
        close: 110,
        adjClose: 110,
        volume: 3000,
      },
    ];
  },
};

const historical = await service.getHistoricalStockPrices({
  symbol: "AAPL",
  fromDate: "2025-01-01",
  toDate: null as unknown as string,
  limit: null as unknown as number,
});

assert.equal(historical.toDate, null);
assert.equal(historical.prices.length, 1);
assert.deepEqual(historicalOptions, {
  period1: "2025-01-01",
  events: "history",
});

let searchOptions: Record<string, unknown> | undefined;
(service as any).client.search = async (_query: string, options: Record<string, unknown>) => {
  searchOptions = options;
  return {
    news: [],
  };
};

const news = await service.getYahooFinanceNews({
  query: "AAPL",
  newsCount: null as unknown as number,
});

assert.equal(news.newsCount, 0);
assert.deepEqual(searchOptions, {
  newsCount: 5,
  quotesCount: 0,
});
