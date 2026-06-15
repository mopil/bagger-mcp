import { withProxy } from "../../http/proxy.js";

import type {
  NaverlandGetArticleDetailInput,
  NaverlandGetComplexInfoInput,
  NaverlandGetComplexPriceInfoInput,
  NaverlandResolveDistrictInput,
  NaverlandSearchApartmentsInput,
  NaverlandSearchCommercialInput,
  NaverlandWatchComplexesInput,
} from "./schema.js";

const API_BASE_URL = "https://new.land.naver.com/api";
const MAIN_PAGE_URL = "https://new.land.naver.com/complexes";
const ROOT_CORTAR_NO = "0000000000";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// 네이버 비공식 API: IP 차단 방지를 위해 호출 간 최소 간격 + 429 재시도.
const REQUEST_DELAY_MS = 600;
const REQUEST_TIMEOUT_MS = 12_000;
const RETRY_DELAY_MS = 5_000;
const MAX_RETRIES = 2;
const AUTH_TTL_MS = 20 * 60 * 1000;
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

const TTL_REGION_MS = 6 * 60 * 60 * 1000;
const TTL_COMPLEX_DETAIL_MS = 60 * 60 * 1000;
const TTL_ARTICLES_MS = 5 * 60 * 1000;
const TTL_PRICES_MS = 60 * 60 * 1000;

const TRADE_TYPE_MAP: Record<string, string> = {
  A1: "A1",
  B1: "B1",
  B2: "B2",
  매매: "A1",
  전세: "B1",
  월세: "B2",
};
const TRADE_TYPE_NAME: Record<string, string> = { A1: "매매", B1: "전세", B2: "월세" };

// 네이버 realEstateType 코드 (상가/사무실 등 비-아파트 매물 검색용)
const PROPERTY_TYPE_MAP: Record<string, string> = {
  상가: "SG",
  사무실: "SMS",
  "상가+사무실": "SG:SMS",
  공장창고: "GM",
  건물: "GJCG",
  토지: "TJ",
};

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

interface AuthState {
  jwt: string;
  cookie: string;
  obtainedAt: number;
}

interface WatchSnapshot {
  articleCount: number;
  minPrice: number | null;
  maxPrice: number | null;
  capturedAt: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface NaverlandServiceOptions {
  // 고정 IP egress 프록시 URL(선택). 네이버의 데이터센터 IP 차단 대응.
  proxyUrl?: string;
}

export class NaverlandService {
  private readonly proxyUrl?: string;
  private auth: AuthState | null = null;
  private authInFlight: Promise<AuthState> | null = null;
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly watchSnapshots = new Map<string, WatchSnapshot>();
  // 모든 요청을 순차 직렬화하여 동시 호출로 인한 차단을 방지한다.
  private requestChain: Promise<unknown> = Promise.resolve();

  constructor(options: NaverlandServiceOptions = {}) {
    this.proxyUrl = options.proxyUrl;
  }

  // ---- 공개 API (툴에서 호출) ----

  async resolveDistrict(input: NaverlandResolveDistrictInput) {
    const region = await this.resolveRegion(input.query);
    if (!region) {
      return { query: input.query, found: false, region: null };
    }
    return { query: input.query, found: true, region };
  }

  async listDistricts() {
    return this.getCached(`regions:${ROOT_CORTAR_NO}`, TTL_REGION_MS, async () => {
      const data = await this.request<{ regionList?: RawRegion[] }>(
        `/regions/list?cortarNo=${ROOT_CORTAR_NO}`,
      );
      const rows = (data.regionList ?? []).map((r) => ({
        cortarNo: r.cortarNo,
        cortarName: r.cortarName,
        centerLat: r.centerLat,
        centerLon: r.centerLon,
      }));
      return { count: rows.length, districts: rows };
    });
  }

