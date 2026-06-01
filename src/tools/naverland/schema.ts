import { z } from "zod";

// 거래유형: 한글/코드 모두 허용 → 서비스에서 A1/B1/B2로 정규화
const tradeTypeSchema = z
  .enum(["A1", "B1", "B2", "매매", "전세", "월세"])
  .default("A1")
  .describe("거래유형: A1/매매, B1/전세, B2/월세. 기본 A1(매매).");

export const naverlandResolveDistrictInputSchema = {
  query: z
    .string()
    .min(1)
    .describe("지역명 검색어 (예: '강남구', '역삼동', '분당'). 네이버 cortarNo로 변환."),
} satisfies z.ZodRawShape;

export const naverlandListDistrictsInputSchema = {} satisfies z.ZodRawShape;

export const naverlandSearchApartmentsInputSchema = {
  district: z
    .string()
    .min(1)
    .describe("검색할 지역명 (동/구/군 단위, 예: '역삼동', '강남구'). 내부적으로 cortarNo 변환."),
  trade_type: tradeTypeSchema,
  price_min: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("최소 가격 (단위: 만원). 매매/전세는 가격, 월세는 보증금 기준."),
  price_max: z
    .number()
    .int()
    .min(0)
    .default(999999)
    .describe("최대 가격 (단위: 만원). 예: 7.9억 → 79000."),
  max_complexes: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(5)
    .describe("크롤링할 최대 단지 수. rate limit 방지용 (기본 5, 최대 10)."),
  max_articles_per_complex: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("단지당 최대 매물 수 (기본 20)."),
} satisfies z.ZodRawShape;

const complexRefSchema = {
  complex_id: z
    .string()
    .regex(/^\d+$/, "complex_id는 숫자 문자열(complexNo)이어야 합니다.")
    .optional()
    .describe("네이버 단지번호(complexNo). complex_name보다 우선."),
  complex_name: z
    .string()
    .min(1)
    .optional()
    .describe("단지명 (예: '래미안강남'). complex_id 미지정 시 이름으로 검색."),
};

export const naverlandGetComplexInfoInputSchema = {
  ...complexRefSchema,
} satisfies z.ZodRawShape;

export const naverlandGetComplexPriceInfoInputSchema = {
  ...complexRefSchema,
} satisfies z.ZodRawShape;

export const naverlandSearchCommercialInputSchema = {
  district: z
    .string()
    .min(1)
    .describe("검색할 지역명 (동/구/군, 예: '원천동', '역삼동'). 내부적으로 cortarNo 변환."),
  property_type: z
    .enum(["상가", "사무실", "상가+사무실", "공장창고", "건물", "토지"])
    .default("상가")
    .describe("부동산 종류. 스터디룸/근생은 보통 '상가'."),
  trade_type: tradeTypeSchema,
  deposit_max: z
    .number()
    .int()
    .min(0)
    .default(999999)
    .describe("최대 보증금 (단위: 만원). 예: 2억 → 20000."),
  rent_max: z
    .number()
    .int()
    .min(0)
    .default(999999)
    .describe("최대 월세 (단위: 만원). 월세 거래일 때만 적용. 예: 80만원 → 80."),
  keyword: z
    .string()
    .optional()
    .describe("매물 설명/태그 필터 키워드 (예: '전대', '스터디', '사무실', '무권리'). 부분일치."),
  max_pages: z
    .number()
    .int()
    .min(1)
    .max(5)
    .default(3)
    .describe("조회할 최대 페이지 수 (페이지당 ~20건). rate limit 방지용 (기본 3, 최대 5)."),
} satisfies z.ZodRawShape;

export const naverlandGetArticleDetailInputSchema = {
  article_no: z
    .string()
    .regex(/^\d+$/, "article_no는 숫자 문자열(articleNo)이어야 합니다.")
    .describe("매물 고유번호(articleNo). search_apartments/search_commercial 결과의 articleNo."),
  complex_no: z
    .string()
    .regex(/^\d+$/, "complex_no는 숫자 문자열이어야 합니다.")
    .optional()
    .describe("아파트 매물일 경우 단지번호(complexNo). 상가/사무실은 불필요."),
} satisfies z.ZodRawShape;

export const naverlandWatchComplexesInputSchema = {
  complex_names: z
    .array(z.string().min(1))
    .min(1)
    .max(10)
    .describe("관심 단지명 목록 (예: ['래미안강남', '은마']). 최대 10개."),
  trade_type: tradeTypeSchema,
  price_min: z.number().int().min(0).default(0).describe("최소 가격 (만원)."),
  price_max: z.number().int().min(0).default(999999).describe("최대 가격 (만원)."),
} satisfies z.ZodRawShape;

export type NaverlandResolveDistrictInput = z.infer<
  z.ZodObject<typeof naverlandResolveDistrictInputSchema>
>;
export type NaverlandSearchApartmentsInput = z.infer<
  z.ZodObject<typeof naverlandSearchApartmentsInputSchema>
>;
export type NaverlandGetComplexInfoInput = z.infer<
  z.ZodObject<typeof naverlandGetComplexInfoInputSchema>
>;
export type NaverlandGetComplexPriceInfoInput = z.infer<
  z.ZodObject<typeof naverlandGetComplexPriceInfoInputSchema>
>;
export type NaverlandSearchCommercialInput = z.infer<
  z.ZodObject<typeof naverlandSearchCommercialInputSchema>
>;
export type NaverlandGetArticleDetailInput = z.infer<
  z.ZodObject<typeof naverlandGetArticleDetailInputSchema>
>;
export type NaverlandWatchComplexesInput = z.infer<
  z.ZodObject<typeof naverlandWatchComplexesInputSchema>
>;
