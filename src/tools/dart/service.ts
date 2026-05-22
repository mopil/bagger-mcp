import { promisify } from "node:util";
import { inflateRaw } from "node:zlib";

import type {
  DartGetCompanyInput,
  DartGetFinancialsInput,
  DartListDisclosuresInput,
  DartSearchCorpInput,
} from "./schema.js";

const inflateRawAsync = promisify(inflateRaw);

const DART_BASE_URL = "https://opendart.fss.or.kr/api";
const DART_REQUEST_TIMEOUT_MS = 20_000;
// CORPCODE.xml zip은 ~1.4MB → 압축해제 후 100k 엔트리. 하루 1회 갱신으로 충분.
const CORP_CODE_TTL_MS = 24 * 60 * 60 * 1000;

interface CorpEntry {
  corp_code: string;
  corp_name: string;
  corp_eng_name: string;
  stock_code: string;
  modify_date: string;
}

interface IndexedCorpEntry extends CorpEntry {
  corp_eng_name_lower: string;
}

interface CorpCodeCache {
  entries: IndexedCorpEntry[];
  loadedAt: number;
}

export interface DartServiceOptions {
  apiKey: string;
}

export class DartService {
  private readonly apiKey: string;
  private corpCache: CorpCodeCache | null = null;
  private corpLoadInFlight: Promise<CorpCodeCache> | null = null;

  constructor(options: DartServiceOptions) {
    this.apiKey = options.apiKey;
  }

  async searchCorp(input: DartSearchCorpInput) {
    const cache = await this.getCorpCache();
    const query = input.query.trim();
    const queryLower = query.toLowerCase();

    const scored: Array<{ entry: IndexedCorpEntry; score: number }> = [];
    for (const entry of cache.entries) {
      if (input.only_listed && !entry.stock_code) continue;
      const name = entry.corp_name;
      let score: number | null = null;
      if (name === query) score = 0;
      else if (name.startsWith(query)) score = 1 + (name.length - query.length);
      else if (name.includes(query)) score = 20 + (name.length - query.length);
      else if (entry.corp_eng_name_lower.includes(queryLower))
        score = 40 + (entry.corp_eng_name.length - query.length);
      if (score !== null) scored.push({ entry, score });
    }

    scored.sort((a, b) => a.score - b.score);
    const rows = scored.slice(0, input.limit).map(({ entry }) => {
      const { corp_eng_name_lower: _omit, ...publicFields } = entry;
      return publicFields;
    });
    return {
      query,
      totalMatched: scored.length,
      rowCount: rows.length,
      rows,
    };
  }

  async listDisclosures(input: DartListDisclosuresInput) {
    const params: Record<string, string> = {
      corp_code: input.corp_code,
      bgn_de: input.bgn_de,
      end_de: input.end_de,
      page_count: String(input.page_count),
      page_no: String(input.page_no),
    };
    if (input.pblntf_ty) params.pblntf_ty = input.pblntf_ty;
    const json = await this.requestJson<DartListResponse>("list.json", params);
    return {
      status: json.status,
      message: json.message,
      page_no: json.page_no,
      page_count: json.page_count,
      total_count: json.total_count,
      total_page: json.total_page,
      rowCount: json.list?.length ?? 0,
      rows: json.list ?? [],
    };
  }

  async getCompany(input: DartGetCompanyInput) {
    const json = await this.requestJson<DartCompanyResponse>("company.json", {
      corp_code: input.corp_code,
    });
    return json;
  }

  async getFinancials(input: DartGetFinancialsInput) {
    const json = await this.requestJson<DartFinancialResponse>("fnlttSinglAcntAll.json", {
      corp_code: input.corp_code,
      bsns_year: input.bsns_year,
      reprt_code: input.reprt_code,
      fs_div: input.fs_div,
    });
    return {
      status: json.status,
      message: json.message,
      rowCount: json.list?.length ?? 0,
      rows: json.list ?? [],
    };
  }

