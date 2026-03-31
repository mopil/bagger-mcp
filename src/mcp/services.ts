import type { GrokService } from "../tools/grok/service.js";
import type { TelegramService } from "../tools/telegram/service.js";
import type { YahooFinanceService } from "../tools/yahoo-finance/service.js";

export interface ServiceRegistry {
  telegramService: TelegramService;
  grokService: GrokService;
  yahooFinanceService: YahooFinanceService;
}
