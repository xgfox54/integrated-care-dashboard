import { STATISTICS_DATASETS } from "./catalog.ts";
import { POPULATION_PAGE_URLS } from "./population-refresh.ts";
import { INDEX_API_PATH, indexApiTables } from "./index-api.ts";
import { INDEX_API_SERIES } from "./index-verified-data.ts";
import { KOSIS_API_PATH, KOSIS_META_PATH } from "./kosis-api.ts";
import type { StatisticsRefreshDependencies } from "./background.ts";
export const USER_AGENT = "KoreanWelfareStatistics/1.0 (+https://integrated-care-national-dashboard.xgfox54.chatgpt.site/sources)";
const MAX_BYTES = 1024 * 1024;
export const PACE_MS = 3_000;
const SOURCE_URLS = new Set([...STATISTICS_DATASETS.filter(d => !d.population && !d.kosis).map(d => d.source_url), ...Object.values(POPULATION_PAGE_URLS)]);
const ALLOWED_ORIGINS = new Set(["https://www.index.go.kr", "https://jumin.mois.go.kr", "https://kosis.kr"]);
export class SourceError extends Error {
  readonly code: string; readonly retryAfter: number; readonly detail: string | null;
  constructor(code: string, retryAfter = 0, detail: string | null = null) { super(code); this.code = code; this.retryAfter = retryAfter; this.detail = detail; }
}
/** 지표누리가 HTTP 200으로 돌려준 평문 오류 문구(예: 키 불일치)를 태그·인증키를 빼고 짧게 남긴다. */
export function apiMessage(body: string, key: string): string | null {
  const trimmed = body.trim();
  if (!trimmed || trimmed.startsWith("[") || trimmed.startsWith("{")) return null;
  return trimmed.replace(/<[^>]*>/g, " ").split(key).join("[KEY]").replace(/\s+/g, " ").trim().slice(0, 160) || null;
}
export function apiMessageCode(message: string): "SOURCE_KEY_REJECTED" | "SOURCE_API_UNAVAILABLE" {
  return /^(?:키 값이 일치하지 않습니다\.?|INVALIDKEY)(?: \[KEY\])?$/i.test(message)
    ? "SOURCE_KEY_REJECTED" : "SOURCE_API_UNAVAILABLE";
}
function retryAfter(response: Response, now: number): number {
  const header = response.headers.get("retry-after")?.trim();
  if (!header) return 0;
  const value = /^\d+$/.test(header) ? now + Number(header) * 1000 : Date.parse(header);
  return Number.isFinite(value) && value > now ? value : 0;
}

/** Whole request deadline includes headers and streamed body; redirects cannot leave the source allowlist. */
export async function fetchSource(url: string, fetcher: NonNullable<StatisticsRefreshDependencies["fetcher"]>, timeoutMs: number, now: () => number): Promise<{ status: number; body: string; retryAfter: number }> {
  const target = new URL(url);
  const isRobots = target.pathname === "/robots.txt" && !target.search;
  const isApi = target.origin === "https://www.index.go.kr" && target.pathname === INDEX_API_PATH
    && STATISTICS_DATASETS.some(d => INDEX_API_SERIES[d.id] && d.indicator_code === target.searchParams.get("ixCode") && indexApiTables(d).some(table => table.table_code === target.searchParams.get("statsCode")))
    && [...target.searchParams.keys()].every(key => ["idntfcId", "ixCode", "statsCode", "period"].includes(key));
  const isKosis = target.origin === "https://kosis.kr" && [KOSIS_API_PATH, KOSIS_META_PATH].includes(target.pathname)
    && !target.username && !target.password && !target.hash
    && STATISTICS_DATASETS.some(dataset => dataset.kosis?.tables.some(table => table.org_id === target.searchParams.get("orgId") && table.tbl_id === target.searchParams.get("tblId")))
    && [...target.searchParams.keys()].every(key => ["apiKey", "method", "format", "jsonVD", "orgId", "tblId", "type", "prdSe", "newEstPrdCnt", "startPrdDe", "endPrdDe", "itmId", "smblChk", ...Array.from({ length: 8 }, (_, i) => "objL" + (i + 1))].includes(key))
    && target.searchParams.get("format") === "json"
    && (target.pathname === KOSIS_META_PATH ? target.searchParams.get("method") === "getMeta" && ["PRD", "ITM"].includes(target.searchParams.get("type") ?? "")
      : target.searchParams.get("method") === "getList" && ["Y", "F", "IR"].includes(target.searchParams.get("prdSe") ?? "")
        && (target.searchParams.get("newEstPrdCnt") === "2" && !target.searchParams.has("startPrdDe") && !target.searchParams.has("endPrdDe")
          || !target.searchParams.has("newEstPrdCnt") && target.searchParams.get("endPrdDe") === String(new Date(now()).getUTCFullYear()) && STATISTICS_DATASETS.some(dataset => dataset.kosis?.tables.some(table => table.tbl_id === target.searchParams.get("tblId") && table.org_id === target.searchParams.get("orgId")) && dataset.periods[0] === target.searchParams.get("startPrdDe")))
        && /^[A-Za-z0-9_+. -]{1,8000}$/.test(target.searchParams.get("itmId") ?? "")
        && Array.from({ length: 8 }, (_, i) => /^[A-Za-z0-9_+. -]{0,8000}$/.test(target.searchParams.get("objL" + (i + 1)) ?? "")).every(Boolean));
  if (!ALLOWED_ORIGINS.has(target.origin) || (!isRobots && !isApi && !isKosis && !SOURCE_URLS.has(url))) throw new SourceError("SOURCE_NOT_ALLOWED");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new SourceError("SOURCE_TIMEOUT")); }, timeoutMs); });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetcher(url, { redirect: "manual", signal: controller.signal,
        headers: { accept: isRobots ? "text/plain" : isApi || isKosis ? "application/json" : "text/html", "user-agent": USER_AGENT } });
      if (response.status >= 300 && response.status < 400) throw new SourceError("SOURCE_REDIRECTED");
      const limit = isRobots ? 64 * 1024 : isKosis ? 8 * MAX_BYTES : MAX_BYTES;
      if (Number(response.headers.get("content-length")) > limit) throw new SourceError("SOURCE_TOO_LARGE");
      reader = response.body?.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0, body = "";
      if (reader) while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength; if (bytes > limit) throw new SourceError("SOURCE_TOO_LARGE");
        body += decoder.decode(part.value, { stream: true });
      }
      return { status: response.status, body: body + decoder.decode(), retryAfter: retryAfter(response, now()) };
    })()]);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
    if (reader) { try { await reader.cancel(); } catch { /* a timed-out stream can already be closed */ } }
  }
}

