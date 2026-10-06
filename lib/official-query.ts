import { getD1 } from "./d1";
import { PUBLIC_KNOWLEDGE_RUN_SQL } from "./platform/public-pin";
import {
  type FilterState,
  type ServiceRow,
  serviceWikiKey,
} from "./dataset";
import {
  type DatasetSummary,
  normalizeSearchPageSize,
  orderServiceCategories,
  SINGLE_TIER_SIDO,
} from "./dataset-summary";
import { verifiedSourceFieldSql } from "./official-source-restoration.ts";
import { repairKnownExtractionFragments } from "./official-correction";
import { CATEGORY_TEXT_SQL, NAME_TEXT_SQL, SEARCH_TEXT_FROM_COLUMNS, SEARCH_TEXT_LOOKUP, searchConditionSql, searchTermSql } from "./official-search-text";
import { repairExtractionSpacing } from "./official-spacing";
import { cachedWikiEdits } from "./wiki-edit-store";
import type { RegionTarget } from "./region-load-order";
import { applyWikiEdits, type WikiEditValues } from "./wiki-edits";
import { normalizeName, type MatchState } from "./usage/codes";
import {
  correctionFrom,
  effectiveSort,
  namesForSuggestion,
  parseSearch,
  rebuildQuery,
  RELEVANCE,
  searchableText,
  type SearchHelp,
  type SearchTerm,
} from "./search-terms";

const RESTORED_SUBCATEGORY_SQL = verifiedSourceFieldSql("subcategory");
const RESTORED_TYPE_SQL = `CASE WHEN type = '경기도' THEN '광역' ELSE ${verifiedSourceFieldSql("type")} END`;
const RESTORED_SEARCH_TEXT_SQL = SEARCH_TEXT_FROM_COLUMNS
  .replaceAll("COALESCE(subcategory,", `COALESCE((${RESTORED_SUBCATEGORY_SQL}),`)
  .replaceAll("COALESCE(type,", `COALESCE((${RESTORED_TYPE_SQL}),`);
// 필터·집계·정렬·검색 본문 모두 표시할 원문 구분을 사용한다. 저장된 원본은 변경하지 않는다.
const SOURCE_ROWS_SQL = `(SELECT id, service_id, sync_run_id, sido, sigungu, category,
  ${RESTORED_SUBCATEGORY_SQL} AS subcategory, name, description, target, detail_target,
  application_method, provider, ${RESTORED_TYPE_SQL} AS type, serial, detail_url, updated_date,
  CASE WHEN subcategory IS NOT (${RESTORED_SUBCATEGORY_SQL}) OR type IS NOT (${RESTORED_TYPE_SQL})
    THEN ${RESTORED_SEARCH_TEXT_SQL} ELSE search_text END AS search_text
  FROM official_service_snapshot)`;

const INTEGRATED_PROVINCE_NAME = "전남광주통합특별시";
const INTEGRATED_PROVINCE_ALIASES = ["광주광역시", "전라남도"] as const;
export const CANONICAL_SIDO_SQL =
  "CASE WHEN sido IN ('광주광역시', '전라남도') THEN '전남광주통합특별시' ELSE sido END";
/** 「수록 시·군·구」: 시·군·구 칸이 비었거나 기초자치단체가 없는 광역(세종·제주)의 행은 세지 않는다. */
const MUNICIPALITY_KEY_SQL =
  "CASE WHEN sigungu <> '' AND sido NOT IN (" +
  SINGLE_TIER_SIDO.map((sido) => "'" + sido + "'").join(", ") +
  ") THEN " + CANONICAL_SIDO_SQL + " || '|' || sigungu END";

export interface LatestRun {
  readonly id: string;
  readonly completedAt: number;
  readonly documentCount: number;
  readonly dataAsOf: string;
}

interface CountRow {
  readonly value: string;
  readonly count: number;
}

interface TotalRow {
  readonly count: number;
}

interface SearchWhere {
  readonly sql: string;
  readonly values: readonly unknown[];
}

export interface SearchAggregates {
  readonly rowCount: number;
  readonly categoryCounts: Readonly<Record<string, number>>;
  readonly typeCounts: Readonly<Record<string, number>>;
}