  async searchApartments(input: NaverlandSearchApartmentsInput) {
    const tradeType = TRADE_TYPE_MAP[input.trade_type] ?? "A1";
    const region = await this.resolveRegion(input.district);
    if (!region) {
      return { district: input.district, found: false, count: 0, items: [] };
    }

    const complexes = await this.getComplexesInCortar(region.cortarNo);
    const targetComplexes = complexes.slice(0, input.max_complexes);
    const truncatedComplexes = complexes.length > targetComplexes.length;

    const items: ArticleItem[] = [];
    for (const complex of targetComplexes) {
      const articles = await this.getArticles(complex.complexNo, tradeType, 1);
      for (const a of articles.slice(0, input.max_articles_per_complex)) {
        const price = parsePriceManwon(a.dealOrWarrantPrc);
        if (price !== null && (price < input.price_min || price > input.price_max)) continue;
        items.push({
          complexNo: complex.complexNo,
          complexName: complex.complexName,
          articleName: a.articleName,
          tradeTypeName: a.tradeTypeName ?? TRADE_TYPE_NAME[tradeType],
          dealOrWarrantPrc: a.dealOrWarrantPrc,
          rentPrc: a.rentPrc,
          priceManwon: price,
          areaName: a.areaName,
          area1: a.area1,
          area2: a.area2,
          floorInfo: a.floorInfo,
          direction: a.direction,
          buildingName: a.buildingName,
          articleConfirmYmd: a.articleConfirmYmd,
          articleFeatureDesc: a.articleFeatureDesc,
          realtorName: a.realtorName,
          cortarAddress: complex.cortarAddress,
        });
      }
    }

    items.sort((a, b) => (a.priceManwon ?? Infinity) - (b.priceManwon ?? Infinity));

    return {
      district: input.district,
      found: true,
      region,
      tradeType,
      tradeTypeName: TRADE_TYPE_NAME[tradeType],
      priceRange: { min: input.price_min, max: input.price_max },
      complexesScanned: targetComplexes.length,
      complexesTotal: complexes.length,
      truncatedComplexes,
      count: items.length,
      items,
    };
  }

  async searchCommercial(input: NaverlandSearchCommercialInput) {
    const tradeType = TRADE_TYPE_MAP[input.trade_type] ?? "A1";
    const realEstateType = PROPERTY_TYPE_MAP[input.property_type] ?? "SG";
    const region = await this.resolveRegion(input.district);
    if (!region) {
      return { district: input.district, found: false, count: 0, items: [] };
    }

    const keyword = input.keyword?.trim();
    const raw: RawArticle[] = [];
    let pagesFetched = 0;
    for (let page = 1; page <= input.max_pages; page++) {
      const res = await this.getRegionArticles(region.cortarNo, realEstateType, tradeType, page);
      pagesFetched = page;
      raw.push(...res.articleList);
      if (!res.isMoreData) break;
    }

    const items: CommercialItem[] = [];
    for (const a of raw) {
      const deposit = parsePriceManwon(a.dealOrWarrantPrc);
      const rent = parsePriceManwon(a.rentPrc);
      // 보증금/전세금 상한은 보증 거래(전세 B1·월세 B2)에만 적용.
      // 매매(A1)는 dealOrWarrantPrc가 매매가라 deposit_max(기본 99.99억)로 누락시키지 않는다.
      if (tradeType !== "A1" && deposit !== null && deposit > input.deposit_max) continue;
      // 월세 상한은 rentPrc(월세)가 있을 때만 적용.
      if (rent !== null && rent > input.rent_max) continue;
      const haystack = `${a.articleName ?? ""} ${a.articleFeatureDesc ?? ""} ${(a.tagList ?? []).join(",")}`;
      if (keyword && !haystack.includes(keyword)) continue;
      items.push({
        articleNo: a.articleNo,
        articleName: a.articleName,
        realEstateTypeName: a.realEstateTypeName,
        tradeTypeName: a.tradeTypeName ?? TRADE_TYPE_NAME[tradeType],
        dealOrWarrantPrc: a.dealOrWarrantPrc,
        rentPrc: a.rentPrc,
        depositManwon: deposit,
        rentManwon: rent,
        area1: a.area1,
        area2: a.area2,
        floorInfo: a.floorInfo,
        direction: a.direction,
        articleConfirmYmd: a.articleConfirmYmd,
        articleFeatureDesc: a.articleFeatureDesc,
        tagList: a.tagList,
        realtorName: a.realtorName,
        link: a.articleNo ? `https://m.land.naver.com/article/info/${a.articleNo}` : undefined,
      });
    }

    // 월세는 월세 오름차순, 매매/전세는 보증금(매매가/전세금) 오름차순으로 정렬.
    const sortKey = (i: CommercialItem) => i.rentManwon ?? i.depositManwon ?? Infinity;
    items.sort((x, y) => sortKey(x) - sortKey(y));

    return {
      district: input.district,
      found: true,
      region,
      propertyType: input.property_type,
      realEstateType,
      tradeType,
      tradeTypeName: TRADE_TYPE_NAME[tradeType],
      filters: { deposit_max: input.deposit_max, rent_max: input.rent_max, keyword: keyword ?? null },
      pagesFetched,
      scanned: raw.length,
      count: items.length,
      items,
    };
  }

