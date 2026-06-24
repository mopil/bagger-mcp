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

// 자유형식 문자열 필드용. LLM이 size=3, pnl=-7.4 처럼 숫자를 그대로 넣는 일이 잦아
// (Claude Desktop에서 "Expected string, received number"로 거부됨), 숫자/불리언은
// 문자열로 흡수한다. null/undefined는 undefined로.
const toOptionalString = (value: unknown) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return value;
};

// "빈값을 뜻하는 문자열"을 실제 값으로 오인하지 않게 거부한다.
// 증상: LLM이 값이 없을 때 필드를 생략하지 않고 "null"/"N/A"/"-" 같은 placeholder
// 문자열을 넣어, 로그에 pnl=null 처럼 가짜 값이 박히거나(또는 조용히 무시되어)
// 정정 라인으로 땜질하게 된다. 조용히 흘리는 대신 명확한 에러로 즉시 재시도를 유도.
const NULL_LIKE = new Set([
  'null',
  'undefined',
  'undef',
  'none',
  'nil',
  'nan',
  'n/a',
  'na',
  '-',
  '—',
  '없음',
]);
const looksNullLike = (value: string) => NULL_LIKE.has(value.trim().toLowerCase());
const NULL_LIKE_MSG =
  '"null"·"N/A"·"none"·"-" 같은 빈값 표시 문자열은 값이 아닙니다. 실제 값이 있으면 그 값을, 없으면 이 필드를 아예 생략하세요 (빈 문자열·"null" 금지).';

// 자유형식 문자열: 숫자/불리언 흡수 + 빈값 placeholder 거부.
const freeformString = (max?: number) => {
  let base = z.string().min(1);
  if (max !== undefined) base = base.max(max);
  return z.preprocess(
    toOptionalString,
    base.refine((v) => !looksNullLike(v), NULL_LIKE_MSG).optional(),
  );
};

const optionalString = freeformString();

const optionalEnum = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess(nullToUndefined, z.enum(values).optional());

const optionalEnumArray = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess(nullToUndefined, z.array(z.enum(values)).optional());

const optionalStringArray = z.preprocess(
  (value) =>
    Array.isArray(value)
      ? value
          .map(toOptionalString)
          .filter((v): v is string => typeof v === 'string' && !looksNullLike(v))
      : nullToUndefined(value),
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
  ticker: freeformString(40).describe(
    '종목/심볼 (예: TSLA, 005930, BTC). 매매 라인(enter/addbuy/trim/exit)은 필수, review(회고)는 생략 가능',
  ),
  action: z
    .enum(['enter', 'addbuy', 'trim', 'exit', 'review'])
    .describe(
      '행동: enter 신규진입 / addbuy 추가매수(비중↑) / trim 일부청산(비중↓) / exit 전량청산 / review 회고(휩쏘·판단복기 등 사후 메모. memo만 필수, 나머지 전부 생략 가능)',
    ),
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
  memo: freeformString(400).describe(
    '메모. 진입 라인=3줄 요약(논거/손절/손절 시 반응). review(회고) 라인=회고 본문(필수)',
  ),
  // --- 회고 라인 (review) ---
  reviewType: optionalEnum([
    'whipsaw',
    'thesis_right',
    'thesis_wrong',
    'missed',
    'overtrade',
    'discipline',
  ]).describe(
    '회고 분류 (action=review에서만): whipsaw 휩쏘(손절 직후 반등에 털림) / thesis_right 판단적중 / thesis_wrong 판단오류 / missed 기회상실(진입 못/안 함) / overtrade 과매매 / discipline 규율 준수·위반 복기',
  ),
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

// 기존 라인을 교정된 필드로 재구성해 교체한다(포맷 보장). find로 대상 라인을 특정하고,
// 교정된 전체 필드(append와 동일)를 다시 넣는다. 원본 타임스탬프는 보존되므로 date/time은
// 어느 월 파일(파티션)을 열지 고를 때만 쓰인다.
export const decisionLogAmendInputSchema = {
  find: z
    .string()
    .min(1)
    .describe(
      '수정할 기존 라인을 찾는 고유 부분문자열. 해당 월 파일 안에서 정확히 1개 라인에만 매칭돼야 함 (예: "TSLA-1 TSLA exit" 또는 타임스탬프 "2026-06-24 14:30"). 모호하면 더 길게 적으세요.',
    ),
  reason: z
    .string()
    .min(1)
    .max(200)
    .describe('수정 사유 (별도 감사 로그에 기록됨). 예: "pnl 누락 보정", "result tbd→loss"'),
  ...decisionLogAppendInputSchema,
} satisfies z.ZodRawShape;
