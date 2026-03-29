import assert from "node:assert/strict";

import { formatHistoricalPricesText } from "../../../src/tools/yahoo-finance/register.js";

const text = formatHistoricalPricesText({
  symbol: "AAPL",
  interval: "1d",
  fromDate: "2025-01-01",
  toDate: "2025-01-03",
  prices: [
    {
      date: "2025-01-03T00:00:00.000Z",
      open: 102,
      high: 103,
      low: 101,
      close: 110,
      adjClose: 110,
      volume: 3000,
    },
    {
      date: "2025-01-02T00:00:00.000Z",
      open: 101,
      high: 102,
      low: 100,
      close: 105,
      adjClose: 105,
      volume: 2000,
    },
    {
      date: "2025-01-01T00:00:00.000Z",
      open: 100,
      high: 101,
      low: 99,
      close: 99,
      adjClose: 99,
      volume: 1000,
    },
  ],
});

assert.match(text, /Latest close 110 on 2025-01-03T00:00:00\.000Z\./);
