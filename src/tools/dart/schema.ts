import { z } from "zod";

const corpCodeSchema = z
  .string()
  .regex(/^\d{8}$/, "corp_code must be the 8-digit DART corporation code");

const yyyymmddSchema = z
  .string()
  .regex(/^\d{8}$/, "date must be YYYYMMDD (e.g. 20250101)");

export const dartSearchCorpInputSchema = {
  query: z
    .string()
    .min(1)
    .describe("회사명 검색어 (예: '삼성전자', '카카오'). 부분 일치, 한글/영문 모두 가능."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("반환할 최대 결과 수. 일치도 높은 순으로 정렬됨."),
  only_listed: z
    .boolean()
    .default(true)
    .describe("true면 상장사(stock_code 있음)만, false면 비상장 포함."),
} satisfies z.ZodRawShape;

export const dartListDisclosuresInputSchema = {
  corp_code: corpCodeSchema.describe("DART 고유번호 (8자리). dart_search_corp로 조회."),
  bgn_de: yyyymmddSchema.describe("검색 시작일 YYYYMMDD."),
  end_de: yyyymmddSchema.describe("검색 종료일 YYYYMMDD."),
  pblntf_ty: z
    .enum(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"])
    .optional()
    .describe("공시유형. A:정기, B:주요사항, C:발행, D:지분, E:기타, F:외부감사, G:펀드, H:자산유동화, I:거래소, J:공정위."),
  page_count: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("페이지당 결과 수 (최대 100)."),
  page_no: z.number().int().min(1).default(1).describe("페이지 번호."),
} satisfies z.ZodRawShape;

export const dartGetCompanyInputSchema = {
  corp_code: corpCodeSchema.describe("DART 고유번호 (8자리)."),
} satisfies z.ZodRawShape;

export const dartGetFinancialsInputSchema = {
  corp_code: corpCodeSchema.describe("DART 고유번호 (8자리)."),
  bsns_year: z
    .string()
    .regex(/^\d{4}$/, "bsns_year must be 4-digit year, e.g. '2024'")
    .describe("사업연도 (4자리, 2015년 이후)."),
  reprt_code: z
    .enum(["11011", "11012", "11013", "11014"])
    .default("11011")
    .describe("보고서: 11011 사업, 11012 반기, 11013 1분기, 11014 3분기."),
  fs_div: z
    .enum(["CFS", "OFS"])
    .default("CFS")
    .describe("CFS 연결재무제표, OFS 별도재무제표."),
} satisfies z.ZodRawShape;

export type DartSearchCorpInput = z.infer<z.ZodObject<typeof dartSearchCorpInputSchema>>;
export type DartListDisclosuresInput = z.infer<z.ZodObject<typeof dartListDisclosuresInputSchema>>;
export type DartGetCompanyInput = z.infer<z.ZodObject<typeof dartGetCompanyInputSchema>>;
export type DartGetFinancialsInput = z.infer<z.ZodObject<typeof dartGetFinancialsInputSchema>>;
