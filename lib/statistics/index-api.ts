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
export class IndexFormatError extends StatisticsError {
  readonly detail: string;
  constructor(detail: string) { super("SOURCE_FORMAT_CHANGED", "지표누리 응답의 통계표·항목·단위를 확인하지 못해 마지막 정상 자료를 유지합니다.", 502); this.detail = detail.slice(0, 400); }
}
/** 어느 검사에서 멈췄는지와 기대값·실제값을 남겨 원천 응답 변화를 바로 알 수 있게 한다. */
function changed(detail = "unknown"): never { throw new IndexFormatError(detail); }
function shape(value: unknown, body: string): string {
  const kind = Array.isArray(value) ? "array(" + value.length + ")" : value && typeof value === "object" ? "object{" + Object.keys(value).slice(0, 8).join(",") + "}" : typeof value;
  return kind + " " + body.replace(/s+/g, " ").slice(0, 120);
}

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
  if (!Array.isArray(value) || !value.length || value.length > 5000) changed("response " + shape(value, body));
  const selectors = INDEX_API_SERIES[expected.id]?.filter(s => !s.table_code || s.table_code === expected.table_code);
  if (!selectors || selectors.length !== expected.series.length) changed("selectors");
  const points = new Map<string, Map<string, StatisticsPoint>>(selectors.map(s => [s.key, new Map()]));
  const maximumYear = expected.indicator_code === "1430" ? 2040 : new Date(now).getUTCFullYear() + 1;
  let metadata: Row | null = null;
  // 2026-10-15 개편(국가데이터처 공지 "OPEN API 통계표 JSON 구조 변경 예정 안내")부터 메타데이터는 데이터 앞의 별도 객체로 한 번만 오고
  // 데이터 객체에는 주기·항목·시점·값만 남는다. 예전처럼 데이터마다 메타데이터가 붙은 응답도 함께 받는다.
  let header: Row | null = null;
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) changed("row " + shape(candidate, JSON.stringify(candidate) ?? ""));
    const raw: Row = candidate;
    const isHeader = Boolean(field(raw, "통계표코드")) && !("시점" in raw) && !("값" in raw);
    if (isHeader && header) changed("header repeated");
    const row: Row = isHeader ? raw : { ...header, ...raw };
    if (field(row, "지표코드") !== expected.indicator_code || field(row, "통계표코드") !== expected.table_code
      || norm(field(row, "통계표명")) !== norm(expected.table_title) || norm(field(row, "단위")) !== norm(expected.original_unit)
      || !field(row, "출처")) changed("table " + JSON.stringify([field(row, "지표코드"), field(row, "통계표코드"), field(row, "통계표명"), field(row, "단위"), Boolean(field(row, "출처"))]) + " expected " + JSON.stringify([expected.indicator_code, expected.table_code, expected.table_title, expected.original_unit]));
    if (isHeader) { header = row; continue; }
    if (field(row, "주기코드") !== (expected.index_api?.frequency ?? "Y")) {
      if (expected.indicator_code === "2763" && field(row, "주기코드") === "R") continue;
      changed("frequency " + field(row, "주기코드") + " keys " + Object.keys(row).join(","));
    }
    if (metadata && ["갱신일", "입력예정일", "단위", "출처", "주석"].some(k => field(metadata!, k) !== field(row, k))) changed("metadata " + ["갱신일", "입력예정일", "단위", "출처", "주석"].filter(k => field(metadata!, k) !== field(row, k)).join(","));
    metadata ??= row;
    const key = identity(row), selector = selectors.find(s => s.key === key);
    if (!selector || norm(label(row)) !== norm(selector.label)) changed("item " + key + " " + label(row) + " keys " + Object.keys(row).join(",") + " row " + JSON.stringify(row).slice(0, 220));
    const period = field(row, "시점");
    if (!/^(?:19|20)\d{2}$/.test(period) || Number(period) < 2016 || Number(period) > maximumYear) changed("period " + period);
    const observations = points.get(key)!;
    if (observations.has(period) || (row["값"] !== null && typeof row["값"] !== "string")) changed("value " + period + " " + typeof row["값"]);
    let point: StatisticsPoint = { period, ...parseStatisticValue(field(row, "값")) };
    const notes = text(field(row, "주석"));
    if (point.value !== null && expected.indicator_code === "1430") point = { ...point, status: "ESTIMATE" };
    else if (point.value !== null && new RegExp(period + "년?(?:은|는|자료는|자료는)?\\s*(?:자료는\\s*)?잠정").test(notes)) point = { ...point, status: "PROVISIONAL" };
    observations.set(period, point);
  }
  if (!metadata || selectors.some(s => !points.get(s.key)?.size)) changed("missing items " + selectors.filter(s => !points.get(s.key)?.size).map(s => s.key).join(";"));
  let periods = [...new Set([...points.values()].flatMap(map => [...map.keys()]))].sort();
  if ((expected.index_api?.frequency ?? "Y") === "Y") periods = Array.from({ length: Number(periods.at(-1)) - Number(periods[0]) + 1 }, (_, i) => String(Number(periods[0]) + i));
  const series = expected.series.map(series => {
    const selector = selectors.find(s => s.id === series.id)!;
    const observations = points.get(selector.key)!;
    return { ...series, points: periods.map(period => observations.get(period) ?? { period, raw: "", value: null, status: "MISSING" as const }) };
  });
  if (!series.some(s => s.points.some(p => p.value !== null))) throw new StatisticsError("SOURCE_INCOMPLETE", "지표누리 응답에 수치가 없습니다.", 502);
  const updated = field(metadata, "갱신일"), next = field(metadata, "입력예정일");
  if (![updated, next].every(date => date === "" || /^\d{8}$/.test(date))) changed("dates " + updated + "/" + next);
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
    || tables.some(table => !parts.some(part => part.table_code === table.table_code && part.id === expected.id))) changed("tables " + parts.map(part => part.table_code).join(","));
  const periods = [...new Set(parts.flatMap(part => part.periods))].sort();
  const series = expected.series.map(series => {
    const found = parts.flatMap(part => part.series).find(item => item.id === series.id);
    if (!found) changed("series " + series.id);
    return { ...found, points: periods.map(period => found.points.find(point => point.period === period) ?? { period, raw: "", value: null, status: "MISSING" as const }) };
  });
  return { ...expected, source_review: undefined, periods, series, source_name: [...new Set(parts.map(part => part.source_name))].join(" · "),
    source_notes: parts.map(part => part.table_title + ": " + part.source_notes).join("\n"),
    index_api: { ...expected.index_api!, updated_at: parts.map(part => part.index_api!.updated_at).sort().at(-1)!,
      next_update: parts.map(part => part.index_api!.next_update).filter(Boolean).sort()[0] ?? "" } };
}
