import { POPULATION_SNAPSHOT } from "./population-verified.ts";
import { buildPopulationDatasets, POPULATION_PAGE_URLS } from "./population.ts";
import type { PopulationSexCounts, PopulationSnapshotRecord } from "./population.ts";
import type { StatisticsDataset } from "./types.ts";

export { POPULATION_PAGE_URLS } from "./population.ts";
export type PopulationPageKind = "age" | "older" | "children";
export interface PopulationPageStage {
  readonly schema_version: 1;
  readonly kind: PopulationPageKind;
  readonly source_url: string;
  readonly period: string;
  readonly rows: readonly { readonly code: string | null; readonly name: string; readonly values: readonly number[] }[];
  readonly evidence: {
    readonly table_title: string;
    readonly period_label: string;
    readonly numeric_headers: readonly string[];
    readonly row_count: number;
  };
}

export class PopulationParseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PopulationParseError";
    this.code = code;
  }
}

const KINDS = ["age", "older", "children"] as const;
const TITLES = {
  age: "행정동별 연령별 인구현황",
  older: "행정동별 지역별 고령 인구현황",
  children: "행정동별 지역별 아동,청소년,청년 인구현황",
} as const;
const BANDS = ["0-9세", "10-19세", "20-29세", "30-39세", "40-49세", "50-59세", "60-69세", "70-79세", "80-89세", "90-99세", "100세이상"];
const SEX_HEADERS = ["전체", "남자", "여자"];
const NUMERIC_HEADERS: Record<PopulationPageKind, readonly string[]> = {
  age: ["계", "남", "여"].flatMap((sex, index) => [index === 0 ? "총인구수" : sex + "인구수", "연령구간인구수", ...BANDS].map(label => sex + "/" + label)),
  older: [...SEX_HEADERS, ...SEX_HEADERS.map(sex => "65세이상/" + sex)],
  children: [...SEX_HEADERS, ...["아동(0-17세)", "청소년(9-24세)", "청년(19-34세)"].flatMap(group => SEX_HEADERS.map(sex => group + "/" + sex))],
};
// The verified geographic definition is intentionally fixed. A boundary/code change
// needs review; it must not silently replace the current 16-province coverage.
const REGIONS = POPULATION_SNAPSHOT.records.map(row => ({ code: row.regionCode, name: row.region }));
const REGION_BY_NAME = new Map<string, { code: string; name: string }>(REGIONS.map(region => [region.name, region]));
const PERIOD_PATTERN = /^20\d{2}-(?:0[1-9]|1[0-2])$/;
const MAX_HTML_LENGTH = 2_000_000;

function fail(code: string, message: string): never { throw new PopulationParseError(code, message); }
function normalized(text: string): string { return text.replace(/[\s\u00a0\u200b]+/g, "").replace(/[~～−–—]/g, "-"); }
function decodeHtml(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", middot: "·" };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, value: string) => {
    if (value[0] !== "#") return named[value.toLowerCase()] ?? entity;
    const number = value[1].toLowerCase() === "x" ? parseInt(value.slice(2), 16) : parseInt(value.slice(1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : entity;
  });
}
function plainText(html: string): string { return decodeHtml(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(); }
function periodFromLabel(label: string): string | null {
  const match = /^(20\d{2})년(0?[1-9]|1[0-2])월$/.exec(normalized(label));
  return match ? match[1] + "-" + match[2].padStart(2, "0") : null;
}
function isKind(value: unknown): value is PopulationPageKind { return KINDS.includes(value as PopulationPageKind); }
function sum(values: readonly number[]): number { return values.reduce((total, value) => total + value, 0); }
function assertSame(actual: number, expected: number, detail: string): void {
  if (actual !== expected) fail("SOURCE_TOTAL_MISMATCH", detail + " 합계가 일치하지 않습니다.");
}
function assertCount(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail("SOURCE_FORMAT_CHANGED", "인구 수치에 결측값 또는 올바르지 않은 정수가 있습니다.");
}
function countFromCell(text: string): number {
  if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(text)) fail("SOURCE_FORMAT_CHANGED", "인구 수치 셀 형식을 확인할 수 없습니다.");
  const value = Number(text.replaceAll(",", ""));
  assertCount(value);
  return value;
}

