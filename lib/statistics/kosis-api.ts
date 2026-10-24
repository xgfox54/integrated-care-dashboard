import { parseStatisticValue, StatisticsError } from "./read.ts";
import type { KosisTableMetadata, StatisticsDataset, StatisticsPoint, StatisticsSeries } from "./types.ts";

export const KOSIS_API_PATH = "/openapi/Param/statisticsParameterData.do";
export const KOSIS_META_PATH = "/openapi/statisticsData.do";
type Row = Record<string, unknown>;
const field = (row: Row, key: string) => typeof row[key] === "string" ? row[key] as string : "";
const norm = (value: string) => value.normalize("NFKC").replace(/^\d+\)\s*/, "").replace(/[\s,·ㆍ]+/g, "").trim();
export class KosisFormatError extends StatisticsError {
  readonly detail: string;
  constructor(detail: string) {
    super("SOURCE_FORMAT_CHANGED", "KOSIS 항목·단위·시점 검증에 실패해 마지막 정상 자료를 유지합니다.", 502);
    this.detail = detail.slice(0, 400);
  }
}
export class KosisApiError extends StatisticsError {
  readonly detail: string;
  constructor(code: string) {
    const safe = /^\d{1,3}$/.test(code) ? code : "UNKNOWN";
    super(code === "11" ? "SOURCE_KEY_REJECTED" : code === "31" ? "SOURCE_TOO_LARGE" : code === "40" ? "SOURCE_RATE_LIMITED" : "SOURCE_API_UNAVAILABLE", "KOSIS 오류 코드 " + safe, 502);
    this.detail = "KOSIS error " + safe;
  }
}
function changed(detail: string): never { throw new KosisFormatError(detail); }
export function kosisJson(body: string): Row[] {
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw new StatisticsError("SOURCE_API_UNAVAILABLE", "KOSIS JSON 응답을 확인하지 못했습니다.", 502); }
  if (value && !Array.isArray(value) && typeof value === "object" && "err" in value) {
    const code = String(value.err);
    // Never persist the upstream error text: it can echo the authenticated URL.
    throw new KosisApiError(code);
  }
  if (!Array.isArray(value) || !value.length || value.length > 40_000 || value.some(row => !row || typeof row !== "object" || Array.isArray(row))) changed("empty or invalid rows");
  return value as Row[];
}

