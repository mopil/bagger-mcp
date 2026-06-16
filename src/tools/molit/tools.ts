import { defineServiceTool } from "../defineTool.js";
import type { ServiceRegistry } from "../../mcp/services.js";
import { molitGetAptRentInputSchema, molitGetAptTradeInputSchema } from "./schema.js";

const tool = defineServiceTool<ServiceRegistry>();

const NOTE =
  "[국토교통부 실거래가(공공데이터포털). 신고된 실제 체결가(과거·확정), 매물 호가가 아님. 금액 단위 만원. region(서울 자치구) 또는 lawd_cd(시군구 5자리)로 조회.]";

export const molitTools = [
  tool({
    name: "molit_get_apt_trade",
    description: `${NOTE} 아파트 매매 실거래가 조회. 단지명/전용면적/층/건축년도/거래일/거래금액(dealAmountManwon) 반환. 시세·적정가 판단용.`,
    inputSchema: molitGetAptTradeInputSchema,
    run(args, { molitService }) {
      return molitService.getAptTrade(args);
    },
  }),
  tool({
    name: "molit_get_apt_rent",
    description: `${NOTE} 아파트 전월세 실거래가 조회. 보증금(depositManwon)/월세(monthlyRentManwon)/전세여부(isJeonse)/전용면적/층 반환.`,
    inputSchema: molitGetAptRentInputSchema,
    run(args, { molitService }) {
      return molitService.getAptRent(args);
    },
  }),
];