  async getArticleDetail(input: NaverlandGetArticleDetailInput) {
    const suffix = input.complex_no ? `?complexNo=${input.complex_no}` : "";
    const key = `articleDetail:${input.article_no}:${input.complex_no ?? ""}`;
    return this.getCached(key, TTL_ARTICLES_MS, async () => {
      const data = await this.request<RawArticleDetailResponse>(
        `/articles/${input.article_no}${suffix}`,
      );
      const d = data.articleDetail;
      if (!d) return { found: false, articleNo: input.article_no };

      const add = data.articleAddition ?? {};
      const fac = data.articleFacility ?? {};
      const desc = d.detailDescription ?? "";
      const feature = d.articleFeatureDescription ?? "";
      const tags = d.tagList ?? add.tagList ?? [];
      const haystack = `${feature} ${desc} ${tags.join(",")}`;

      return {
        found: true,
        articleNo: d.articleNo ?? input.article_no,
        articleName: d.articleName,
        realestateTypeName: d.realestateTypeName,
        tradeTypeName: d.tradeTypeName,
        dealOrWarrantPrc: add.dealOrWarrantPrc,
        rentPrc: add.rentPrc,
        depositManwon: parsePriceManwon(add.dealOrWarrantPrc),
        rentManwon: parsePriceManwon(add.rentPrc),
        // 건축물 용도: 제2종 근린생활시설 등. 스터디룸/독서실 가능 여부 판단 핵심.
        lawUsage: d.lawUsage,
        buildingUse: fac.buildingUseAprvTypeName,
        buildingUseAprvYmd: fac.buildingUseAprvYmd,
        floorAreaRatio: fac.floorAreaRatio,
        buildingCoverageRatio: fac.buildingCoverageRatio,
        area1: add.area1,
        area2: add.area2,
        buildingSpace: data.articleSpace?.buildingSpace,
        floorInfo: add.floorInfo,
        roomCount: d.roomCount,
        bathroomCount: d.bathroomCount,
        direction: fac.directionTypeName ?? add.direction,
        moveInTypeName: d.moveInTypeName,
        moveInPossibleYmd: d.moveInPossibleYmd,
        parkingCount: d.parkingCount,
        parkingPossibleYN: d.parkingPossibleYN,
        exposureAddress: d.exposureAddress,
        walkingTimeToNearSubway: d.walkingTimeToNearSubway,
        articleConfirmYMD: d.articleConfirmYMD,
        // 전대차(재임대) 언급 여부 — 네이버에 전용 필드가 없어 설명/태그에서 추출.
        subleaseMentioned: /전대|재임대/.test(haystack),
        tagList: tags,
        featureDescription: feature,
        detailDescription: desc,
        realtorName: data.articleRealtor?.realtorName,
        link: `https://m.land.naver.com/article/info/${input.article_no}`,
      };
    });
  }

  async getComplexInfo(input: NaverlandGetComplexInfoInput) {
    const complexNo = await this.resolveComplexNo(input);
    if (!complexNo) {
      return { found: false, query: input.complex_name ?? input.complex_id ?? null };
    }
    const detail = await this.getComplexDetail(complexNo);
    return { found: true, complexNo, ...detail };
  }

  async getComplexPriceInfo(input: NaverlandGetComplexPriceInfoInput) {
    const complexNo = await this.resolveComplexNo(input);
    if (!complexNo) {
      return { found: false, query: input.complex_name ?? input.complex_id ?? null };
    }
    const detail = await this.getComplexDetail(complexNo);
    const pyeongs = detail.pyeongList;

    const priceByPyeong: unknown[] = [];
    for (const p of pyeongs) {
      const prices = await this.getComplexPrices(complexNo, p.pyeongNo, "table");
      const real = await this.getComplexPrices(complexNo, p.pyeongNo, "chart");
      priceByPyeong.push({
        pyeongNo: p.pyeongNo,
        pyeongName: p.pyeongName,
        exclusiveArea: p.exclusiveArea,
        supplyArea: p.supplyArea,
        marketPrice: extractMarketPrice(prices),
        recentRealPrices: extractRecentRealPrices(real),
      });
    }

    return {
      found: true,
      complexNo,
      complexName: detail.complexName,
      address: detail.address,
      priceByPyeong,
    };
  }

