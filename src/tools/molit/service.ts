import { SEOUL_GU_LAWD, type MolitTradeInput } from "./schema.js";

// 국토교통부 실거래가 (공공데이터포털 data.go.kr, 기관코드 1613000).
//
// TODO(미검증): 라이브 응답으로 아직 끝까지 검증 못 함.
//   - 검증 시도 시 data.go.kr 게이트웨이가 MOLIT 백엔드 연결 실패(502, 서버측)로 실제 응답 본문을 못 받음.
//     키 인가는 확인됨(401 → 502로 전환). 백엔드 복구 후 재검증 필요.
//   - 확인할 것: ① 정상 200 응답의 실제 필드명(normalizeDeal의 dealAmount/deposit/monthlyRent/
//     excluUseAr/dealYear·Month·Day/aptNm/umdNm 가정) ② 성공 resultCode 값 ③ 적정 타임아웃(현 15s가
//     data.go.kr 지연엔 짧을 수 있어 25s 검토). 단, parseItems가 모든 원본 태그를 보존하므로 필드명이
//     달라도 raw 데이터는 살아있고, 정규화 편의필드만 영향받음.
const MOLIT_BASE_URL = "http://apis.data.go.kr/1613000";
const REQUEST_TIMEOUT_MS = 15_000;
const TTL_MS = 60 * 60 * 1000; // 실거래가는 자주 안 바뀜 → 1시간 캐시.

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

export interface MolitServiceOptions {
  apiKey?: string;
}

export class MolitService {
  private readonly apiKey?: string;
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(options: MolitServiceOptions) {
    this.apiKey = options.apiKey;
  }

  getAptTrade(input: MolitTradeInput) {
    return this.fetchDeals("RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev", "trade", input);
  }

  getAptRent(input: MolitTradeInput) {
    return this.fetchDeals("RTMSDataSvcAptRent/getRTMSDataSvcAptRent", "rent", input);
  }

  private async fetchDeals(path: string, kind: "trade" | "rent", input: MolitTradeInput) {
    const lawdCd = this.resolveLawdCd(input);
    const dealYmd = input.deal_ymd ?? currentYmd();
    const cacheKey = `${path}:${lawdCd}:${dealYmd}:${input.page_no}:${input.num_of_rows}`;

    return this.getCached(cacheKey, TTL_MS, async () => {
      const xml = await this.request(path, {
        LAWD_CD: lawdCd,
        DEAL_YMD: dealYmd,
        pageNo: String(input.page_no),
        numOfRows: String(input.num_of_rows),
      });

      const { resultCode, resultMsg, totalCount } = parseHead(xml);
      // 성공 코드는 API에 따라 "000" 또는 "00". 그 외는 에러로 간주.
      if (resultCode && !["000", "00"].includes(resultCode)) {
        throw new Error(`MOLIT 실거래가 응답 오류 (${resultCode}): ${resultMsg ?? "unknown"}`);
      }

      const items = parseItems(xml).map((raw) => normalizeDeal(raw, kind));
      return {
        kind,
        lawdCd,
        regionName: input.region ?? lawdToName(lawdCd),
        dealYmd,
        totalCount: totalCount ?? items.length,
        rowCount: items.length,
        items,
      };
    });
  }

  private resolveLawdCd(input: MolitTradeInput): string {
    if (input.lawd_cd) return input.lawd_cd;
    if (input.region) {
      const code = SEOUL_GU_LAWD[input.region.trim()];
      if (code) return code;
      throw new Error(
        `'${input.region}'의 법정동코드를 모릅니다. 서울 자치구명이 아니면 lawd_cd(5자리)를 직접 지정하세요. (예: 성남분당 41135)`,
      );
    }
    throw new Error("region(서울 자치구명) 또는 lawd_cd(5자리 시군구 법정동코드) 중 하나는 필수입니다.");
  }

