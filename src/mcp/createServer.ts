import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerTools } from "./registry.js";
import type { ServiceRegistry } from "./services.js";

const SERVER_INSTRUCTIONS = `bagger-mcp — personal investing research server for one Korean retail investor. 58 tools across 13 domains.

Routing map:
- US/global equities: get_stock_info, get_historical_stock_prices, get_financial_statement, get_holder_info, get_recommendations, get_stock_actions, get_yahoo_finance_news (Yahoo Finance)
- Korean equities: krx_* (KOSPI/KOSDAQ daily prices, listing info, indices, ETFs), dart_* (OpenDART 공시/재무/기업개요/회사검색)
- The user's real brokerage account: tossinvest_* (portfolio, orders, buyable amount, sellable qty, FX, market calendar)
- Crypto prices: upbit_*, bithumb_* (KR exchanges), binance_* (global), coingecko_* (market caps, trending, categories, global stats)
- Real estate: naverland_* (listings, complexes, price info, commercial, watchlist), molit_* (국토부 아파트 실거래가/전월세)
- Intake: telegram_list_channels / telegram_read_channels (the user's subscribed investing channels), x_search (X/Grok live search)
- Long-term memory: memory_* — read protocol below is mandatory
- Trade decisions: decision_log_append / decision_log_amend

MEMORY READ PROTOCOL — run BEFORE answering, not after.
For any question about a ticker, sector, macro read, entry/exit/sizing, or "what do you think about X", the user's own prior reasoning very likely already exists in the memory repo (mopil/memory-space). Answering from general knowledge while that sits unread is this server's main failure mode.
1. memory_search first. The user's judgment frames, existing theses, and logged mistakes outrank anything you would reconstruct.
2. Search is GitHub Code Search — LEXICAL, not semantic, and weak on Korean tokenization. One query proves nothing. Retry with the ticker, the English term, the Korean term, and the concept name (e.g. "HBM" / "메모리" / "memory-cycle"). Also grep the frontmatter "aliases" line, which carries KR/EN synonyms and tickers for exactly this reason.
3. Still nothing? memory_read wiki/routing.md — a map of where things live — and follow it. Never conclude "nothing is stored" from failed searches alone.
4. Prefer wiki/ over sources/ (raw and noisy). Narrow with the path qualifier: wiki/investing/principles, wiki/investing/theses, wiki/investing/lessons, wiki/logs/decisions.
5. Cite what you found by page name, and say plainly when memory is silent rather than implying it was consulted.
Some pages are tens of KB — narrow via the routing map or search snippets instead of reading big files speculatively.
memory_capture appends one raw entry to sources/_inbox/; lightweight and safe without explicit consent. Announce the stored path after. Ingest and lint are not tools — they run against a local clone via the /ingest and /lint skills. This server's job is capture + read; structuring happens at the desk.`;

export function createMcpServer(services: ServiceRegistry): McpServer {
  const server = new McpServer(
    {
      name: "bagger-mcp",
      version: "0.1.0",
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  registerTools(server, services);

  return server;
}
