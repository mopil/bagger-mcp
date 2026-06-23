import { z } from 'zod';

// MCP 클라이언트(Claude Desktop 등)가 보는 JSON Schema를 LLM-친화적으로 유지하기 위한 헬퍼.
//
// 배경: optional 필드를 zod `.nullish()`로 만들면 zod→JSON Schema 변환이
//   { anyOf: [ {enum:[...]}, {type:'null'} ] } 형태로 펼쳐진다. 이러면 enum 값이
//   anyOf[0] 안쪽에 묻히고 description은 최상위에 분리돼, LLM이 "string|null"만 보고
//   허용값(enum)을 놓친 채 자유 문자열을 지어내는 일이 잦다 ("타입을 몰라서 헤매는" 원인).
//
// 해법: `preprocess(null→undefined, X.optional())`.
//   - JSON Schema가 anyOf 없이 최상위 flat enum/타입으로 나와 description과 붙어 있다.
//   - null이 들어와도 undefined로 흡수해 기존 nullish의 관용성은 유지한다.
//   - 허용값 밖의 값은 그대로 거부된다.
const nullToUndefined = (value: unknown) => value ?? undefined;

const optionalString = z.preprocess(nullToUndefined, z.string().min(1).optional());

const optionalEnum = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess(nullToUndefined, z.enum(values).optional());

const optionalEnumArray = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess(nullToUndefined, z.array(z.enum(values)).optional());

const optionalStringArray = z.preprocess(
  nullToUndefined,
  z.array(z.string().min(1)).optional(),
);

const optionalDate = z.preprocess(
  nullToUndefined,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
);

export const memoryListInputSchema = {
  path: optionalString,
} satisfies z.ZodRawShape;

export const memoryReadInputSchema = {
  path: z.string().min(1),
} satisfies z.ZodRawShape;

export const memorySearchInputSchema = {
  query: z.string().min(1),
  extension: optionalString,
  path: optionalString,
} satisfies z.ZodRawShape;

export const memoryCaptureInputSchema = {
  slug: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9][a-z0-9\-_가-힣]*$/,
      'slug must be kebab-case (lowercase alphanumeric, hyphen, underscore; Korean allowed). No spaces, no leading date — date is added automatically.',
    ),
  content: z.string().min(1),
  origin: z.enum(['conversation', 'paste', 'url', 'file']),
  context: z.string().min(1).max(200),
  url: optionalString,
  date: optionalDate,
} satisfies z.ZodRawShape;

export const decisionLogAppendInputSchema = {
  // --- 식별 (모든 라인) ---
  id: optionalString.describe(
    '포지션 식별자. 같은 포지션의 enter→addbuy→trim→exit를 동일 id로 묶어 EV·승률·보유기간을 집계. 재진입 시 번호 증가 (예: TSLA-1, TSLA-2). enter에서 부여하고 이후 동일하게 재사용',
  ),
  ticker: z.string().min(1).max(40).describe('종목/심볼 (예: TSLA, 005930, BTC)'),
  action: z
    .enum(['enter', 'addbuy', 'trim', 'exit'])
    .describe('매매 행동: enter 신규진입 / addbuy 추가매수(비중↑) / trim 일부청산(비중↓) / exit 전량청산'),
  size: optionalString.describe("이번 결정의 규모, 자유형식 (예: '3%', '50만', '1/3')"),
  // --- 진입 라인 (enter/addbuy) ---
  trigger: optionalEnum(['event', 'chart', 'news']).describe(
    '정보 출처: event 실적·공시 / chart 기술적신호 / news 뉴스. 규율 여부는 gate로 측정',
  ),
  gate: optionalEnumArray(['memo3', 'chart', 'funda']).describe(
    '진입 시 통과한 게이트만 나열 (memo3 3줄메모 / chart 차트확인 / funda 펀더확인) → 진입 게이트 통과율. 빈 배열=무게이트(충동진입, 정직하게 기록). enter/addbuy에서만',
  ),
  stop: optionalString.describe(
    "하방 계획(손절선). 가격손절+시간손절 함께 표기 가능 (예: '$X(-8%) | 6w', '-7%')",
  ),
  target: optionalString.describe(
    "상방 계획(익절 목표 / 논지 무효화 조건). EV의 위쪽 꼬리 (예: '$X(+30%)', '매출 가이던스 하향 시 청산'). enter에서 기록",
  ),
  memo: z
    .preprocess(nullToUndefined, z.string().min(1).max(400).optional())
    .describe('진입 메모 3줄 요약 (논거 / 손절 / 손절 시 반응)'),
  // --- 청산 라인 (trim/exit) ---
  exitReason: optionalEnum(['stop', 'target', 'time', 'thesis', 'discretionary']).describe(
    '청산 사유: stop 손절선도달 / target 익절목표도달 / time 시간손절 / thesis 논지무효화 / discretionary 재량. executed와 직교 — 손절 집행률 = exitReason=stop 케이스 중 executed=planned 비율',
  ),
  executed: optionalEnum(['planned', 'changed', 'skipped']).describe(
    '사전 계획 대비 집행 방식: planned 계획대로 / changed 재량변경 / skipped 미집행 → 집행 규율 지표. exitReason과 짝으로 손절 집행률 계산',
  ),
  pnl: optionalString.describe("청산 시 실현 손익 (예: '-7.4%', '+76.7만')"),
  result: optionalEnum(['tbd', 'win', 'loss', 'flat']).describe(
    '결과. 기본 tbd(보유중), 청산 라인에서 win/loss/flat(본전) 설정. 규율 위반은 gate(빈 배열)·executed(skipped)로 잡힘',
  ),
  // --- 원칙 피드백 루프 (선택) ---
  principles: optionalStringArray.describe(
    '이 결정에 적용한 원칙 id 배열. 결정→결과를 원칙별로 묶어 "어떤 원칙이 +EV였나" 추적용. id는 memory-space 원칙 레지스트리(wiki/investing/principles) 참조 — 확실하지 않으면 생략',
  ),
  date: optionalDate.describe('기본값 KST 오늘. 덮어쓸 때만 전달'),
  time: z
    .preprocess(
      nullToUndefined,
      z
        .string()
        .regex(/^\d{2}:\d{2}$/, 'time must be HH:MM')
        .optional(),
    )
    .describe('기본값 KST 현재 시각. 덮어쓸 때만 전달'),
} satisfies z.ZodRawShape;
