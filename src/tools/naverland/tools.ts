import { defineServiceTool } from "../defineTool.js";
import type { ServiceRegistry } from "../../mcp/services.js";
import {
  naverlandGetComplexInfoInputSchema,
  naverlandGetComplexPriceInfoInputSchema,
  naverlandListDistrictsInputSchema,
  naverlandResolveDistrictInputSchema,
  naverlandSearchApartmentsInputSchema,
  naverlandSearchCommercialInputSchema,
  naverlandWatchComplexesInputSchema,
} from "./schema.js";

const tool = defineServiceTool<ServiceRegistry>();

const NOTE =
  "[네이버 부동산 비공식 API. 한국 아파트 매물/시세/실거래가. 가격 단위는 만원(예: 79000 = 7.9억).]";

export const naverlandTools = [
  tool({
    name: "naverland_resolve_district",
    description: `${NOTE} 지역명(동/구/군)을 네이버 cortarNo로 변환. 다른 지역 기반 조회의 전제.`,
    inputSchema: naverlandResolveDistrictInputSchema,
    run(args, { naverlandService }) {
      return naverlandService.resolveDistrict(args);
    },
  }),
  tool({
    name: "naverland_list_districts",
    description: `${NOTE} 전국 시/도 목록(cortarNo 포함) 조회.`,
    inputSchema: naverlandListDistrictsInputSchema,
    run(_args, { naverlandService }) {
      return naverlandService.listDistricts();
    },
  }),
  tool({
    name: "naverland_search_apartments",
    description: `${NOTE} 지역+가격대로 아파트 매물 검색 (매매/전세/월세). rate limit 방지를 위해 max_complexes로 단지 수 제한.`,
    inputSchema: naverlandSearchApartmentsInputSchema,
    run(args, { naverlandService }) {
      return naverlandService.searchApartments(args);
    },
  }),
  tool({
    name: "naverland_search_commercial",
    description: `${NOTE} 지역+종류(상가/사무실/공장 등)+거래유형으로 비-아파트 매물 검색. 보증금/월세 상한·키워드(전대/스터디 등) 필터 지원. 단, 2종근생 용도/전대차 가능 여부는 리스트에 표기 안 되니 매물별 확인 필요.`,
    inputSchema: naverlandSearchCommercialInputSchema,
    run(args, { naverlandService }) {
      return naverlandService.searchCommercial(args);
    },
  }),
  tool({
    name: "naverland_get_complex_info",
    description: `${NOTE} 단지 상세정보 (세대수/준공일/평형/좌표). complex_id 또는 complex_name 중 하나 지정.`,
    inputSchema: naverlandGetComplexInfoInputSchema,
    run(args, { naverlandService }) {
      return naverlandService.getComplexInfo(args);
    },
  }),
  tool({
    name: "naverland_get_complex_price_info",
    description: `${NOTE} 단지의 평형별 시세(상한/하한/평균) + 최근 실거래가. complex_id 또는 complex_name 지정.`,
    inputSchema: naverlandGetComplexPriceInfoInputSchema,
    run(args, { naverlandService }) {
      return naverlandService.getComplexPriceInfo(args);
    },
  }),
  tool({
    name: "naverland_watch_complexes",
    description: `${NOTE} 관심 단지들의 매물 수/최저·최고가를 조회하고 직전 호출 대비 변동 감지(같은 세션 내 메모리 스냅샷).`,
    inputSchema: naverlandWatchComplexesInputSchema,
    run(args, { naverlandService }) {
      return naverlandService.watchComplexes(args);
    },
  }),
];
