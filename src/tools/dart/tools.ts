import { defineServiceTool } from "../defineTool.js";
import type { ServiceRegistry } from "../../mcp/services.js";
import {
  dartGetCompanyInputSchema,
  dartGetFinancialsInputSchema,
  dartListDisclosuresInputSchema,
  dartSearchCorpInputSchema,
} from "./schema.js";

const tool = defineServiceTool<ServiceRegistry>();

const NOTE =
  "[OpenDART (금융감독원 전자공시) 공식 API. 한국 상장/공시 데이터.]";

export const dartTools = [
  tool({
    name: "dart_search_corp",
    description: `${NOTE} 회사명으로 DART 고유번호(corp_code, 8자리) 검색. 모든 후속 DART 호출에 필요. 회사코드 zip은 24h 캐시.`,
    inputSchema: dartSearchCorpInputSchema,
    run(args, { dartService }) {
      return dartService.searchCorp(args);
    },
  }),
  tool({
    name: "dart_list_disclosures",
    description: `${NOTE} 특정 회사의 기간별 공시 목록 조회 (list.json). 정기/주요사항/지분/외부감사 등 pblntf_ty로 필터링 가능. rcept_no는 공시 상세 URL의 키.`,
    inputSchema: dartListDisclosuresInputSchema,
    run(args, { dartService }) {
      return dartService.listDisclosures(args);
    },
  }),
  tool({
    name: "dart_get_company",
    description: `${NOTE} 회사 개황 (company.json): 대표자, 설립일, 결산월, 주소, 업종, 홈페이지 등.`,
    inputSchema: dartGetCompanyInputSchema,
    run(args, { dartService }) {
      return dartService.getCompany(args);
    },
  }),
  tool({
    name: "dart_get_financials",
    description: `${NOTE} 단일회사 전체 재무제표 (fnlttSinglAcntAll.json). 사업연도+보고서코드 기준 BS/IS/CIS/CF 모든 계정 반환. 2015년 이후 데이터만 제공.`,
    inputSchema: dartGetFinancialsInputSchema,
    run(args, { dartService }) {
      return dartService.getFinancials(args);
    },
  }),
];
