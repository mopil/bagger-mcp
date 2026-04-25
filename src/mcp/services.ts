import type { GrokService } from "../tools/grok/service.js";
import type { KrxService } from "../tools/krx/service.js";
import type { MemoryService } from "../tools/memory/service.js";
import type { TelegramService } from "../tools/telegram/service.js";
import type { UpbitService } from "../tools/upbit/service.js";
import type { YahooFinanceService } from "../tools/yahoo-finance/service.js";

export interface ServiceRegistry {
  telegramService: TelegramService;
  grokService: GrokService;
  yahooFinanceService: YahooFinanceService;
  memoryService: MemoryService;
  krxService: KrxService;
  upbitService: UpbitService;
}
