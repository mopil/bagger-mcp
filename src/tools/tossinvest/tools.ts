import { defineServiceTool } from "../defineTool.js";
import type { ServiceRegistry } from "../../mcp/services.js";
import {
  tossGetBuyableAmountInputSchema,
  tossGetExchangeRateInputSchema,
  tossGetMarketCalendarInputSchema,
  tossGetPortfolioInputSchema,
  tossGetSellableQuantityInputSchema,
  tossGetStockInfoInputSchema,
  tossListOrdersInputSchema,
} from "./schema.js";

const tool = defineServiceTool<ServiceRegistry>();

const NOTE =
  "[토스증권 Open API. 본인 계좌 실데이터. 금액은 문자열, 통화는 KRW/USD 분리(krw/usd 필드). rate는 소수(0.05=5%). 계좌 도구는 account_seq 생략 시 위탁(BROKERAGE) 계좌 자동 선택.]";

export const tossInvestTools = [
  tool({
    name: "tossinvest_get_portfolio",
    description: `${NOTE} 계좌의 보유종목 포트폴리오 조회. 계좌 목록(accounts) + 보유종목 평가금액/매입금액/총·일간 손익 반환. symbol로 특정 종목만 필터 가능.`,
    inputSchema: tossGetPortfolioInputSchema,
    run(args, { tossInvestService }) {
      return tossInvestService.getPortfolio(args);
    },
  }),
  tool({
    name: "tossinvest_list_orders",
    description: `${NOTE} 주문/체결 내역 조회. status=CLOSED로 체결·취소 내역(from/to 기간 지정), OPEN으로 미체결 주문. 커서 페이지네이션(nextCursor/hasNext). 결정 로그와 합쳐 손절 집행률·EV per trade 측정에 사용.`,
    inputSchema: tossListOrdersInputSchema,
    run(args, { tossInvestService }) {
      return tossInvestService.listOrders(args);
    },
  }),
  tool({
    name: "tossinvest_get_buyable_amount",
    description: `${NOTE} 통화별 현금 기반 주문가능금액(buyableAmount) 조회. currency=KRW 국내, USD 해외. 진입 사이징/게이트 계산 입력값.`,
    inputSchema: tossGetBuyableAmountInputSchema,
    run(args, { tossInvestService }) {
      return tossInvestService.getBuyableAmount(args);
    },
  }),
  tool({
    name: "tossinvest_get_sellable_quantity",
    description: `${NOTE} 특정 종목의 매도가능수량(sellableQuantity) 조회. 손절/익절 집행 가능 물량 확인.`,
    inputSchema: tossGetSellableQuantityInputSchema,
    run(args, { tossInvestService }) {
      return tossInvestService.getSellableQuantity(args);
    },
  }),
  tool({
    name: "tossinvest_get_stock_info",
    description: `${NOTE} 종목 마스터 정보(이름/시장/통화/상장일/거래정지 여부 등) 배치 조회(최대 200). include_warnings=true면 종목별 투자경고/거래정지/VI 등 warning도 조회(최대 20개) — 진입 게이트 위험종목 필터용. (계좌 비귀속)`,
    inputSchema: tossGetStockInfoInputSchema,
    run(args, { tossInvestService }) {
      return tossInvestService.getStockInfo(args);
    },
  }),
  tool({
    name: "tossinvest_get_exchange_rate",
    description: `${NOTE} 실시간 환율 조회. 기본 USD/KRW. midRate/rate/변동방향 반환. (계좌 비귀속)`,
    inputSchema: tossGetExchangeRateInputSchema,
    run(args, { tossInvestService }) {
      return tossInvestService.getExchangeRate(args);
    },
  }),
  tool({
    name: "tossinvest_get_market_calendar",
    description: `${NOTE} 시장 개장/휴장 캘린더(country=KR 국내, US 해외). 오늘·직전·다음 영업일의 정규/프리/애프터장 시간 반환. 주문 가능일 체크용. (계좌 비귀속)`,
    inputSchema: tossGetMarketCalendarInputSchema,
    run(args, { tossInvestService }) {
      return tossInvestService.getMarketCalendar(args);
    },
  }),
];
