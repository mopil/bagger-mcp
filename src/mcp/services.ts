import type { BinanceService } from "../tools/crypto/binance/service.js";
import type { BithumbService } from "../tools/crypto/bithumb/service.js";
import type { CoingeckoService } from "../tools/crypto/coingecko/service.js";
import type { GrokService } from "../tools/grok/service.js";
import type { KrxService } from "../tools/krx/service.js";
import type { MemoryService } from "../tools/memory/service.js";
import type { TelegramService } from "../tools/telegram/service.js";
import type { UpbitService } from "../tools/crypto/upbit/service.js";
import type { YahooFinanceService } from "../tools/yahoo-finance/service.js";

export interface ServiceRegistry {
  telegramService: TelegramService;
  grokService: GrokService;
  yahooFinanceService: YahooFinanceService;
  memoryService: MemoryService;
  krxService: KrxService;
  upbitService: UpbitService;
  bithumbService: BithumbService;
  binanceService: BinanceService;
  coingeckoService: CoingeckoService;
}
