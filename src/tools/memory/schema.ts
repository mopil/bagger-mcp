import { z } from 'zod';

const optionalString = z.string().min(1).nullish();

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
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .nullish(),
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
  trigger: z
    .enum(['event', 'chart', 'news'])
    .nullish()
    .describe('정보 출처: event 실적·공시 / chart 기술적신호 / news 뉴스. 규율 여부는 gate로 측정'),
  gate: z
    .array(z.enum(['memo3', 'chart', 'funda']))
    .nullish()
    .describe(
      '진입 시 통과한 게이트만 나열 (memo3 3줄메모 / chart 차트확인 / funda 펀더확인) → 진입 게이트 통과율. 빈 배열=무게이트(충동진입, 정직하게 기록). enter/addbuy에서만',
    ),
  stop: optionalString.describe(
    "하방 계획(손절선). 가격손절+시간손절 함께 표기 가능 (예: '$X(-8%) | 6w', '-7%')",
  ),
  target: optionalString.describe(
    "상방 계획(익절 목표 / 논지 무효화 조건). EV의 위쪽 꼬리 (예: '$X(+30%)', '매출 가이던스 하향 시 청산'). enter에서 기록",
  ),
  memo: z
    .string()
    .min(1)
    .max(400)
    .nullish()
    .describe('진입 메모 3줄 요약 (논거 / 손절 / 손절 시 반응)'),
  // --- 청산 라인 (trim/exit) ---
  exitReason: z
    .enum(['stop', 'target', 'time', 'thesis', 'discretionary'])
    .nullish()
    .describe(
      '청산 사유: stop 손절선도달 / target 익절목표도달 / time 시간손절 / thesis 논지무효화 / discretionary 재량. executed와 직교 — 손절 집행률 = exitReason=stop 케이스 중 executed=planned 비율',
    ),
  executed: z
    .enum(['planned', 'changed', 'skipped'])
    .nullish()
    .describe(
      '사전 계획 대비 집행 방식: planned 계획대로 / changed 재량변경 / skipped 미집행 → 집행 규율 지표. exitReason과 짝으로 손절 집행률 계산',
    ),
  pnl: optionalString.describe("청산 시 실현 손익 (예: '-7.4%', '+76.7만')"),
  result: z
    .enum(['tbd', 'win', 'loss', 'flat'])
    .nullish()
    .describe('결과. 기본 tbd(보유중), 청산 라인에서 win/loss/flat(본전) 설정. 규율 위반은 gate(빈 배열)·executed(skipped)로 잡힘'),
  // --- 원칙 피드백 루프 (선택) ---
  principles: z
    .array(z.string().min(1))
    .nullish()
    .describe(
      '이 결정에 적용한 원칙 id 배열 (memory-space 원칙 레지스트리의 id 참조). 결정→결과를 원칙별로 묶어 "어떤 원칙이 +EV였나" 추적용. 레지스트리에 있는 id만 사용',
    ),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .nullish()
    .describe('기본값 KST 오늘. 덮어쓸 때만 전달'),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'time must be HH:MM')
    .nullish()
    .describe('기본값 KST 현재 시각. 덮어쓸 때만 전달'),
} satisfies z.ZodRawShape;
