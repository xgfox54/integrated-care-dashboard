import { INDEX_API_SERIES } from "./index-verified-data.ts";
import { parseStatisticValue, StatisticsError } from "./read.ts";
import type { StatisticsDataset, StatisticsPoint } from "./types.ts";

export const INDEX_API_PATH = "/unity/openApi/sttsJsonViewer.do";
const MAX_BYTES = 1024 * 1024;
type Row = Record<string, unknown>;
function field(row: Row, key: string): string { return typeof row[key] === "string" ? row[key] : ""; }
function text(value: string): string {
  return value.replace(/<br\s*\/?>/gi, " ").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
function norm(value: string): string { return text(value).normalize("NFKC").replace(/[\s/,·ㆍ]+/g, ""); }
function identity(row: Row): string { return ["항목그룹코드", "항목코드", "분류1코드", "분류2코드", "분류3코드"].map(k => field(row, k)).join("|"); }
function label(row: Row): string { return [...new Set(["항목그룹이름", "항목이름", "분류1이름", "분류2이름", "분류3이름"].map(k => field(row, k)).filter(Boolean))].join(" / "); }
function changed(): never { throw new StatisticsError("SOURCE_FORMAT_CHANGED", "지표누리 응답의 통계표·항목·단위를 확인하지 못해 마지막 정상 자료를 유지합니다.", 502); }

export function indexApiUrl(dataset: StatisticsDataset, key: string, year = new Date().getUTCFullYear()): string {
  if (!INDEX_API_SERIES[dataset.id] || !key) throw new StatisticsError("SOURCE_KEY_REQUIRED", "지표누리 인증키가 필요합니다.", 503);
  const url = new URL(INDEX_API_PATH, "https://www.index.go.kr");
  url.search = new URLSearchParams({ idntfcId: key, ixCode: dataset.indicator_code, statsCode: dataset.table_code,
    period: "2016:" + (dataset.indicator_code === "1430" ? 2040 : year + 1) }).toString();
  return url.href;
}

export function parseIndexApi(body: string, expected: StatisticsDataset, now = Date.now()): StatisticsDataset {
  if (body.length > MAX_BYTES) throw new StatisticsError("SOURCE_TOO_LARGE", "지표누리 응답 크기가 조회 범위를 넘었습니다.", 502);
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw new StatisticsError("SOURCE_API_UNAVAILABLE", "지표누리 API 응답을 확인하지 못했습니다.", 502); }
  if (!Array.isArray(value) || !value.length || value.length > 5000) changed();
  const selectors = INDEX_API_SERIES[expected.id]?.filter(s => !s.table_code || s.table_code === expected.table_code);
  if (!selectors || selectors.length !== expected.series.length) changed();
  const points = new Map<string, Map<string, StatisticsPoint>>(selectors.map(s => [s.key, new Map()]));
  const maximumYear = expected.indicator_code === "1430" ? 2040 : new Date(now).getUTCFullYear() + 1;
  let metadata: Row | null = null;
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) changed();
    const row: Row = candidate;
    if (field(row, "지표코드") !== expected.indicator_code || field(row, "통계표코드") !== expected.table_code
      || norm(field(row, "통계표명")) !== norm(expected.table_title) || norm(field(row, "단위")) !== norm(expected.original_unit)
      || !field(row, "출처")) changed();
    if (field(row, "주기코드") !== (expected.index_api?.frequency ?? "Y")) {
      if (expected.indicator_code === "2763" && field(row, "주기코드") === "R") continue;
      changed();
    }
    if (metadata && ["갱신일", "입력예정일", "단위", "출처", "주석"].some(k => field(metadata!, k) !== field(row, k))) changed();
    metadata ??= row;
    const key = identity(row), selector = selectors.find(s => s.key === key);
    if (!selector || norm(label(row)) !== norm(selector.label)) changed();
    const period = field(row, "시점");
    if (!/^(?:19|20)\d{2}$/.test(period) || Number(period) < 2016 || Number(period) > maximumYear) changed();
    const observations = points.get(key)!;
    if (observations.has(period) || (row["값"] !== null && typeof row["값"] !== "string")) changed();
    let point: StatisticsPoint = { period, ...parseStatisticValue(field(row, "값")) };
    const notes = text(field(row, "주석"));
    if (point.value !== null && expected.indicator_code === "1430") point = { ...point, status: "ESTIMATE" };
    else if (point.value !== null && new RegExp(period + "년?(?:은|는|자료는|자료는)?\\s*(?:자료는\\s*)?잠정").test(notes)) point = { ...point, status: "PROVISIONAL" };
    observations.set(period, point);
  }
  if (!metadata || selectors.some(s => !points.get(s.key)?.size)) changed();
  let periods = [...new Set([...points.values()].flatMap(map => [...map.keys()]))].sort();
  if ((expected.index_api?.frequency ?? "Y") === "Y") periods = Array.from({ length: Number(periods.at(-1)) - Number(periods[0]) + 1 }, (_, i) => String(Number(periods[0]) + i));
  const series = expected.series.map(series => {
    const selector = selectors.find(s => s.id === series.id)!;
    const observations = points.get(selector.key)!;
    return { ...series, points: periods.map(period => observations.get(period) ?? { period, raw: "", value: null, status: "MISSING" as const }) };
  });
  if (!series.some(s => s.points.some(p => p.value !== null))) throw new StatisticsError("SOURCE_INCOMPLETE", "지표누리 응답에 수치가 없습니다.", 502);
  const updated = field(metadata, "갱신일"), next = field(metadata, "입력예정일");
  if (![updated, next].every(date => date === "" || /^\d{8}$/.test(date))) changed();
  return { ...expected, source_review: undefined, periods, series, source_name: text(field(metadata, "출처")),
    source_notes: text(field(metadata, "주석")) || "원문에 별도 주석이 제공되지 않습니다.",
    index_api: { ...expected.index_api, updated_at: updated, next_update: next, projection: expected.indicator_code === "1430" } };
}