interface HtmlCell { text: string; rowSpan: number; colSpan: number }
function spanFromAttributes(attributes: string, name: "rowspan" | "colspan"): number {
  if (!new RegExp("\\b" + name + "\\b", "i").test(attributes)) return 1;
  const match = new RegExp("\\b" + name + "\\s*=\\s*(?:\"(\\d+)\"|'(\\d+)'|(\\d+)(?=\\s|/|$))", "i").exec(attributes);
  const value = Number(match?.[1] ?? match?.[2] ?? match?.[3]);
  if (!Number.isSafeInteger(value) || value < 1 || value > 45) fail("SOURCE_FORMAT_CHANGED", "표 병합 셀의 범위를 확인할 수 없습니다.");
  return value;
}
function tableRows(table: string): HtmlCell[][] {
  const rows: HtmlCell[][] = [];
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    const cells = [...row[1].matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)].map(cell => ({
      text: plainText(cell[3]), rowSpan: spanFromAttributes(cell[2], "rowspan"), colSpan: spanFromAttributes(cell[2], "colspan"),
    }));
    if (cells.length) rows.push(cells);
    if (rows.length > 80 || cells.length > 45) fail("SOURCE_FORMAT_CHANGED", "예상한 광역시·도 표의 크기를 초과했습니다.");
  }
  return rows;
}
function headerGrid(rows: readonly HtmlCell[][], width: number): HtmlCell[][] {
  if (rows.length < 2 || rows.length > 6) fail("SOURCE_FORMAT_CHANGED", "표의 다단 헤더 구조가 변경되었습니다.");
  const grid: HtmlCell[][] = Array.from({ length: rows.length }, () => []);
  for (const [rowIndex, row] of rows.entries()) {
    let column = 0;
    for (const cell of row) {
      while (grid[rowIndex][column]) column++;
      if (rowIndex + cell.rowSpan > rows.length || column + cell.colSpan > width) fail("SOURCE_FORMAT_CHANGED", "표 헤더 병합 범위가 데이터 열과 맞지 않습니다.");
      for (let r = rowIndex; r < rowIndex + cell.rowSpan; r++) for (let c = column; c < column + cell.colSpan; c++) {
        if (grid[r][c]) fail("SOURCE_FORMAT_CHANGED", "표 헤더의 병합 셀이 겹칩니다.");
        grid[r][c] = cell;
      }
      column += cell.colSpan;
    }
  }
  if (grid.some(row => row.length !== width || Array.from({ length: width }, (_, i) => row[i]).some(cell => !cell))) fail("SOURCE_FORMAT_CHANGED", "표 헤더에 누락된 열이 있습니다.");
  return grid;
}
function leafTables(html: string): string[] {
  const tables: string[] = [];
  const stack: { start: number; nested: boolean }[] = [];
  for (const tag of html.matchAll(/<\/?table\b[^>]*>/gi)) {
    if (/^<table\b/i.test(tag[0])) {
      if (stack.length) stack[stack.length - 1].nested = true;
      stack.push({ start: tag.index!, nested: false });
      if (stack.length > 12) fail("SOURCE_FORMAT_CHANGED", "표 구조의 중첩이 지나치게 깊습니다.");
    } else {
      const open = stack.pop();
      if (open && !open.nested) tables.push(html.slice(open.start, tag.index! + tag[0].length));
    }
    if (tables.length > 80) fail("SOURCE_FORMAT_CHANGED", "표 개수가 예상한 범위를 초과했습니다.");
  }
  if (stack.length) fail("SOURCE_FORMAT_CHANGED", "닫히지 않은 표가 있습니다.");
  return tables;
}