  private async request(path: string, params: Record<string, string>): Promise<string> {
    if (!this.apiKey) {
      throw new Error("MOLIT 실거래가 API 키가 없습니다. 환경변수 MOLIT_API_KEY 를 설정하세요.");
    }
    // data.go.kr 일반 인증키(Encoding)는 이미 URL 인코딩돼 있어 그대로 붙인다. 나머지는 표준 인코딩.
    const query =
      `serviceKey=${this.apiKey}&` +
      Object.entries(params)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("&");
    const url = `${MOLIT_BASE_URL}/${path}?${query}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { method: "GET", signal: controller.signal });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `MOLIT 요청 실패: ${response.status} ${response.statusText} (${path}). ${truncate(text, 300)}`,
        );
      }
      // data.go.kr은 키 오류 등을 200 + XML(OpenAPI_ServiceResponse)로 돌려주기도 한다.
      const fault = text.match(/<returnReasonCode>(\d+)<\/returnReasonCode>/)?.[1];
      if (fault) {
        const msg = text.match(/<returnAuthMsg>([^<]*)<\/returnAuthMsg>/)?.[1] ?? "";
        throw new Error(`MOLIT 인증/요청 오류 (${fault}): ${msg}. MOLIT_API_KEY와 활용신청 상태를 확인하세요.`);
      }
      return text;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`MOLIT 요청이 ${REQUEST_TIMEOUT_MS}ms 내에 응답하지 않았습니다 (${path}).`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async getCached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;
    const inFlight = this.inFlight.get(key);
    if (inFlight) return inFlight as Promise<T>;

    const promise = loader()
      .then((value) => {
        this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, promise);
    return promise;
  }
}

function currentYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function lawdToName(lawdCd: string): string | undefined {
  for (const [name, code] of Object.entries(SEOUL_GU_LAWD)) {
    if (code === lawdCd) return name;
  }
  return undefined;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function parseHead(xml: string): {
  resultCode?: string;
  resultMsg?: string;
  totalCount?: number;
} {
  const resultCode = xml.match(/<resultCode>([^<]*)<\/resultCode>/)?.[1]?.trim();
  const resultMsg = xml.match(/<resultMsg>([^<]*)<\/resultMsg>/)?.[1]?.trim();
  const totalRaw = xml.match(/<totalCount>(\d+)<\/totalCount>/)?.[1];
  return { resultCode, resultMsg, totalCount: totalRaw ? Number(totalRaw) : undefined };
}

// <item> 블록마다 모든 <tag>value</tag>를 객체로 추출(필드명 하드코딩 X → 스펙 변화에 강건).
function parseItems(xml: string): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const obj: Record<string, string> = {};
    const tagRe = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g;
    let t: RegExpExecArray | null;
    while ((t = tagRe.exec(m[1])) !== null) {
      obj[t[1]] = t[2].trim();
    }
    items.push(obj);
  }
  return items;
}

// 원본 필드는 보존하되, 자주 쓰는 값에 정규화 필드를 덧붙인다(금액 만원 단위 숫자, 날짜).
function normalizeDeal(raw: Record<string, string>, kind: "trade" | "rent") {
  const num = (s?: string) => {
    if (s == null) return undefined;
    const n = Number(s.replace(/[,\s]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  };
  const y = raw.dealYear;
  const mo = raw.dealMonth?.padStart(2, "0");
  const d = raw.dealDay?.padStart(2, "0");
  const dealDate = y && mo && d ? `${y}-${mo}-${d}` : undefined;

  const out: Record<string, unknown> = { ...raw, dealDate };
  if (kind === "trade") {
    out.dealAmountManwon = num(raw.dealAmount);
  } else {
    out.depositManwon = num(raw.deposit);
    out.monthlyRentManwon = num(raw.monthlyRent);
    out.isJeonse = num(raw.monthlyRent) === 0;
  }
  out.exclusiveAreaM2 = num(raw.excluUseAr);
  return out;
}
