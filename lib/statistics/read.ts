import { reviewStatisticsSource } from "./source-review.ts";
import { analyzeRobots } from "../press/robots.ts";
import { STATISTICS_DATASETS, verifiedStatistics } from "./catalog.ts";
import type { StatisticsDataset, StatisticsPoint, StatisticsResult } from "./types.ts";
import type { SqlDatabase } from "../sql-database.ts";

const USER_AGENT = "KoreanWelfareStatistics/1.0 (+https://integrated-care-national-dashboard.xgfox54.chatgpt.site/sources)";
const DAY = 86_400_000;
const ERROR_TTL = 3_600_000;
const CACHE_BASE = "https://integrated-care-national-dashboard.xgfox54.chatgpt.site/__statistics-cache/v1/";
const MAX_BYTES = 1024 * 1024;
interface Cached { readonly until: number; readonly result: StatisticsResult }
const memory = new Map<string, Cached>();
let activeRefresh: string | null = null;
let lastRequestAt = 0;
let robots: { until: number; status: number; body: string } | null = null;

export class StatisticsError extends Error {
  readonly code: string; readonly status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.name = "StatisticsError"; this.code = code; this.status = status; }
}

export function parseStatisticValue(raw: string): Pick<StatisticsPoint, "raw" | "value" | "status"> {
  const text = raw.replace(/\u00a0/g, " ").trim();
  if (["", "-", "–", "—", "…", "..."].includes(text)) return { raw: text, value: null, status: "MISSING" };
  if (/^[xX*]$/.test(text)) return { raw: text, value: null, status: "CONFIDENTIAL" };
  if (!/^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(text)) throw new StatisticsError("SOURCE_FORMAT_CHANGED", "원문 수치 형식이 달라 확인본을 표시합니다.", 502);
  const value = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(value)) throw new StatisticsError("SOURCE_FORMAT_CHANGED", "원문 수치 형식을 확인하지 못했습니다.", 502);
  return { raw: text, value, status: "VALUE" };
}

function plain(html: string): string {
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "").replace(/<[^>]*>/g, " ")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => { const n = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""; })
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
function norm(value: string): string { return value.normalize("NFKC").replace(/[\s/,·ㆍ]+/g, ""); }