  private async requestJson<T>(path: string, params: Record<string, string>): Promise<T> {
    const query = new URLSearchParams({ crtfc_key: this.apiKey, ...params }).toString();
    const url = `${DART_BASE_URL}/${path}?${query}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DART_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `DART request failed: ${response.status} ${response.statusText} for ${path}. Body: ${truncate(body, 300)}`,
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`DART request timed out after ${DART_REQUEST_TIMEOUT_MS}ms for ${path}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async getCorpCache(): Promise<CorpCodeCache> {
    if (this.corpCache && Date.now() - this.corpCache.loadedAt < CORP_CODE_TTL_MS) {
      return this.corpCache;
    }
    if (this.corpLoadInFlight) return this.corpLoadInFlight;

    this.corpLoadInFlight = this.loadCorpCache()
      .then((cache) => {
        this.corpCache = cache;
        return cache;
      })
      .finally(() => {
        this.corpLoadInFlight = null;
      });
    return this.corpLoadInFlight;
  }

  private async loadCorpCache(): Promise<CorpCodeCache> {
    const url = `${DART_BASE_URL}/corpCode.xml?crtfc_key=${this.apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DART_REQUEST_TIMEOUT_MS);
    let buffer: Buffer;
    try {
      const response = await fetch(url, { method: "GET", signal: controller.signal });
      if (!response.ok) {
        throw new Error(`DART corpCode fetch failed: ${response.status} ${response.statusText}`);
      }
      buffer = Buffer.from(await response.arrayBuffer());
    } finally {
      clearTimeout(timer);
    }

    const xml = await extractFirstZipEntry(buffer);
    const entries = parseCorpXml(xml);
    return { entries, loadedAt: Date.now() };
  }
}

interface DartListResponse {
  status: string;
  message: string;
  page_no?: number;
  page_count?: number;
  total_count?: number;
  total_page?: number;
  list?: Array<Record<string, unknown>>;
}

interface DartCompanyResponse {
  status: string;
  message: string;
  [key: string]: unknown;
}

interface DartFinancialResponse {
  status: string;
  message: string;
  list?: Array<Record<string, unknown>>;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

// 단일-파일 ZIP의 첫 엔트리를 추출. 사이즈는 Central Directory에서 읽는다 — local header의
// 사이즈 필드는 data-descriptor 모드(GP bit 3)에서 0으로 비어 있을 수 있어 신뢰할 수 없다.
async function extractFirstZipEntry(buf: Buffer): Promise<string> {
  const EOCD_SIG = 0x06054b50;
  const CDH_SIG = 0x02014b50;
  let eocdOffset = -1;
  const minOffset = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= minOffset; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Invalid ZIP: EOCD not found");

  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  if (buf.readUInt32LE(cdOffset) !== CDH_SIG) {
    throw new Error("Invalid ZIP: central directory header signature mismatch");
  }
  const method = buf.readUInt16LE(cdOffset + 10);
  const compressedSize = buf.readUInt32LE(cdOffset + 20);
  const localHeaderOffset = buf.readUInt32LE(cdOffset + 42);

  const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
  const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
  const compressed = buf.subarray(dataStart, dataStart + compressedSize);

  let raw: Buffer;
  if (method === 0) raw = Buffer.from(compressed);
  else if (method === 8) raw = await inflateRawAsync(compressed);
  else throw new Error(`Unsupported ZIP compression method: ${method}`);

  return raw.toString("utf-8");
}

const LIST_RE = /<list>([\s\S]*?)<\/list>/g;
const TAG_RE = {
  corp_code: /<corp_code>([\s\S]*?)<\/corp_code>/,
  corp_name: /<corp_name>([\s\S]*?)<\/corp_name>/,
  corp_eng_name: /<corp_eng_name>([\s\S]*?)<\/corp_eng_name>/,
  stock_code: /<stock_code>([\s\S]*?)<\/stock_code>/,
  modify_date: /<modify_date>([\s\S]*?)<\/modify_date>/,
} as const;

function parseCorpXml(xml: string): IndexedCorpEntry[] {
  const entries: IndexedCorpEntry[] = [];
  LIST_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LIST_RE.exec(xml)) !== null) {
    const block = m[1];
    const corp_eng_name = decodeXmlEntities(pick(block, TAG_RE.corp_eng_name));
    entries.push({
      corp_code: pick(block, TAG_RE.corp_code),
      corp_name: decodeXmlEntities(pick(block, TAG_RE.corp_name)),
      corp_eng_name,
      stock_code: pick(block, TAG_RE.stock_code).trim(),
      modify_date: pick(block, TAG_RE.modify_date),
      corp_eng_name_lower: corp_eng_name.toLowerCase(),
    });
  }
  return entries;
}

function pick(block: string, re: RegExp): string {
  const match = re.exec(block);
  return match ? match[1] : "";
}

function decodeXmlEntities(value: string): string {
  if (value.indexOf("&") < 0) return value;
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