/** The key reader returns a percent-encoded key, matching the existing KOSIS integration. */
export interface KosisSelection { readonly items: readonly string[]; readonly classes: Readonly<Record<string, readonly string[]>>; readonly omit_item_name: boolean; readonly ancestors: Readonly<Record<string, readonly string[]>>; readonly virtual_classes: readonly string[] }
export function kosisApiUrl(table: KosisTableMetadata, key: string, frequency?: string, selection?: KosisSelection, metaType: "PRD" | "ITM" = "PRD", range?: { readonly from: string; readonly to: string }): string {
  const params = new URLSearchParams({ method: frequency ? "getList" : "getMeta", format: "json", jsonVD: "Y", orgId: table.org_id, tblId: table.tbl_id });
  if (frequency) {
    params.set("prdSe", frequency);
    if (range) { params.set("startPrdDe", range.from); params.set("endPrdDe", range.to); } else params.set("newEstPrdCnt", "2");
    params.set("itmId", selection ? selection.items.join("+") : "ALL"); params.set("smblChk", "Y");
    for (let i = 1; i <= 8; i++) params.set("objL" + i, selection ? (selection.classes[String(i)]?.join("+") ?? "") : "ALL");
  } else params.set("type", metaType);
  return "https://kosis.kr" + (frequency ? KOSIS_API_PATH : KOSIS_META_PATH) + "?apiKey=" + key + "&" + params;
}
export function kosisFrequency(body: string): string {
  const rows = kosisJson(body);
  const frequencies = [...new Set(rows.map(row => { const value = field(row, "PRD_SE"); return value === "년" ? "Y" : /^\d+년$/.test(value) ? "F" : value === "부정기" ? "IR" : value; }).filter(value => ["Y", "F", "IR"].includes(value)))];
  if (frequencies.length !== 1) changed("annual frequency " + frequencies.join(","));
  return frequencies[0];
}
function identity(row: Row): string { return [field(row, "ITM_ID"), ...Array.from({ length: 8 }, (_, i) => field(row, "C" + (i + 1)))].join("|"); }
export function kosisLatestPerItem(body: string): string {
  const groups = new Map<string, Row[]>();
  for (const row of kosisJson(body)) { const key = identity(row); const group = groups.get(key) ?? []; group.push(row); groups.set(key, group); }
  return JSON.stringify([...groups.values()].flatMap(group => group.sort((a, b) => field(b, "PRD_DE").localeCompare(field(a, "PRD_DE"))).slice(0, 2)));
}
function labelParts(label: string): string[] {
  return [...new Set(label.split(" / ").map(part => norm(part.replace(/\s+\([^()]+\)$/, ""))).filter(part => part && part !== "소계"))].sort();
}
export function kosisSelection(body: string, expected: StatisticsDataset, table: KosisTableMetadata): KosisSelection {
  const rows = kosisJson(body);
  const tokens = new Set(expected.series.filter(series => series.source_url === table.url).flatMap(series => labelParts(expected.kosis!.tables.length > 1 ? series.label.slice((table.title + " · ").length) : series.label)));
  const items = rows.filter(row => field(row, "OBJ_ID") === "ITEM");
  const chosen = items.filter(row => tokens.has(norm(field(row, "ITM_NM"))));
  const omitItem = items.length === 1;
  const selectedItems = omitItem ? items : chosen;
  if (!selectedItems.length) changed("item metadata missing");
  const classes: Record<string, string[]> = {}, ancestors: Record<string, string[]> = {};
  const virtualClasses = new Set<string>();
  for (const row of rows) {
    if (field(row, "ORG_ID") !== table.org_id || field(row, "TBL_ID") !== table.tbl_id) changed("metadata table");
    const index = field(row, "OBJ_ID_SN"), id = field(row, "ITM_ID"), name = field(row, "ITM_NM");
    if (!/^[1-8]$/.test(index)) continue;
    const virtual = norm(field(row, "OBJ_NM")) === "가상분류" && name === "데이터" && id === "DATA";
    if (virtual) virtualClasses.add(index);
    const national = ["전국", "전체", "계", "합계", "총계"].includes(name);
    if (virtual || (index === "1" && table.national_only ? national : tokens.has(norm(name)) || name === "소계")) (classes[index] ??= []).push(id);
    const parents: string[] = [];
    let parent = field(row, "UP_ITM_ID");
    const seen = new Set<string>([id]);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const ancestor = rows.find(candidate => field(candidate, "OBJ_ID") === field(row, "OBJ_ID") && field(candidate, "ITM_ID") === parent);
      if (!ancestor) break;
      parents.push(field(ancestor, "ITM_NM")); parent = field(ancestor, "UP_ITM_ID");
    }
    if (parents.length) ancestors[index + ":" + id] = parents;
  }
  const indices = [...new Set(rows.map(row => field(row, "OBJ_ID_SN")).filter(index => /^[1-8]$/.test(index)))];
  if (["DT_117035_2023", "DT_117102_A001"].includes(table.tbl_id)) {
    for (const index of indices) classes[index] = classes[index]?.filter(code => {
      const row = rows.find(row => field(row, "OBJ_ID_SN") === index && field(row, "ITM_ID") === code);
      const parent = row && rows.find(candidate => field(candidate, "OBJ_ID") === field(row, "OBJ_ID") && field(candidate, "ITM_ID") === field(row, "UP_ITM_ID"));
      return !parent || norm(field(parent, "ITM_NM")) !== norm(field(row!, "ITM_NM"));
    });
  }
  if (indices.some(index => !classes[index]?.length)) changed("classification metadata missing");
  return { items: selectedItems.map(row => field(row, "ITM_ID")), classes, omit_item_name: omitItem, ancestors, virtual_classes: [...virtualClasses] };
}
function matches(row: Row, series: StatisticsSeries, table: KosisTableMetadata, multiple: boolean, selection?: KosisSelection): boolean {
  const label = multiple ? series.label.slice((table.title + " · ").length) : series.label;
  const expected = labelParts(label);
  const values = selection?.omit_item_name ? [] : [field(row, "ITM_NM")];
  const optional: string[] = selection?.omit_item_name ? [field(row, "ITM_NM")] : [];
  for (let i = 1; i <= 8; i++) {
    const value = field(row, "C" + i + "_NM"), group = field(row, "C" + i + "_OBJ_NM");
    if (selection?.virtual_classes.includes(String(i))) continue;
    if (i === 1 && table.national_only) {
      if (!["전국", "전체", "계", "합계", "총계"].includes(value)) return false;
      optional.push(value);
    }
    else if (value) values.push(value);
    if (group) optional.push(group);
    optional.push(...(selection?.ancestors[i + ":" + field(row, "C" + i)] ?? []));
  }
  const required = labelParts(values.join(" / "));
  const allowed = new Set([...required, ...labelParts(optional.join(" / "))]);
  // No unknown value dimension may be discarded; group headings may be present in the web layout.
  return required.every(part => expected.includes(part)) && expected.every(part => allowed.has(part))
    || selection?.omit_item_name === true && Object.keys(selection.classes).every(index => selection.virtual_classes.includes(index)) && norm(label) === norm(table.title)
    || expected.length === 1 && norm(label) === norm(table.title) && required.length === 1 && norm(field(row, "ITM_NM")) === norm(table.title);
}

