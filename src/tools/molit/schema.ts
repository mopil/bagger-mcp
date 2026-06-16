import { z } from "zod";

// 서울 25개 자치구 LAWD_CD(법정동코드 앞 5자리). 그 외 지역은 lawd_cd로 직접 지정.
export const SEOUL_GU_LAWD: Record<string, string> = {
  종로구: "11110",
  중구: "11140",
  용산구: "11170",
  성동구: "11200",
  광진구: "11215",
  동대문구: "11230",
  중랑구: "11260",
  성북구: "11290",
  강북구: "11305",
  도봉구: "11320",
  노원구: "11350",
  은평구: "11380",
  서대문구: "11410",
  마포구: "11440",
  양천구: "11470",
  강서구: "11500",
  구로구: "11530",
  금천구: "11545",
  영등포구: "11560",
  동작구: "11590",
  관악구: "11620",
  서초구: "11650",
  강남구: "11680",
  송파구: "11710",
  강동구: "11740",
};

const lawdCdSchema = z
  .string()
  .regex(/^\d{5}$/, "lawd_cd는 5자리 시군구 법정동코드 (예: 강남구 11680)");

const dealYmdSchema = z
  .string()
  .regex(/^\d{6}$/, "deal_ymd는 YYYYMM 형식 (예: 202606)");

const baseTradeShape = {
  region: z
    .string()
    .optional()
    .describe("서울 자치구명 (예: '강남구', '송파구'). lawd_cd 미지정 시 사용. 서울 외 지역은 lawd_cd 직접 지정."),
  lawd_cd: lawdCdSchema
    .optional()
    .describe("시군구 법정동코드 5자리. region보다 우선. 서울 외 지역 조회 시 필수 (예: 성남분당 41135)."),
  deal_ymd: dealYmdSchema.optional().describe("거래년월 YYYYMM. 생략 시 이번 달."),
  page_no: z.number().int().min(1).default(1).describe("페이지 번호."),
  num_of_rows: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100)
    .describe("페이지당 건수 (최대 1000)."),
} satisfies z.ZodRawShape;

export const molitGetAptTradeInputSchema = { ...baseTradeShape } satisfies z.ZodRawShape;
export const molitGetAptRentInputSchema = { ...baseTradeShape } satisfies z.ZodRawShape;

export type MolitTradeInput = z.infer<z.ZodObject<typeof molitGetAptTradeInputSchema>>;