  async watchComplexes(input: NaverlandWatchComplexesInput) {
    const tradeType = TRADE_TYPE_MAP[input.trade_type] ?? "A1";
    const results: unknown[] = [];

    for (const name of input.complex_names) {
      const complexNo = await this.searchComplexByName(name);
      if (!complexNo) {
        results.push({ name, found: false });
        continue;
      }
      const detail = await this.getComplexDetail(complexNo);
      const articles = await this.getArticles(complexNo, tradeType, 1);

      const filtered = articles.filter((a) => {
        const price = parsePriceManwon(a.dealOrWarrantPrc);
        return price === null || (price >= input.price_min && price <= input.price_max);
      });
      const prices = filtered
        .map((a) => parsePriceManwon(a.dealOrWarrantPrc))
        .filter((p): p is number => p !== null);
      const minPrice = prices.length ? Math.min(...prices) : null;
      const maxPrice = prices.length ? Math.max(...prices) : null;

      const snapKey = `${complexNo}:${tradeType}`;
      const prev = this.watchSnapshots.get(snapKey);
      const current: WatchSnapshot = {
        articleCount: filtered.length,
        minPrice,
        maxPrice,
        capturedAt: Date.now(),
      };
      const change = prev
        ? {
            articleCountDelta: current.articleCount - prev.articleCount,
            minPriceDelta: diff(current.minPrice, prev.minPrice),
            maxPriceDelta: diff(current.maxPrice, prev.maxPrice),
          }
        : null;
      this.watchSnapshots.set(snapKey, current);

      results.push({
        name,
        found: true,
        complexNo,
        complexName: detail.complexName,
        tradeTypeName: TRADE_TYPE_NAME[tradeType],
        articleCount: current.articleCount,
        minPriceManwon: minPrice,
        maxPriceManwon: maxPrice,
        baseline: !prev,
        change,
      });
    }

    return { tradeType, tradeTypeName: TRADE_TYPE_NAME[tradeType], count: results.length, results };
  }

  // ---- 내부 helper ----

  private async resolveRegion(query: string): Promise<RegionResult | null> {
    return this.getCached(`resolve:${query}`, TTL_REGION_MS, async () => {
      const data = await this.request<{ regions?: RawRegion[] }>(
        `/search?keyword=${encodeURIComponent(query)}`,
      );
      const region = data.regions?.[0];
      if (!region?.cortarNo) return null;
      return {
        cortarNo: region.cortarNo,
        cortarName: region.cortarName,
        cortarType: region.cortarType,
        centerLat: region.centerLat,
        centerLon: region.centerLon,
      };
    });
  }

  private async searchComplexByName(name: string): Promise<string | null> {
    return this.getCached(`complexName:${name}`, TTL_REGION_MS, async () => {
      const data = await this.request<{ complexes?: Array<{ complexNo?: string }> }>(
        `/search?keyword=${encodeURIComponent(name)}`,
      );
      return data.complexes?.[0]?.complexNo ?? null;
    });
  }

  private async resolveComplexNo(input: {
    complex_id?: string;
    complex_name?: string;
  }): Promise<string | null> {
    if (input.complex_id) return input.complex_id;
    if (input.complex_name) return this.searchComplexByName(input.complex_name);
    return null;
  }

  private async getComplexesInCortar(cortarNo: string): Promise<RawComplex[]> {
    return this.getCached(`complexes:${cortarNo}`, TTL_REGION_MS, async () => {
      const data = await this.request<{ complexList?: RawComplex[] }>(
        `/regions/complexes?cortarNo=${cortarNo}&realEstateType=APT&order=`,
      );
      return data.complexList ?? [];
    });
  }