export interface KosisPart { readonly table: string; readonly frequency: string; readonly body: string; readonly selection?: KosisSelection }
export function parseKosisApi(body: string, expected: StatisticsDataset, table: KosisTableMetadata, frequency: string, now: number, selection?: KosisSelection): { series: StatisticsSeries[]; updated: string | null; body: string } {
  const rows = kosisJson(body);
  const selected = expected.series.filter(series => series.source_url === table.url);
  const bySeries = new Map<string, { key: string; points: Map<string, StatisticsPoint>; unitFromSnapshot: boolean }>();
  const retained: Row[] = [];
  let updated: string | null = null;
  for (const row of rows) {
    if (field(row, "ORG_ID") !== table.org_id || field(row, "TBL_ID") !== table.tbl_id || norm(field(row, "TBL_NM")) !== norm(table.title)) changed("table identity " + JSON.stringify([field(row, "ORG_ID"), field(row, "TBL_ID"), field(row, "TBL_NM")]));
    const responseFrequency = field(row, "PRD_SE");
    if (![frequency, "A", "년", ...(frequency === "F" ? ["F2", "F3", "F4", "F5", "F10"] : [])].includes(responseFrequency) || !field(row, "ITM_ID")) changed("period or item code " + responseFrequency + " " + field(row, "ITM_ID"));
    const key = identity(row);
    if (selection && (!selection.items.includes(field(row, "ITM_ID")) || Object.entries(selection.classes).some(([index, codes]) => !codes.includes(field(row, "C" + index))))) changed("unrequested API codes");
    const candidates = selected.filter(series => (!series.kosis_key || series.kosis_key === key) && matches(row, series, table, expected.kosis!.tables.length > 1, selection));
    if (!candidates.length) continue;
    if (candidates.length !== 1) changed("ambiguous item " + field(row, "ITM_ID"));
    const series = candidates[0];
    const compoundUnits = expected.original_unit.split(",").map(norm);
    const compoundMatch = expected.kosis!.tables.length === 1 && compoundUnits.length > 1 && compoundUnits.includes(norm(series.unit)) && norm(field(row, "UNIT_NM")) === norm(expected.original_unit);
    const unitFromSnapshot = !field(row, "UNIT_NM").trim() || compoundMatch;
    if (!unitFromSnapshot && norm(field(row, "UNIT_NM")) !== norm(series.unit)) changed("unit " + series.id + " " + field(row, "UNIT_NM") + " expected " + series.unit);
    const period = field(row, "PRD_DE");
    if (!/^(19|20)\d{2}$/.test(period) || Number(period) > new Date(now).getUTCFullYear()) changed("annual period");
    const observations = bySeries.get(series.id) ?? { key, points: new Map<string, StatisticsPoint>(), unitFromSnapshot: false };
    observations.unitFromSnapshot ||= unitFromSnapshot;
    if (observations.key !== key || observations.points.has(period)) changed("duplicate item " + series.id);
    const raw = field(row, "DT");
    const marker = /\s*([pe])\)?$/.exec(raw);
    const parsed = parseStatisticValue(marker ? raw.slice(0, marker.index) : raw);
    observations.points.set(period, { period, ...parsed, raw, status: parsed.value === null ? parsed.status : marker?.[1] === "p" ? "PROVISIONAL" : marker?.[1] === "e" ? "ESTIMATE" : parsed.status });
    bySeries.set(series.id, observations);
    const date = field(row, "LST_CHN_DE");
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && (!updated || date > updated)) updated = date;
    const fields = ["ORG_ID", "TBL_ID", "TBL_NM", "ITM_ID", "ITM_NM", "UNIT_NM", "PRD_SE", "PRD_DE", "DT", "LST_CHN_DE", ...Array.from({ length: 8 }, (_, i) => ["C" + (i + 1), "C" + (i + 1) + "_NM", "C" + (i + 1) + "_OBJ_NM"]).flat()];
    retained.push(Object.fromEntries(fields.filter(name => typeof row[name] === "string").map(name => [name, row[name]])));
  }
  const missing = selected.filter(series => !bySeries.has(series.id));
  if (missing.length) changed("missing " + missing.length + ": " + missing.slice(0, 2).map(series => series.label).join("; ") + " sample " + JSON.stringify(Object.fromEntries(Object.entries(rows[0]).filter(([key]) => /^(ITM_NM|C[1-8]_NM|UNIT_NM)$/.test(key)))));
  const periods = [...new Set([...bySeries.values()].flatMap(row => [...row.points.keys()]))].sort();
  const latest = periods.at(-1);
  if (!latest) changed("missing periods");
  return { updated, body: JSON.stringify(retained), series: selected.map(series => {
    const observations = bySeries.get(series.id)!;
    const newest = [...observations.points.keys()].sort().at(-1)!;
    return { ...series, kosis_key: observations.key, unit_source: observations.unitFromSnapshot ? "verified_table" as const : "api" as const,
      points: periods.filter(period => observations.points.has(period) || period > newest).map(period => observations.points.get(period) ?? { period, raw: "", value: null, status: "MISSING" as const }) };
  }) };
}