function validateStage(stage: PopulationPageStage): void {
  if (!stage || stage.schema_version !== 1 || !isKind(stage.kind) || stage.source_url !== POPULATION_PAGE_URLS[stage.kind]
    || typeof stage.period !== "string" || !PERIOD_PATTERN.test(stage.period) || !stage.evidence
    || stage.evidence.table_title !== TITLES[stage.kind] || typeof stage.evidence.period_label !== "string"
    || periodFromLabel(stage.evidence.period_label) !== stage.period
    || !Array.isArray(stage.evidence.numeric_headers)
    || JSON.stringify(stage.evidence.numeric_headers) !== JSON.stringify(NUMERIC_HEADERS[stage.kind])) {
    fail("SOURCE_FORMAT_CHANGED", "인구 원문의 구조·기준월·연령 헤더 근거를 확인할 수 없습니다.");
  }
  if (!Array.isArray(stage.rows) || stage.rows.length !== REGIONS.length || stage.evidence.row_count !== REGIONS.length) fail("SOURCE_REGION_MISMATCH", "전국과 16개 광역시·도 행이 모두 있어야 합니다.");
  const names = new Set<string>();
  for (const row of stage.rows) {
    const region = row && REGION_BY_NAME.get(row.name);
    if (!region || names.has(row.name) || (row.code !== null && row.code !== region.code) || (stage.kind === "age" && row.code !== region.code)) fail("SOURCE_REGION_MISMATCH", "지역 명칭·행정기관코드가 확인본과 다르거나 중복되었습니다.");
    names.add(row.name);
    if (!Array.isArray(row.values) || row.values.length !== NUMERIC_HEADERS[stage.kind].length) fail("SOURCE_FORMAT_CHANGED", "인구 원문의 수치 열 개수가 변경되었습니다.");
    row.values.forEach(assertCount);
    const v = row.values;
    if (stage.kind === "age") {
      for (let column = 0; column < 13; column++) assertSame(v[column], v[column + 13] + v[column + 26], row.name + " 연령별 남녀");
      for (const offset of [0, 13, 26]) {
        assertSame(v[offset], v[offset + 1], row.name + " 전체 연령구간");
        assertSame(v[offset], sum(v.slice(offset + 2, offset + 13)), row.name + " 11개 연령구간");
      }
    } else {
      for (let offset = 0; offset < v.length; offset += 3) {
        assertSame(v[offset], v[offset + 1] + v[offset + 2], row.name + " 성별");
        for (let sex = 0; sex < 3; sex++) if (v[offset + sex] > v[sex]) fail("SOURCE_TOTAL_MISMATCH", "연령별 인구가 같은 성별 전체 인구보다 많습니다.");
      }
    }
    if (v[0] === 0) fail("SOURCE_TOTAL_MISMATCH", "지역 전체인구가 0인 불완전한 표입니다.");
  }
  const national = stage.rows.find(row => row.name === "전국")!;
  const provinces = stage.rows.filter(row => row.name !== "전국");
  for (let column = 0; column < national.values.length; column++) assertSame(national.values[column], sum(provinces.map(row => row.values[column])), "전국과 16개 시도");
}

/** Parse only a complete, semantically verified server-rendered public table.
 * The saved source evidence is extracted text, not original HTML. Unsupported
 * markup deliberately fails closed so the collector can keep its last snapshot.
 */