  private async getArticles(
    complexNo: string,
    tradeType: string,
    page: number,
  ): Promise<RawArticle[]> {
    return this.getCached(`articles:${complexNo}:${tradeType}:${page}`, TTL_ARTICLES_MS, async () => {
      const data = await this.request<{ articleList?: RawArticle[] }>(
        `/articles/complex/${complexNo}?tradeType=${tradeType}&order=rank&page=${page}`,
      );
      return data.articleList ?? [];
    });
  }

  private async getRegionArticles(
    cortarNo: string,
    realEstateType: string,
    tradeType: string,
    page: number,
  ): Promise<{ articleList: RawArticle[]; isMoreData: boolean }> {
    const key = `regionArticles:${cortarNo}:${realEstateType}:${tradeType}:${page}`;
    return this.getCached(key, TTL_ARTICLES_MS, async () => {
      const params = new URLSearchParams({
        cortarNo,
        order: "rank",
        realEstateType,
        tradeType,
        page: String(page),
      });
      const data = await this.request<{ articleList?: RawArticle[]; isMoreData?: boolean }>(
        `/articles?${params.toString()}`,
      );
      return { articleList: data.articleList ?? [], isMoreData: data.isMoreData ?? false };
    });
  }

  private async getComplexDetail(complexNo: string): Promise<ComplexDetail> {
    return this.getCached(`detail:${complexNo}`, TTL_COMPLEX_DETAIL_MS, async () => {
      const data = await this.request<RawComplexDetailResponse>(
        `/complexes/${complexNo}?sameAddressGroup=false`,
      );
      const d = data.complexDetail ?? {};
      const pyeongList = (data.complexPyeongDetailList ?? []).map((p) => ({
        pyeongNo: p.pyeongNo,
        pyeongName: p.pyeongName,
        exclusiveArea: p.exclusiveArea,
        supplyArea: p.supplyArea,
        roomCnt: p.roomCnt,
        bathroomCnt: p.bathroomCnt,
        dealCount: p.articleStatistics?.dealCount,
        dealPriceString: p.articleStatistics?.dealPriceString,
      }));
      return {
        complexName: d.complexName,
        address:
          d.roadAddress ??
          ([d.cortarAddress, d.detailAddress].filter(Boolean).join(" ") || undefined),
        roadAddress: d.roadAddress,
        cortarAddress: d.cortarAddress,
        totalHouseholdCount: d.totalHouseholdCount,
        totalBuildingCount: d.totalBuildingCount,
        useApproveYmd: d.useApproveYmd,
        highFloor: d.highFloor,
        lowFloor: d.lowFloor,
        latitude: d.latitude,
        longitude: d.longitude,
        pyeongList,
      };
    });
  }

  private async getComplexPrices(
    complexNo: string,
    areaNo: string | undefined,
    type: "table" | "chart",
  ): Promise<RawPricesResponse> {
    const key = `prices:${complexNo}:${areaNo ?? ""}:${type}`;
    return this.getCached(key, TTL_PRICES_MS, async () => {
      const params = new URLSearchParams({
        complexNo,
        tradeType: "A1",
        year: "5",
        areaNo: areaNo ?? "",
        type,
      });
      return this.request<RawPricesResponse>(`/complexes/${complexNo}/prices?${params.toString()}`);
    });
  }

  // ---- 인증 / HTTP ----

  private async ensureAuth(forceRefresh = false): Promise<AuthState> {
    if (
      !forceRefresh &&
      this.auth &&
      Date.now() - this.auth.obtainedAt < AUTH_TTL_MS
    ) {
      return this.auth;
    }
    if (this.authInFlight) return this.authInFlight;

    this.authInFlight = this.fetchAuth()
      .then((auth) => {
        this.auth = auth;
        return auth;
      })
      .finally(() => {
        this.authInFlight = null;
      });
    return this.authInFlight;
  }