export function indexApiTables(dataset: StatisticsDataset): readonly StatisticsDataset[] {
  const tables = dataset.index_api?.tables;
  if (!tables?.length) return [dataset];
  return tables.map(table => ({ ...dataset, table_code: table.table_code, table_title: table.table_title,
    original_unit: table.original_unit, source_url: table.source_url,
    series: dataset.series.filter(series => INDEX_API_SERIES[dataset.id]?.some(selector => selector.id === series.id && selector.table_code === table.table_code)),
    index_api: { ...dataset.index_api!, frequency: table.frequency } }));
}

export function mergeIndexApiTables(expected: StatisticsDataset, parts: readonly StatisticsDataset[]): StatisticsDataset {
  const tables = indexApiTables(expected);
  if (parts.length !== tables.length || new Set(parts.map(part => part.table_code)).size !== tables.length
    || tables.some(table => !parts.some(part => part.table_code === table.table_code && part.id === expected.id))) changed();
  const periods = [...new Set(parts.flatMap(part => part.periods))].sort();
  const series = expected.series.map(series => {
    const found = parts.flatMap(part => part.series).find(item => item.id === series.id);
    if (!found) changed();
    return { ...found, points: periods.map(period => found.points.find(point => point.period === period) ?? { period, raw: "", value: null, status: "MISSING" as const }) };
  });
  return { ...expected, source_review: undefined, periods, series, source_name: [...new Set(parts.map(part => part.source_name))].join(" · "),
    source_notes: parts.map(part => part.table_title + ": " + part.source_notes).join("\n"),
    index_api: { ...expected.index_api!, updated_at: parts.map(part => part.index_api!.updated_at).sort().at(-1)!,
      next_update: parts.map(part => part.index_api!.next_update).filter(Boolean).sort()[0] ?? "" } };
}