export function parsePopulationPage(kind: PopulationPageKind, html: string): PopulationPageStage {
  if (!isKind(kind) || typeof html !== "string") fail("SOURCE_FORMAT_CHANGED", "지원하지 않는 인구 원문입니다.");
  if (html.length > MAX_HTML_LENGTH) fail("SOURCE_TOO_LARGE", "인구 원문이 허용한 크기를 초과했습니다.");
  const document = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  if (!normalized(plainText(document)).includes(normalized(TITLES[kind]))) fail("SOURCE_FORMAT_CHANGED", "인구 원문의 표 제목을 확인할 수 없습니다.");
  const candidates = leafTables(document).filter(table => {
    const text = normalized(plainText(table));
    return text.includes("행정기관코드") && text.includes("행정기관") && text.includes("전국");
  });
  if (candidates.length !== 1) fail("SOURCE_FORMAT_CHANGED", "인구 원문의 단일 광역시·도 표를 확인할 수 없습니다.");
  const rows = tableRows(candidates[0]);
  const firstData = rows.findIndex(row => row.length >= 2 && (/^\d{1,10}$/.test(row[0].text) || REGION_BY_NAME.has(row[1].text)));
  if (firstData < 0) fail("SOURCE_FORMAT_CHANGED", "인구 원문의 지역 행을 확인할 수 없습니다.");
  const expectedWidth = NUMERIC_HEADERS[kind].length + 2;
  const grid = headerGrid(rows.slice(0, firstData), expectedWidth);
  if (grid.some(row => normalized(row[0].text) !== "행정기관코드" || normalized(row[1].text) !== "행정기관")) fail("SOURCE_FORMAT_CHANGED", "행정기관 식별 열의 순서가 변경되었습니다.");
  const headerCells = [...new Set(grid.flat())];
  const periodCells = headerCells.filter(cell => periodFromLabel(cell.text));
  if (periodCells.length !== 1) fail("SOURCE_FORMAT_CHANGED", "단일 기준월 헤더를 확인할 수 없습니다.");
  const monthCell = periodCells[0];
  const period = periodFromLabel(monthCell.text)!;
  const numericHeaders: string[] = [];
  for (let column = 2; column < expectedWidth; column++) {
    const path = [...new Set(grid.map(row => row[column]))];
    if (path[0] !== monthCell) fail("SOURCE_FORMAT_CHANGED", "수치 열이 동일한 기준월에 속하지 않습니다.");
    numericHeaders.push(path.slice(1).map(cell => normalized(cell.text)).join("/"));
  }
  if (JSON.stringify(numericHeaders) !== JSON.stringify(NUMERIC_HEADERS[kind])) fail("SOURCE_FORMAT_CHANGED", "성별·연령구간 헤더 또는 열 순서가 변경되었습니다.");
  const dataRows = rows.slice(firstData);
  if (dataRows.length !== REGIONS.length) fail("SOURCE_REGION_MISMATCH", "전국과 16개 광역시·도 행이 모두 있어야 합니다.");
  const identifiers = dataRows.map(row => row[0]?.text);
  const officialCodes = identifiers.every(value => /^\d{10}$/.test(value));
  const displayIndices = kind !== "age" && identifiers.every((value, index) => value === String(index));
  if (!officialCodes && !displayIndices) fail("SOURCE_REGION_MISMATCH", "행정기관코드 또는 원문의 행 번호 형식이 변경되었습니다.");
  const parsedRows = dataRows.map(row => {
    if (row.length !== expectedWidth || row.some(cell => cell.colSpan !== 1 || cell.rowSpan !== 1)) fail("SOURCE_FORMAT_CHANGED", "지역 수치 행의 열 개수 또는 병합 구조가 변경되었습니다.");
    return { code: officialCodes ? row[0].text : null, name: row[1].text, values: row.slice(2).map(cell => countFromCell(cell.text)) };
  });
  const stage: PopulationPageStage = { schema_version: 1, kind, source_url: POPULATION_PAGE_URLS[kind], period, rows: parsedRows,
    evidence: { table_title: TITLES[kind], period_label: monthCell.text, numeric_headers: numericHeaders, row_count: parsedRows.length } };
  validateStage(stage);
  return stage;
}