/**
 * 검색어가 현재 검색 범위(지역·분류) 안의 사업명 하나와 정확히 같은지. 이용통계의 '명칭 검색' 집계에 쓴다.
 * 검색어 자체는 담지 않고, 하나로 정해질 때만 그 사업의 WIKI 키를 담는다.
 */
export interface SearchNameMatch {
  readonly status: MatchState;
  readonly key?: string;
}

export interface OfficialSearchResult {
  readonly rows: readonly ServiceRow[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly regionCounts: Readonly<Record<string, number>>;
  readonly categoryCounts: Readonly<Record<string, number>>;
  readonly regionSummary: SearchAggregates;
  readonly dataAsOf: string;
  readonly completedAt: string;
  readonly documentCount: number;
  readonly nameMatch?: SearchNameMatch;
  /** 검색어가 있는데 결과가 0건일 때만: 오타 제안, 단어를 하나씩 뺀 결과 수. */
  readonly searchHelp?: SearchHelp;
}

function iso(seconds: number): string {
  return seconds ? new Date(seconds * 1000).toISOString() : "";
}

const LATEST_RUN_TTL_MS = 30_000;

async function loadLatestRun(): Promise<LatestRun | null> {
  const db = getD1();
  const run = await db.prepare(
    `SELECT id, completed_at AS completedAt, document_count AS documentCount,
       COALESCE((SELECT MAX(data_as_of) FROM official_source_document
                 WHERE sync_run_id = official_sync_run.id), '') AS dataAsOf
     FROM official_sync_run
     WHERE id = ${PUBLIC_KNOWLEDGE_RUN_SQL}`,
  ).first<LatestRun>();
  return run ?? null;
}

let latestRunMemo: { readonly promise: Promise<LatestRun | null>; readonly expiresAt: number } | null = null;

/** 웹이 공개하는 수집 실행(활성 통합 공개본의 실행, 공개본이 없으면 가장 최근 성공 실행). 30초 동안 기억해 두고, fresh면 새로 읽는다(수집 직후 미리 계산용). */
export function readLatestRun(fresh = false): Promise<LatestRun | null> {
  const now = Date.now();
  if (!fresh && latestRunMemo && now < latestRunMemo.expiresAt) return latestRunMemo.promise;
  const promise = loadLatestRun();
  const memo = { promise, expiresAt: now + LATEST_RUN_TTL_MS };
  latestRunMemo = memo;
  promise.catch(() => {
    if (latestRunMemo === memo) latestRunMemo = null;
  });
  return promise;
}

const latestRun = () => readLatestRun();

function rowsToRecord(rows: readonly CountRow[]): Record<string, number> {
  return Object.fromEntries(rows.filter((row) => row.value).map((row) => [row.value, row.count]));
}

function bindAll<T>(sql: string, values: readonly unknown[]): Promise<readonly T[]> {
  const statement = getD1().prepare(sql);
  return statement.bind(...values).all<T>().then((result) => result.results ?? []);
}

function addSidoFilter(parts: string[], values: unknown[], sido: string): void {
  if (!sido) return;
  if (sido === INTEGRATED_PROVINCE_NAME) {
    parts.push("sido IN (?, ?)");
    values.push(...INTEGRATED_PROVINCE_ALIASES);
  } else {
    parts.push("sido = ?");
    values.push(sido);
  }
}

function searchWhere(filters: FilterState, includeRegion = true): SearchWhere {
  const parts = ["sync_run_id = ?"];
  const values: unknown[] = [];
  if (includeRegion) {
    addSidoFilter(parts, values, filters.sido);
    if (filters.sigungu) {
      parts.push("sigungu = ?");
      values.push(filters.sigungu);
    }
  }
  if (filters.category) {
    parts.push("category = ?");
    values.push(filters.category);
  }
  if (filters.subcategory) {
    parts.push("subcategory = ?");
    values.push(filters.subcategory);
  }
  if (filters.type) {
    parts.push("type = ?");
    values.push(filters.type);
  }
  // 검색어의 단어마다 조건 하나(모든 단어가 들어 있어야 함). 지역어는 정식 이름 중 하나만 있어도 된다.
  for (const term of parseSearch(filters.keyword).terms) {
    const condition = termCondition(term);
    parts.push(condition.sql);
    values.push(...condition.values);
  }
  return { sql: parts.join(" AND "), values };
}

function termCondition(term: SearchTerm): SearchWhere {
  return searchConditionSql(term, SEARCH_TEXT_LOOKUP);
}

const NAME_KEY_SQL =
  "LOWER(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(name, ''), ' ', ''), char(9), ''), char(10), ''), char(13), ''))";
const REGION_ORDER_SQL = "sido, sigungu, name, id";

/** 결과 정렬. 관련도순은 lib/search-terms.ts의 relevanceScore와 같은 점수표를 SQL로 계산한다. */
function orderBy(filters: FilterState): SearchWhere {
  const sort = effectiveSort(filters.sort, filters.keyword);
  if (sort === "name") return { sql: "name, sido, sigungu, id", values: [] };
  const parsed = parseSearch(filters.keyword);
  if (sort === "region" || parsed.terms.length === 0) return { sql: REGION_ORDER_SQL, values: [] };
  const parts: string[] = [];
  const values: unknown[] = [];
  for (const term of parsed.terms) {
    if (term.negated) continue;
    const inName = searchTermSql(term, NAME_TEXT_SQL);
    if (term.region) {
      parts.push(`CASE WHEN ${inName.sql} THEN ${RELEVANCE.nameRegionTerm} ELSE 0 END`);
      values.push(...inName.values);
    } else {
      const inCategory = searchTermSql(term, CATEGORY_TEXT_SQL);
      parts.push(
        `CASE WHEN ${inName.sql} THEN ${RELEVANCE.nameTerm}` +
          ` WHEN ${inCategory.sql} THEN ${RELEVANCE.categoryTerm} ELSE 0 END`,
      );
      values.push(...inName.values, ...inCategory.values);
    }
  }
  if (parsed.phrase) {
    const multiple = parsed.terms.filter((term) => !term.region && !term.negated).length >= 2;
    parts.push(
      multiple
        ? `CASE WHEN ${NAME_KEY_SQL} = ? THEN ${RELEVANCE.exactName} WHEN INSTR(${NAME_KEY_SQL}, ?) > 0 THEN ${RELEVANCE.namePhrase} ELSE 0 END`
        : `CASE WHEN ${NAME_KEY_SQL} = ? THEN ${RELEVANCE.exactName} ELSE 0 END`,
    );
    values.push(parsed.phrase, ...(multiple ? [parsed.phrase] : []));
  }
  return { sql: `(${parts.join(" + ")}) DESC, ${REGION_ORDER_SQL}`, values };
}

// 오타 제안용 사업명 목록. 자료 수집 회차가 바뀔 때만 다시 읽는다.
let suggestionNames: { readonly runId: string; readonly names: readonly string[] } | null = null;

async function namesOfRun(runId: string): Promise<readonly string[]> {
  if (suggestionNames?.runId === runId) return suggestionNames.names;
  const rows = await bindAll<{ name: string | null }>(
    `SELECT name FROM ${SOURCE_ROWS_SQL} WHERE sync_run_id = ?`,
    [runId],
  );
  suggestionNames = { runId, names: namesForSuggestion(rows.map((row) => row.name ?? "")) };
  return suggestionNames.names;
}

/** 결과가 0건일 때: 전국 자료에 없는 단어는 오타로 보고 고칠 말을, 두 단어 이상이면 하나씩 뺀 결과 수를 알려 준다. */
async function computeSearchHelp(filters: FilterState, runId: string): Promise<SearchHelp | undefined> {
  const parsed = parseSearch(filters.keyword);
  if (parsed.terms.length === 0) return undefined;
  const conditions = parsed.terms.map(termCondition);
  const db = getD1();
  const perTerm = await db
    .prepare(
      `SELECT ${conditions.map((condition, index) => `SUM(CASE WHEN ${condition.sql} THEN 1 ELSE 0 END) AS t${index}`).join(", ")}
       FROM ${SOURCE_ROWS_SQL} WHERE sync_run_id = ?`,
    )
    .bind(...conditions.flatMap((condition) => condition.values), runId)
    .first<Record<string, number | null>>();

  let withoutTerm: { term: string; query: string; count: number }[] | undefined;
  if (parsed.terms.length >= 2) {
    const base = searchWhere({ ...filters, keyword: "" });
    const leaveOut = conditions.map((_, index) => {
      const others = conditions.filter((__, other) => other !== index);
      return {
        sql: `SUM(CASE WHEN ${others.map((condition) => condition.sql).join(" AND ")} THEN 1 ELSE 0 END) AS w${index}`,
        values: others.flatMap((condition) => condition.values),
      };
    });
    const counts = await db
      .prepare(`SELECT ${leaveOut.map((part) => part.sql).join(", ")} FROM ${SOURCE_ROWS_SQL} WHERE ${base.sql}`)
      .bind(...leaveOut.flatMap((part) => part.values), ...withRun(base, runId))
      .first<Record<string, number | null>>();
    withoutTerm = parsed.terms.map((term, index) => ({
      term: term.text,
      query: rebuildQuery(parsed, index),
      count: Number(counts?.[`w${index}`] ?? 0),
    }));
  }

  let suggestion: { query: string; count: number } | undefined;
  const unknown = parsed.terms
    .map((term, index) => ({ term, index }))
    .filter(({ term, index }) => !term.region && term.plain && Number(perTerm?.[`t${index}`] ?? 0) === 0);
  if (unknown.length > 0) {
    const names = await namesOfRun(runId);
    const words = parsed.terms.map((term) => term.text);
    let changed = false;
    for (const { term, index } of unknown) {
      const fix = correctionFrom(term.key, names);
      if (fix) {
        words[index] = fix;
        changed = true;
      }
    }
    if (changed) {
      const query = words.join(" ");
      const where = searchWhere({ ...filters, keyword: query });
      const total = await db
        .prepare(`SELECT COUNT(*) AS count FROM ${SOURCE_ROWS_SQL} WHERE ${where.sql}`)
        .bind(...withRun(where, runId))
        .first<TotalRow>();
      if ((total?.count ?? 0) > 0) suggestion = { query, count: total?.count ?? 0 };
    }
  }
  if (!suggestion && !withoutTerm) return undefined;
  return { ...(suggestion ? { suggestion } : {}), ...(withoutTerm ? { withoutTerm } : {}) };
}

function regionOnlyWhere(filters: FilterState): SearchWhere {
  const parts = ["sync_run_id = ?"];
  const values: unknown[] = [];
  addSidoFilter(parts, values, filters.sido);
  if (filters.sigungu) {
    parts.push("sigungu = ?");
    values.push(filters.sigungu);
  }
  return { sql: parts.join(" AND "), values };
}

function withRun(where: SearchWhere, runId: string): readonly unknown[] {
  return [runId, ...where.values];
}

function normalizeServiceRows(
  rows: readonly Record<string, unknown>[],
  edits: ReadonlyMap<string, WikiEditValues>,
  offset = 0,
): ServiceRow[] {
  const corrected = applyWikiEdits(repairExtractionSpacing(
    repairKnownExtractionFragments(rows.map((row) => ({
      serviceId: String(row.serviceId ?? ""),
      sido: String(row.sido ?? ""),
      sigungu: String(row.sigungu ?? ""),
      category: String(row.category ?? ""),
      subcategory: String(row.subcategory ?? ""),
      name: String(row.name ?? ""),
      description: String(row.description ?? ""),
      target: String(row.target ?? ""),
      detailTarget: String(row.detailTarget ?? ""),
      applicationMethod: String(row.applicationMethod ?? ""),
      provider: String(row.provider ?? ""),
      type: String(row.type ?? ""),
      serial: String(row.serial ?? ""),
      detailUrl: String(row.detailUrl ?? ""),
      updatedDate: String(row.updatedDate ?? ""),
    }))),
  ), edits);
  return corrected.map((row, index) => ({
    ...row,
    id: offset + index,
    searchIndex: searchableText([
      row.sido,
      row.sigungu,
      row.category,
      row.subcategory,
      row.name,
      row.description,
      row.target,
      row.detailTarget,
      row.applicationMethod,
      row.provider,
      row.type,
    ]),
    applicationMethod: row.applicationMethod ?? "",
  }));
}

const SELECT_COLUMNS = `
  service_id AS serviceId,
  ${CANONICAL_SIDO_SQL} AS sido,
  sigungu,
  category,
  subcategory,
  name,
  description,
  target,
  detail_target AS detailTarget,
  application_method AS applicationMethod,
  provider,
  type,
  serial,
  detail_url AS detailUrl,
  updated_date AS updatedDate`;

export async function readOfficialDatasetSummary(): Promise<{
  readonly summary: DatasetSummary;
  readonly dataAsOf: string;
  readonly completedAt: string;
  readonly documentCount: number;
}> {
  const run = await latestRun();
  if (!run) {
    return {
      summary: {
        totalCount: 0,
        sidoCount: 0,
        sigunguCount: 0,
        categoryCount: 0,
        regionCounts: {},
        categoryCounts: {},
        sigunguBySido: {},
        categories: [],
      },
      dataAsOf: "",
      completedAt: "",
      documentCount: 0,
    };
  }
  const db = getD1();
  const [total, regions, categories, municipalities] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS totalCount,
        COUNT(DISTINCT ${CANONICAL_SIDO_SQL}) AS sidoCount,
        COUNT(DISTINCT ${MUNICIPALITY_KEY_SQL}) AS sigunguCount,
        COUNT(DISTINCT category) AS categoryCount
       FROM ${SOURCE_ROWS_SQL} WHERE sync_run_id = ?`,
    ).bind(run.id).first<{
      totalCount: number;
      sidoCount: number;
      sigunguCount: number;
      categoryCount: number;
    }>(),
    bindAll<CountRow>(
      `SELECT ${CANONICAL_SIDO_SQL} AS value, COUNT(*) AS count
       FROM ${SOURCE_ROWS_SQL} WHERE sync_run_id = ? GROUP BY value ORDER BY value`,
      [run.id],
    ),
    bindAll<CountRow>(
      `SELECT category AS value, COUNT(*) AS count
       FROM ${SOURCE_ROWS_SQL} WHERE sync_run_id = ? GROUP BY category ORDER BY value`,
      [run.id],
    ),
    bindAll<{ sido: string; sigungu: string }>(
      `SELECT ${CANONICAL_SIDO_SQL} AS sido, sigungu
       FROM ${SOURCE_ROWS_SQL}
       WHERE sync_run_id = ? AND sigungu <> ''
       GROUP BY sido, sigungu ORDER BY sido, sigungu`,
      [run.id],
    ),
  ]);
  const sigunguBySido: Record<string, string[]> = {};
  for (const row of municipalities) {
    (sigunguBySido[row.sido] ??= []).push(row.sigungu);
  }
  const categoryCounts = rowsToRecord(categories);
  return {
    summary: {
      totalCount: total?.totalCount ?? 0,
      sidoCount: total?.sidoCount ?? 0,
      sigunguCount: total?.sigunguCount ?? 0,
      categoryCount: total?.categoryCount ?? 0,
      regionCounts: rowsToRecord(regions),
      categoryCounts,
      sigunguBySido,
      categories: orderServiceCategories(Object.keys(categoryCounts)),
    },
    dataAsOf: run.dataAsOf,
    completedAt: iso(run.completedAt),
    documentCount: run.documentCount,
  };
}

export async function searchOfficialServices(
  filters: FilterState,
  requestedPage: number,
  requestedPageSize?: number,
): Promise<OfficialSearchResult> {
  const run = await latestRun();
  const pageSize = normalizeSearchPageSize(requestedPageSize);
  if (!run) {
    return {
      rows: [], totalCount: 0, page: 1, pageSize, pageCount: 1,
      regionCounts: {}, categoryCounts: {},
      regionSummary: { rowCount: 0, categoryCounts: {}, typeCounts: {} },
      dataAsOf: "", completedAt: "", documentCount: 0,
    };
  }
  const where = searchWhere(filters);
  const nationwideWhere = searchWhere(filters, false);
  const regionWhere = regionOnlyWhere(filters);
  const total = await getD1().prepare(
    `SELECT COUNT(*) AS count FROM ${SOURCE_ROWS_SQL} WHERE ${where.sql}`,
  ).bind(...withRun(where, run.id)).first<TotalRow>();
  const totalCount = total?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const offset = (page - 1) * pageSize;
  const nameKey = normalizeName(filters.keyword);
  const order = orderBy(filters);
  const [records, regionCounts, categoryCounts, regionCategories, regionTypes, edits, nameRecords, searchHelp] = await Promise.all([
    bindAll<Record<string, unknown>>(
      `SELECT ${SELECT_COLUMNS} FROM ${SOURCE_ROWS_SQL}
       WHERE ${where.sql}
       ORDER BY ${order.sql} LIMIT ? OFFSET ?`,
      [...withRun(where, run.id), ...order.values, pageSize, offset],
    ),
    bindAll<CountRow>(
      `SELECT ${CANONICAL_SIDO_SQL} AS value, COUNT(*) AS count
       FROM ${SOURCE_ROWS_SQL} WHERE ${nationwideWhere.sql}
       GROUP BY value ORDER BY value`,
      withRun(nationwideWhere, run.id),
    ),
    bindAll<CountRow>(
      `SELECT category AS value, COUNT(*) AS count
       FROM ${SOURCE_ROWS_SQL} WHERE ${where.sql}
       GROUP BY category ORDER BY count DESC, value`,
      withRun(where, run.id),
    ),
    bindAll<CountRow>(
      `SELECT category AS value, COUNT(*) AS count
       FROM ${SOURCE_ROWS_SQL} WHERE ${regionWhere.sql}
       GROUP BY category ORDER BY count DESC, value`,
      withRun(regionWhere, run.id),
    ),
    bindAll<CountRow>(
      `SELECT type AS value, COUNT(*) AS count
       FROM ${SOURCE_ROWS_SQL} WHERE ${regionWhere.sql}
      GROUP BY type ORDER BY count DESC, value`,
      withRun(regionWhere, run.id),
    ),
    cachedWikiEdits(),
    nameKey
      ? bindAll<Record<string, unknown>>(
          `SELECT ${SELECT_COLUMNS} FROM ${SOURCE_ROWS_SQL}
           WHERE ${where.sql}
             AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(name, ' ', ''), char(9), ''), char(10), ''), char(13), '')) = ?
           ORDER BY sido, sigungu, name, id LIMIT 4`,
          [...withRun(where, run.id), nameKey],
        )
      : Promise.resolve([] as readonly Record<string, unknown>[]),
    totalCount === 0 && filters.keyword.trim() ? computeSearchHelp(filters, run.id) : Promise.resolve(undefined),
  ]);
  return {
    rows: normalizeServiceRows(records, edits, offset),
    totalCount,
    page,
    pageSize,
    pageCount,
    regionCounts: rowsToRecord(regionCounts),
    categoryCounts: rowsToRecord(categoryCounts),
    regionSummary: {
      rowCount: regionCategories.reduce((sum, row) => sum + row.count, 0),
      categoryCounts: rowsToRecord(regionCategories),
      typeCounts: rowsToRecord(regionTypes),
    },
    dataAsOf: run.dataAsOf,
    completedAt: iso(run.completedAt),
    documentCount: run.documentCount,
    ...(nameKey ? { nameMatch: nameMatchOf(normalizeServiceRows(nameRecords, edits)) } : {}),
    ...(searchHelp ? { searchHelp } : {}),
  };
}

function nameMatchOf(rows: readonly ServiceRow[]): SearchNameMatch {
  const keys = [...new Set(rows.map((row) => serviceWikiKey(row)))];
  if (keys.length === 1) return { status: "matched", key: keys[0] };
  return { status: keys.length === 0 ? "unmatched" : "ambiguous" };
}

export async function exportOfficialServices(filters: FilterState): Promise<ServiceRow[]> {
  const run = await latestRun();
  if (!run) return [];
  const where = searchWhere(filters);
  const order = orderBy(filters);
  const [records, edits] = await Promise.all([
    bindAll<Record<string, unknown>>(
      `SELECT ${SELECT_COLUMNS} FROM ${SOURCE_ROWS_SQL}
       WHERE ${where.sql} ORDER BY ${order.sql}`,
      [...withRun(where, run.id), ...order.values],
    ),
    cachedWikiEdits(),
  ]);
  return normalizeServiceRows(records, edits);
}

// ---- 지역 묶음(대시보드 미리받기) ----

const INTEGRATED_ALIAS_SET = new Set<string>(INTEGRATED_PROVINCE_ALIASES);
/** 검색 API의 광역 필터와 같은 뜻: 통합특별시는 광주·전남 원자료만 가리킨다. */
const TARGET_SIDO_SQL =
  "CASE WHEN sido IN ('광주광역시', '전라남도') THEN '전남광주통합특별시' WHEN sido = '전남광주통합특별시' THEN NULL ELSE sido END";
const REGION_PAIR_FILTER =
  " AND (sido, sigungu) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?))";

interface GroupRow {
  readonly sido: string | null;
  readonly sigungu?: string | null;
  readonly category: string | null;
  readonly type: string | null;
  readonly count: number;
}

function emptySearchResult(pageSize: number): OfficialSearchResult {
  return {
    rows: [], totalCount: 0, page: 1, pageSize, pageCount: 1,
    regionCounts: {}, categoryCounts: {},
    regionSummary: { rowCount: 0, categoryCounts: {}, typeCounts: {} },
    dataAsOf: "", completedAt: "", documentCount: 0,
  };
}

function canonicalSido(raw: string): string {
  return INTEGRATED_ALIAS_SET.has(raw) ? INTEGRATED_PROVINCE_NAME : raw;
}

function sidoMatches(target: string, raw: string): boolean {
  return target === INTEGRATED_PROVINCE_NAME ? INTEGRATED_ALIAS_SET.has(raw) : raw === target;
}

function rawRegionPairs(targets: readonly RegionTarget[]): [string, string][] {
  return targets.flatMap(({ sido, sigungu }): [string, string][] =>
    sido === INTEGRATED_PROVINCE_NAME
      ? INTEGRATED_PROVINCE_ALIASES.map((alias): [string, string] => [alias, sigungu])
      : [[sido, sigungu]],
  );
}

// SQLite 기본 정렬(BINARY)과 같은 순서. 한글은 모두 BMP 문자라 UTF-16 비교와 같다.
const compareBinary = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

function addCount(map: Map<string, number>, key: string, count: number): void {
  map.set(key, (map.get(key) ?? 0) + count);
}

/** ORDER BY count DESC, value 와 같은 순서의 집계표(빈 값 제외). */
function countsByDescending(counts: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...counts]
      .filter(([value]) => value)
      .sort((left, right) => right[1] - left[1] || compareBinary(left[0], right[0])),
  );
}

/** ORDER BY value 와 같은 순서의 집계표(빈 값 제외). */
function countsByValue(counts: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...counts].filter(([value]) => value).sort((left, right) => compareBinary(left[0], right[0])),
  );
}

/**
 * 여러 지역의 첫 쪽 검색 결과를 한 번에 계산한다. 각 결과는 같은 지역·분야·쪽 크기로
 * 검색 API(searchOfficialServices)를 불렀을 때와 같다. 광역 묶음은 광역시·도 전체를,
 * 시·군·구 묶음은 주어진 시·군·구만 읽는다.
 */
export async function searchRegionTargets(
  scope: "sido" | "sigungu",
  targets: readonly RegionTarget[],
  category: string,
  requestedPageSize: number,
): Promise<OfficialSearchResult[]> {
  const run = await latestRun();
  const pageSize = normalizeSearchPageSize(requestedPageSize);
  if (!run || targets.length === 0) return targets.map(() => emptySearchResult(pageSize));

  const categoryFilter = category ? " AND category = ?" : "";
  const categoryValues = category ? [category] : [];
  const regionFilter = scope === "sigungu" ? REGION_PAIR_FILTER : "";
  const regionValues = scope === "sigungu" ? [JSON.stringify(rawRegionPairs(targets))] : [];
  const partition = scope === "sigungu" ? TARGET_SIDO_SQL + ", sigungu" : TARGET_SIDO_SQL;
  const within = scope === "sigungu" ? "name, id" : "sigungu, name, id";

  const [records, groups, nationwide, edits] = await Promise.all([
    bindAll<Record<string, unknown>>(
      `SELECT * FROM (
         SELECT ${SELECT_COLUMNS}, ${TARGET_SIDO_SQL} AS targetSido,
           ROW_NUMBER() OVER (PARTITION BY ${partition} ORDER BY ${within}) AS rowNumber
         FROM ${SOURCE_ROWS_SQL}
         WHERE sync_run_id = ?${categoryFilter}${regionFilter}
       ) WHERE targetSido IS NOT NULL AND rowNumber <= ?
       ORDER BY targetSido, sigungu, rowNumber`,
      [run.id, ...categoryValues, ...regionValues, pageSize],
    ),
    bindAll<GroupRow>(
      scope === "sigungu"
        ? `SELECT sido, sigungu, category, type, COUNT(*) AS count FROM ${SOURCE_ROWS_SQL}
           WHERE sync_run_id = ?${regionFilter} GROUP BY sido, sigungu, category, type`
        : `SELECT sido, category, type, COUNT(*) AS count FROM ${SOURCE_ROWS_SQL} WHERE sync_run_id = ? GROUP BY sido, category, type`,
      [run.id, ...regionValues],
    ),
    scope === "sigungu"
      ? bindAll<{ readonly sido: string | null; readonly count: number }>(
          `SELECT sido, COUNT(*) AS count FROM ${SOURCE_ROWS_SQL} WHERE sync_run_id = ?${categoryFilter} GROUP BY sido`,
          [run.id, ...categoryValues],
        )
      : Promise.resolve(null),
    cachedWikiEdits(),
  ]);

  const regionKey = (sido: string, sigungu: string) => (scope === "sigungu" ? sido + "\u0000" + sigungu : sido);
  const rowsByRegion = new Map<string, Record<string, unknown>[]>();
  for (const record of records) {
    const key = regionKey(String(record.targetSido ?? ""), String(record.sigungu ?? ""));
    const list = rowsByRegion.get(key);
    if (list) list.push(record);
    else rowsByRegion.set(key, [record]);
  }

  const nationwideCounts = new Map<string, number>();
  if (nationwide) {
    for (const row of nationwide) addCount(nationwideCounts, canonicalSido(row.sido ?? ""), row.count);
  } else {
    for (const row of groups) {
      if (!category || (row.category ?? "") === category) addCount(nationwideCounts, canonicalSido(row.sido ?? ""), row.count);
    }
  }
  const regionCounts = countsByValue(nationwideCounts);
  const completedAt = iso(run.completedAt);

  return targets.map((target) => {
    const inRegion = groups.filter(
      (row) =>
        sidoMatches(target.sido, row.sido ?? "") &&
        (scope === "sido" || (row.sigungu ?? "") === target.sigungu),
    );
    const categoryCounts = new Map<string, number>();
    const regionCategories = new Map<string, number>();
    const regionTypes = new Map<string, number>();
    let totalCount = 0;
    let rowCount = 0;
    for (const row of inRegion) {
      const rowCategory = row.category ?? "";
      addCount(regionCategories, rowCategory, row.count);
      addCount(regionTypes, row.type ?? "", row.count);
      rowCount += row.count;
      if (!category || rowCategory === category) {
        addCount(categoryCounts, rowCategory, row.count);
        totalCount += row.count;
      }
    }
    return {
      rows: normalizeServiceRows(rowsByRegion.get(regionKey(target.sido, target.sigungu)) ?? [], edits, 0),
      totalCount,
      page: 1,
      pageSize,
      pageCount: Math.max(1, Math.ceil(totalCount / pageSize)),
      regionCounts,
      categoryCounts: countsByDescending(categoryCounts),
      regionSummary: {
        rowCount,
        categoryCounts: countsByDescending(regionCategories),
        typeCounts: countsByDescending(regionTypes),
      },
      dataAsOf: run.dataAsOf,
      completedAt,
      documentCount: run.documentCount,
    };
  });
}