/** Bounded HTML table reader. Rowspans are expanded; period headers, row identities and units must all match. */
function gridOf(table: string): string[][] {
  const grid: string[][] = [];
  const carries = new Map<number, { text: string; remaining: number }>();
  for (const match of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    if (grid.length >= 250) throw new StatisticsError("SOURCE_TOO_LARGE", "통계표 크기가 조회 범위를 넘었습니다.", 502);
    const row: string[] = [];
    for (const [col, span] of carries) { row[col] = span.text; span.remaining--; if (!span.remaining) carries.delete(col); }
    let col = 0;
    for (const cell of match[1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
      while (row[col] !== undefined) col++;
      const colspan = Number(/colspan\s*=\s*["']?(\d+)/i.exec(cell[1])?.[1] ?? 1);
      const rowspan = Number(/rowspan\s*=\s*["']?(\d+)/i.exec(cell[1])?.[1] ?? 1);
      if (colspan < 1 || colspan > 100 || rowspan < 1 || rowspan > 100 || col + colspan > 120) throw new StatisticsError("SOURCE_FORMAT_CHANGED", "통계표 구조가 바뀌었습니다.", 502);
      const text = plain(cell[2]);
      for (let i = 0; i < colspan; i++) { row[col] = text; if (rowspan > 1) carries.set(col, { text, remaining: rowspan - 1 }); col++; }
    }
    grid.push(row);
  }
  return grid;
}

export function parseStatisticsHtml(html: string, expected: StatisticsDataset): StatisticsDataset {
  if (html.length > MAX_BYTES) throw new StatisticsError("SOURCE_TOO_LARGE", "통계표 크기가 조회 범위를 넘었습니다.", 502);
  const body = plain(html);
  if (!norm(body).includes(norm(expected.table_title)) || !norm(body).includes(norm("단위 : " + expected.original_unit))) throw new StatisticsError("SOURCE_FORMAT_CHANGED", "통계표 제목·단위를 확인하지 못했습니다.", 502);
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(match => match[1]);
  for (const table of tables) {
    const grid = gridOf(table);
    const headerIndex = grid.findIndex(row => row.filter(cell => /^(?:19|20)\d{2}년?$/.test(cell)).length >= 2);
    if (headerIndex < 0) continue;
    const periods = grid[headerIndex].filter(cell => /^(?:19|20)\d{2}년?$/.test(cell)).map(cell => cell.replace(/년$/, ""));
    if (periods.length > 100 || new Set(periods).size !== periods.length || periods.some((p,i) => i > 0 && p <= periods[i-1])) continue;
    const rows = grid.slice(headerIndex + 1).flatMap(row => {
      if (row.length <= periods.length) return [];
      const sourceLabel = [...new Set(row.slice(0, -periods.length).filter(Boolean))].join(" / ");
      if (!sourceLabel || /^(?:19|20)\d{2}$/.test(sourceLabel)) return [];
      try { return [{ sourceLabel, points: row.slice(-periods.length).map((cell,i) => ({ period: periods[i], ...parseStatisticValue(cell ?? "") })) }]; } catch { return []; }
    });
    if (rows.length !== expected.series.length || rows.some((row,i) => norm(row.sourceLabel) !== norm(expected.series[i].source_label))) continue;
    const source = /출처\s*:\s*([\s\S]*?)(?=통계공표시기\s*:|주석\s*:|관련 KOSIS|$)/.exec(body)?.[1]?.trim();
    const notes = /주석\s*:\s*([\s\S]*?)(?=관련 KOSIS|$)/.exec(body)?.[1]?.trim();
    if (!source || !notes) continue;
    const provisional = new Set([...notes.matchAll(/((?:19|20)\d{2})년?(?:은|는)?\s*잠정/g)].map(m => m[1]));
    return { ...expected, source_review: undefined, periods, source_name: source.slice(0, 1200), source_notes: notes.slice(0, 4000), series: expected.series.map((series,i) => ({ ...series,
      points: rows[i].points.map(point => point.value !== null && provisional.has(point.period) ? { ...point, status: "PROVISIONAL" as const } : point) })) };
  }
  throw new StatisticsError("SOURCE_FORMAT_CHANGED", "원문 표 구조를 확인하지 못해 확인본을 표시합니다.", 502);
}

function workerCache(): Cache | null { return (globalThis.caches as CacheStorage & { default?: Cache } | undefined)?.default ?? null; }
async function readCache(id: string): Promise<Cached | null> {
  const entry = memory.get(id);
  if (entry && entry.until > Date.now()) return entry;
  try {
    const response = await workerCache()?.match(CACHE_BASE + encodeURIComponent(id));
    const cached = response ? await response.json() as Cached : null;
    if (cached?.result.dataset.id === id && typeof cached.until === "number") return cached;
  } catch { /* Cache failure must not hide verified data. */ }
  return entry ?? null;
}
async function saveCache(id: string, result: StatisticsResult, ttl: number) {
  const value = { result, until: Date.now() + ttl };
  memory.set(id, value);
  while (memory.size > 16) memory.delete(memory.keys().next().value!);
  try { await workerCache()?.put(CACHE_BASE + encodeURIComponent(id), new Response(JSON.stringify(value), { headers: { "content-type": "application/json", "cache-control": "public, max-age=604800" } })); } catch { /* best effort */ }
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
async function boundedFetch(url: string, fetcher: Fetcher, pace: boolean): Promise<{ status: number; body: string }> {
  if (pace) { const pause = 3000 - (Date.now() - lastRequestAt); if (pause > 0) await new Promise(resolve => setTimeout(resolve, pause)); }
  const target = new URL(url);
  if (target.origin !== "https://www.index.go.kr" || !["/robots.txt", "/unity/potal/eNara/sub/showStblGams3.do"].includes(target.pathname)) throw new StatisticsError("SOURCE_NOT_ALLOWED", "허용된 공식 통계표만 조회할 수 있습니다.");
  lastRequestAt = Date.now();
  const response = await fetcher(url, { signal: AbortSignal.timeout(6500), redirect: "error", headers: { accept: target.pathname === "/robots.txt" ? "text/plain" : "text/html", "user-agent": USER_AGENT } });
  const limit = target.pathname === "/robots.txt" ? 64 * 1024 : MAX_BYTES;
  if (Number(response.headers.get("content-length")) > limit) throw new StatisticsError("SOURCE_TOO_LARGE", "원문 응답 크기가 조회 범위를 넘었습니다.", 502);
  const reader = response.body?.getReader();
  if (!reader) return { status: response.status, body: "" };
  const decoder = new TextDecoder(); let size = 0, body = "";
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > limit) { await reader.cancel(); throw new StatisticsError("SOURCE_TOO_LARGE", "원문 응답 크기가 조회 범위를 넘었습니다.", 502); } body += decoder.decode(part.value, { stream: true }); } } finally { reader.releaseLock(); }
  return { status: response.status, body: body + decoder.decode() };
}

export interface StatisticsReadOptions { readonly from_year?: number; readonly to_year?: number; readonly series_id?: string; readonly mode?: "auto" | "verified" }
export function filterStatistics(result: StatisticsResult, options: StatisticsReadOptions): StatisticsResult {
  result = reviewStatisticsSource(result);
  if ([options.from_year, options.to_year].some(y => y !== undefined && (!Number.isInteger(y) || y < 1900 || y > 2100))) throw new StatisticsError("INVALID_PERIOD", "연도는 1900~2100 사이 정수로 입력하세요.");
  if (options.from_year !== undefined && options.to_year !== undefined && options.from_year > options.to_year) throw new StatisticsError("INVALID_PERIOD", "시작연도가 종료연도보다 늦습니다.");
  if (options.series_id && !result.dataset.series.some(s => s.id === options.series_id)) throw new StatisticsError("SERIES_NOT_FOUND", "이 통계표에 해당 항목이 없습니다.", 404);
  const periods = result.dataset.periods.filter(p => (!options.from_year || Number(p.slice(0, 4)) >= options.from_year) && (!options.to_year || Number(p.slice(0, 4)) <= options.to_year));
  const series = result.dataset.series.filter(s => !options.series_id || s.id === options.series_id).map(s => ({ ...s, points: s.points.filter(p => periods.includes(p.period)) }));
  const warnings = [...result.warnings, ...(!periods.length ? ["요청한 기간의 자료가 수록되어 있지 않습니다. 0을 뜻하지 않으며 available_periods를 확인하세요."] : [])];
  return { ...result, dataset: { ...result.dataset, periods, series }, warnings };
}

export async function getStatisticsData(id: string, options: StatisticsReadOptions = {}, dependencies: { db?: SqlDatabase; fetcher?: Fetcher; pace?: boolean } = {}): Promise<StatisticsResult> {
  // All deployed web/API/MCP readers use the shared D1 publication. Explicit
  // standalone fetch dependencies retain the original parser/cache test adapter.
  if (dependencies.db) return (await import("./store.ts")).readCurrentStatistics(dependencies.db, id, options);
  const verified = verifiedStatistics(id);
  if (!verified) throw new StatisticsError("DATA_NOT_CONNECTED", "이 항목은 원문 안내만 제공합니다. 수치가 연결된 지표(data_available=true)를 선택하세요.", 404);
  // Validate before any network request.
  filterStatistics(verified, options);
  // Regional population is a source-verified month-end snapshot. Its monthly
  // tables do not use the national e-나라지표 parser or its refresh/cache path.
  if (options.mode === "verified" || verified.dataset.population || verified.dataset.kosis || verified.dataset.official_report) return filterStatistics(verified, options);
  const key = verified.dataset.id;
  const cached = await readCache(key);
  if (cached && cached.until > Date.now()) return filterStatistics({ ...cached.result, state: cached.result.refresh_error ? "SNAPSHOT_FALLBACK" : "CACHED" }, options);
  if (activeRefresh) {
    const previous = cached?.result ?? verified;
    return filterStatistics({ ...previous, warnings: [...previous.warnings, "다른 통계표를 확인 중이어서 저장된 확인본을 표시합니다."], state: "SNAPSHOT_FALLBACK", refresh_error: "REFRESH_BUSY" }, options);
  }
  activeRefresh = key;
  let result: StatisticsResult;
  try {
    const fetcher = dependencies.fetcher ?? fetch;
    if (!robots || robots.until <= Date.now()) {
      const response = await boundedFetch("https://www.index.go.kr/robots.txt", fetcher, dependencies.pace !== false);
      const target = new URL(verified.dataset.source_url);
      const policy = analyzeRobots(response.status, response.body, USER_AGENT, target.pathname + target.search);
      robots = { ...response, until: Date.now() + (policy.verdict === "UNREADABLE" ? ERROR_TTL : DAY) };
    }
    const url = new URL(verified.dataset.source_url);
    const permission = analyzeRobots(robots.status, robots.body, USER_AGENT, url.pathname + url.search);
    if (permission.verdict !== "ALLOWED" && permission.verdict !== "NO_ROBOTS") throw new StatisticsError(permission.verdict === "DISALLOWED" ? "ROBOTS_DISALLOWED" : "ROBOTS_UNAVAILABLE", "공식 사이트의 자동조회 정책을 확인하지 못해 저장된 확인본을 표시합니다.", 502);
    const response = await boundedFetch(url.href, fetcher, dependencies.pace !== false);
    if (response.status !== 200) throw new StatisticsError("SOURCE_UNAVAILABLE", "공식 통계표에 연결하지 못해 저장된 확인본을 표시합니다.", 502);
    const dataset = parseStatisticsHtml(response.body, verified.dataset);
    if (dataset.periods.at(-1)! < verified.dataset.periods.at(-1)!) throw new StatisticsError("SOURCE_PERIOD_REGRESSION", "원문 응답의 수록 기간이 확인본보다 이전이어서 확인본을 유지합니다.", 502);
    result = { ...verified, dataset, checked_at: new Date().toISOString(), state: "LIVE", available_periods: dataset.periods,
      // Hash is a content revision, not an API key or a release_bundle component.
      revision: "public-table:" + dataset.table_code + ":" + await contentHash(JSON.stringify(dataset.series)), warnings: [dataset.note] };
    await saveCache(key, result, DAY);
  } catch (error) {
    const code = error instanceof StatisticsError ? error.code : "SOURCE_UNAVAILABLE";
    const previous = cached?.result ?? verified;
    result = { ...previous, state: "SNAPSHOT_FALLBACK", refresh_error: code, warnings: [previous.dataset.note, "자동 확인에 실패하여 마지막 확인본을 제공합니다. checked_at과 관측연도는 다르며 최신 수치는 공식 원문에서 확인하세요."] };
    await saveCache(key, result, ERROR_TTL);
  } finally { activeRefresh = null; }
  return filterStatistics(result, options);
}

async function contentHash(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, "0")).join("").slice(0, 20);
}

/** Only local/Worker cache state is cleared. This never writes to the existing D1 database. */
export function resetStatisticsMemoryForTest(): void { memory.clear(); robots = null; activeRefresh = null; lastRequestAt = 0; }
export function connectedStatisticsIds(): readonly string[] { return STATISTICS_DATASETS.map(d => d.id); }