/** Revalidate persisted normalized stages and publish the three datasets together. */
export function mergePopulationPages(stages: readonly PopulationPageStage[], options: { now: Date | string | number; minimumPeriod: string }): readonly StatisticsDataset[] {
  if (!Array.isArray(stages) || stages.length !== KINDS.length || new Set(stages.map(stage => stage?.kind)).size !== KINDS.length || KINDS.some(kind => !stages.some(stage => stage?.kind === kind))) fail("SOURCE_INCOMPLETE", "인구 원문 3종이 모두 완결된 뒤에만 갱신할 수 있습니다.");
  stages.forEach(validateStage);
  const period = stages[0].period;
  if (stages.some(stage => stage.period !== period)) fail("SOURCE_PERIOD_MISMATCH", "인구 원문 3종의 기준월이 서로 다릅니다.");
  const now = new Date(options.now instanceof Date ? options.now.getTime() : options.now);
  if (!Number.isFinite(now.getTime())) fail("INVALID_CHECK_TIME", "인구 원문 확인 시각이 올바르지 않습니다.");
  if (!PERIOD_PATTERN.test(options.minimumPeriod)) fail("SOURCE_FORMAT_CHANGED", "마지막 확인본의 기준월이 올바르지 않습니다.");
  if (period < options.minimumPeriod) fail("SOURCE_PERIOD_REGRESSION", "공표월이 마지막 정상 확인본보다 과거입니다.");
  const koreanNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const currentMonth = koreanNow.toISOString().slice(0, 7);
  if (period >= currentMonth) fail("SOURCE_FUTURE_PERIOD", "아직 종료되지 않은 월 또는 미래 월은 인구 확인본으로 승인할 수 없습니다.");
  const byKind = Object.fromEntries(stages.map((stage: PopulationPageStage) => [stage.kind, new Map(stage.rows.map(row => [row.name, row]))])) as Record<PopulationPageKind, Map<string, PopulationPageStage["rows"][number]>>;
  const sexCounts = (values: readonly number[]): PopulationSexCounts => ({ total: values[0], male: values[1], female: values[2] });
  const records: PopulationSnapshotRecord[] = REGIONS.map(region => {
    const age = byKind.age.get(region.name)!.values;
    const older = byKind.older.get(region.name)!.values;
    const children = byKind.children.get(region.name)!.values;
    const totals = [age[0], age[13], age[26]];
    const under40 = [0, 13, 26].map(offset => sum(age.slice(offset + 2, offset + 6)));
    const middle = totals.map((value, sex) => value - under40[sex] - older[3 + sex]);
    for (const [sex, offset] of [0, 13, 26].entries()) {
      assertSame(totals[sex], older[sex], region.name + " 연령·고령 원문 전체인구");
      assertSame(totals[sex], children[sex], region.name + " 연령·아동 원문 전체인구");
      const ages60to64 = middle[sex] - age[offset + 6] - age[offset + 7];
      const age0to9 = age[offset + 2];
      const age0to19 = age0to9 + age[offset + 3];
      if (!Number.isSafeInteger(middle[sex]) || middle[sex] < 0 || ages60to64 < 0 || ages60to64 > age[offset + 8]
        || children[3 + sex] < age0to9 || children[3 + sex] > age0to19) fail("SOURCE_TOTAL_MISMATCH", "원문 간 연령구간의 포함 관계가 일치하지 않습니다.");
    }
    assertSame(middle[0], middle[1] + middle[2], region.name + " 중장년 남녀");
    return { regionCode: region.code, region: region.name, level: region.code === "0000000000" ? "national" : "sido",
      totalPopulation: totals[0], malePopulation: totals[1], femalePopulation: totals[2], middleAged: sexCounts(middle), elderly: sexCounts(older.slice(3, 6)), children: sexCounts(children.slice(3, 6)), sourceAgeUnder40: sexCounts(under40) };
  });
  const [year, month] = period.split("-").map(Number);
  return buildPopulationDatasets({ period, referenceDate: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10), checkedAt: now.toISOString(), coverage: POPULATION_SNAPSHOT.coverage, records });
}