  private async fetchAuth(): Promise<AuthState> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(
        MAIN_PAGE_URL,
        withProxy(
          {
            headers: { "User-Agent": USER_AGENT, "Accept-Language": "ko-KR,ko;q=0.9" },
            signal: controller.signal,
          },
          this.proxyUrl,
        ),
      );
      const html = await res.text();
      const jwt = html.match(JWT_RE)?.[0];
      if (!jwt) {
        throw new Error("Naver Land: JWT 토큰을 페이지에서 추출하지 못했습니다 (구조 변경 가능).");
      }
      const setCookie = res.headers.getSetCookie?.() ?? [];
      const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
      return { jwt, cookie, obtainedAt: Date.now() };
    } finally {
      clearTimeout(timer);
    }
  }

  // 모든 요청을 단일 체인에 직렬화 + 최소 간격 유지.
  private request<T>(path: string): Promise<T> {
    const run = this.requestChain.then(async () => {
      await sleep(REQUEST_DELAY_MS);
      return this.requestWithRetry<T>(path);
    });
    // 체인이 reject로 끊기지 않도록 분리.
    this.requestChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async requestWithRetry<T>(path: string, attempt = 0): Promise<T> {
    const auth = await this.ensureAuth();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(
        `${API_BASE_URL}${path}`,
        withProxy(
          {
            headers: {
              "User-Agent": USER_AGENT,
              Accept: "application/json, text/plain, */*",
              "Accept-Language": "ko-KR,ko;q=0.9",
              Referer: MAIN_PAGE_URL,
              Authorization: `Bearer ${auth.jwt}`,
              Cookie: auth.cookie,
            },
            signal: controller.signal,
          },
          this.proxyUrl,
        ),
      );

      if (res.status === 429 || res.status === 401 || res.status === 403) {
        if (attempt < MAX_RETRIES) {
          // 인증 갱신 + 백오프 후 재시도.
          await this.ensureAuth(true);
          await sleep(RETRY_DELAY_MS);
          return this.requestWithRetry<T>(path, attempt + 1);
        }
        throw new Error(`Naver Land 요청 차단됨 (${res.status}) — ${path}. 잠시 후 재시도하세요.`);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `Naver Land 요청 실패 ${res.status} ${res.statusText} (${path}): ${body.slice(0, 200)}`,
        );
      }
      return (await res.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Naver Land 요청 타임아웃 (${REQUEST_TIMEOUT_MS}ms): ${path}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async getCached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }
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

// ---- 타입 ----

interface RawRegion {
  cortarNo?: string;
  cortarName?: string;
  cortarType?: string;
  centerLat?: number;
  centerLon?: number;
}

interface RegionResult {
  cortarNo: string;
  cortarName?: string;
  cortarType?: string;
  centerLat?: number;
  centerLon?: number;
}

interface RawComplex {
  complexNo: string;
  complexName: string;
  cortarAddress?: string;
  totalHouseholdCount?: number;
  dealCount?: number;
  leaseCount?: number;
  rentCount?: number;
  latitude?: number;
  longitude?: number;
}

interface RawArticle {
  articleNo?: string;
  articleName?: string;
  realEstateTypeName?: string;
  tagList?: string[];
  tradeTypeName?: string;
  dealOrWarrantPrc?: string;
  rentPrc?: string;
  areaName?: string;
  area1?: number;
  area2?: number;
  floorInfo?: string;
  direction?: string;
  buildingName?: string;
  articleConfirmYmd?: string;
  articleFeatureDesc?: string;
  realtorName?: string;
}

interface ArticleItem {
  complexNo: string;
  complexName: string;
  articleName?: string;
  tradeTypeName?: string;
  dealOrWarrantPrc?: string;
  rentPrc?: string;
  priceManwon: number | null;
  areaName?: string;
  area1?: number;
  area2?: number;
  floorInfo?: string;
  direction?: string;
  buildingName?: string;
  articleConfirmYmd?: string;
  articleFeatureDesc?: string;
  realtorName?: string;
  cortarAddress?: string;
}

interface RawArticleDetailResponse {
  articleDetail?: {
    articleNo?: string;
    articleName?: string;
    realestateTypeName?: string;
    tradeTypeName?: string;
    lawUsage?: string;
    roomCount?: number;
    bathroomCount?: number;
    moveInTypeName?: string;
    moveInPossibleYmd?: string;
    parkingCount?: number;
    parkingPossibleYN?: string;
    exposureAddress?: string;
    walkingTimeToNearSubway?: number;
    articleConfirmYMD?: string;
    articleFeatureDescription?: string;
    detailDescription?: string;
    tagList?: string[];
  };
  articleAddition?: {
    dealOrWarrantPrc?: string;
    rentPrc?: string;
    area1?: number;
    area2?: number;
    floorInfo?: string;
    direction?: string;
    tagList?: string[];
  };
  articleFacility?: {
    directionTypeName?: string;
    buildingUseAprvYmd?: string;
    buildingUseAprvTypeName?: string;
    floorAreaRatio?: number;
    buildingCoverageRatio?: number;
  };
  articleSpace?: { buildingSpace?: unknown };
  articleRealtor?: { realtorName?: string };
}

interface CommercialItem {
  articleNo?: string;
  articleName?: string;
  realEstateTypeName?: string;
  tradeTypeName?: string;
  dealOrWarrantPrc?: string;
  rentPrc?: string;
  depositManwon: number | null;
  rentManwon: number | null;
  area1?: number;
  area2?: number;
  floorInfo?: string;
  direction?: string;
  articleConfirmYmd?: string;
  articleFeatureDesc?: string;
  tagList?: string[];
  realtorName?: string;
  link?: string;
}

interface RawComplexDetailResponse {
  complexDetail?: {
    complexName?: string;
    detailAddress?: string;
    roadAddress?: string;
    cortarAddress?: string;
    totalHouseholdCount?: number;
    totalBuildingCount?: number;
    useApproveYmd?: string;
    highFloor?: number;
    lowFloor?: number;
    latitude?: number;
    longitude?: number;
  };
  complexPyeongDetailList?: Array<{
    pyeongNo?: string;
    pyeongName?: string;
    exclusiveArea?: string;
    supplyArea?: string;
    roomCnt?: number;
    bathroomCnt?: number;
    articleStatistics?: { dealCount?: number; dealPriceString?: string };
  }>;
}

interface ComplexDetail {
  complexName?: string;
  address?: string;
  roadAddress?: string;
  cortarAddress?: string;
  totalHouseholdCount?: number;
  totalBuildingCount?: number;
  useApproveYmd?: string;
  highFloor?: number;
  lowFloor?: number;
  latitude?: number;
  longitude?: number;
  pyeongList: Array<{
    pyeongNo?: string;
    pyeongName?: string;
    exclusiveArea?: string;
    supplyArea?: string;
    roomCnt?: number;
    bathroomCnt?: number;
    dealCount?: number;
    dealPriceString?: string;
  }>;
}

interface RawPricesResponse {
  marketPrices?: Array<{
    dealLowPriceLimit?: number;
    dealUpperPriceLimit?: number;
    dealAveragePrice?: number;
    leaseLowPriceLimit?: number;
    leaseUpperPriceLimit?: number;
    leaseAveragePrice?: number;
  }>;
  realPriceDataXList?: string[];
  realPriceDataYList?: number[];
  floorList?: string[];
}

// ---- 순수 함수 ----

// "12억 5,000" / "8억" / "9,500" → 만원 단위 정수
export function parsePriceManwon(raw?: string): number | null {
  if (!raw) return null;
  const s = String(raw).replace(/\s/g, "");
  let man = 0;
  let matched = false;
  const eok = s.match(/([\d,]+)억/);
  if (eok) {
    man += parseInt(eok[1].replace(/,/g, ""), 10) * 10000;
    matched = true;
  }
  const rest = s.replace(/[\d,]+억/, "").replace(/,/g, "");
  const restNum = rest.match(/(\d+)/);
  if (restNum) {
    man += parseInt(restNum[1], 10);
    matched = true;
  }
  return matched ? man : null;
}

function extractMarketPrice(prices: RawPricesResponse) {
  const mp = prices.marketPrices?.[0];
  if (!mp) return null;
  return {
    dealLowPriceLimit: mp.dealLowPriceLimit,
    dealUpperPriceLimit: mp.dealUpperPriceLimit,
    dealAveragePrice: mp.dealAveragePrice,
    leaseLowPriceLimit: mp.leaseLowPriceLimit,
    leaseUpperPriceLimit: mp.leaseUpperPriceLimit,
    leaseAveragePrice: mp.leaseAveragePrice,
  };
}

function extractRecentRealPrices(prices: RawPricesResponse) {
  const x = prices.realPriceDataXList ?? [];
  const y = prices.realPriceDataYList ?? [];
  const floors = prices.floorList ?? [];
  const n = Math.min(x.length, y.length);
  const rows = [];
  for (let i = Math.max(0, n - 6); i < n; i++) {
    rows.push({ date: x[i], price: y[i], floor: floors[i] });
  }
  return rows;
}

function diff(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return a - b;
}
