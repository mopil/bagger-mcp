import assert from "node:assert/strict";

import { YahooFinanceService } from "../../../src/tools/yahoo-finance/service.js";

const service = new YahooFinanceService();
let historicalOptions: Record<string, unknown> | undefined;

(service as any).client = {
  chart: async (_symbol: string, options: Record<string, unknown>) => {
    historicalOptions = options;
    return {
      quotes: [
        {
          date: new Date("2025-01-03T00:00:00.000Z"),
          open: 102,
          high: 103,
          low: 101,
          close: 110,
          adjClose: 110,
          volume: 3000,
        },
      ],
    };
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

await assert.rejects(
  () =>
    service.getHistoricalStockPrices({
      symbol: "AAPL",
      fromDate: "2025-02-30",
    }),
  /fromDate is invalid: "2025-02-30"\. Use a valid calendar date in YYYY-MM-DD format\./,
);

await assert.rejects(
  () =>
    service.getHistoricalStockPrices({
      symbol: "AAPL",
      fromDate: "2025-01-01",
      toDate: "2025-01-01",
    }),
  /toDate must be later than fromDate\. Received fromDate=2025-01-01, toDate=2025-01-01\./,
);

(service as any).client.chart = async () => {
  const error = new Error("yahooFinance.historical called with invalid options.");
  error.name = "InvalidOptionsError";
  throw error;
};

await assert.rejects(
  () =>
    service.getHistoricalStockPrices({
      symbol: "aapl",
      fromDate: "2025-01-01",
      toDate: "2025-01-02",
    }),
  /Yahoo Finance rejected chart options for AAPL: period1=2025-01-01, period2=2025-01-02, interval=<default:1d>, events=<default:div\|split\|earn>\. Raw options={"period1":"2025-01-01","period2":"2025-01-02"}\. This usually means one of period1\/period2\/interval is invalid for the requested range\./,
);

await assert.rejects(
  () =>
    service.getHistoricalStockPrices({
      symbol: "lwlg",
      fromDate: "2025-04-01",
      interval: "1wk",
    }),
  /Yahoo Finance rejected chart options for LWLG: period1=2025-04-01, period2=<omitted>, interval=1wk, events=<default:div\|split\|earn>\. Raw options={"period1":"2025-04-01","interval":"1wk"}\. This usually means one of period1\/period2\/interval is invalid for the requested range\./,
);