export function mergeKosisParts(expected: StatisticsDataset, parts: readonly KosisPart[], now: number): StatisticsDataset {
  if (parts.length !== expected.kosis!.tables.length || new Set(parts.map(part => part.table)).size !== parts.length) changed("incomplete table set");
  const parsed = expected.kosis!.tables.map(table => {
    const part = parts.find(part => part.table === table.tbl_id);
    if (!part) changed("missing table");
    return { table, ...parseKosisApi(part.body, expected, table, part.frequency, now, part.selection) };
  });
  const series = expected.series.map(series => parsed.flatMap(part => part.series).find(row => row.id === series.id)!);
  const periods = [...new Set(series.flatMap(row => row.points.map(point => point.period)))].sort();
  if (parsed.some(part => part.series.every(row => row.points.at(-1)?.period !== periods.at(-1)))) changed("table periods differ");
  return { ...expected, periods, series, description: expected.table_title + " · KOSIS API · 수록 " + periods[0] + "~" + periods.at(-1) + "년",
    note: expected.note.replace(/KOSIS 국가통계포털 공개 통계표에서 .*?에 확인한 값입니다\./, "KOSIS 국가통계포털 API에서 확인한 값입니다."),
    source_notes: parsed.map(part => part.table.title + ": API 자료갱신일 " + (part.updated ?? "미제공")).join(" / ") + " · 연결된 대표 항목만 제공합니다. 원자료 단위를 유지합니다." + (series.some(row => row.unit_source === "verified_table") ? " API가 항목별 단위를 제공하지 않은 경우 공식표 확인본의 단위를 유지합니다." : ""),
    kosis: { ...expected.kosis!, checked_at: new Date(now).toISOString(), tables: parsed.map(part => ({ ...part.table, updated_at: part.updated, checked_at: new Date(now).toISOString() })) } };
}
