import { getD1 } from "./d1";
import {
  type FilterState,
  type ServiceRow,
  collapse,
} from "./dataset";
import {
  type DatasetSummary,
  normalizeSearchPageSize,
  orderServiceCategories,
} from "./dataset-summary";
import { repairKnownExtractionFragments } from "./official-correction";
import { SEARCH_TEXT_LOOKUP } from "./official-search-text";
import { repairExtractionSpacing } from "./official-spacing";
import { cachedWikiEdits } from "./wiki-edit-store";
import type { RegionTarget } from "./region-load-order";
import { applyWikiEdits, type WikiEditValues } from "./wiki-edits";

const INTEGRATED_PROVINCE_NAME = "전남광주통합특별시";
const INTEGRATED_PROVINCE_ALIASES = ["광주광역시", "전라남도"] as const;
const CANONICAL_SIDO_SQL =
  "CASE WHEN sido IN ('광주광역시', '전라남도') THEN '전남광주통합특별시' ELSE sido END";

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
     WHERE status = 'succeeded'
     ORDER BY completed_at DESC
     LIMIT 1`,
  ).first<LatestRun>();
  return run ?? null;
}

let latestRunMemo: { readonly promise: Promise<LatestRun | null>; readonly expiresAt: number } | null = null;

/** 가장 최근에 성공한 수집. 30초 동안 기억해 두고, fresh면 새로 읽는다(수집 직후 미리 계산용). */
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
  const keyword = collapse(filters.keyword);
  if (keyword) {
    parts.push(`INSTR(${SEARCH_TEXT_LOOKUP}, ?) > 0`);
    values.push(keyword);
  }
  return { sql: parts.join(" AND "), values };
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
    searchIndex: collapse([
      row.sido,
      row.sigungu,
      row.category,
      row.subcategory,
      row.name,
      row.description,
      row.target,
      row.detailTarget,
      row.applicationMethod ?? "",
      row.provider,
      row.type,
    ].join(" ")),
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
        COUNT(DISTINCT ${CANONICAL_SIDO_SQL} || '|' || sigungu) AS sigunguCount,
        COUNT(DISTINCT category) AS categoryCount
       FROM official_service_snapshot WHERE sync_run_id = ?`,
    ).bind(run.id).first<{
      totalCount: number;
      sidoCount: number;
      sigunguCount: number;
      categoryCount: number;
    }>(),
    bindAll<CountRow>(
      `SELECT ${CANONICAL_SIDO_SQL} AS value, COUNT(*) AS count
       FROM official_service_snapshot WHERE sync_run_id = ? GROUP BY value ORDER BY value`,
      [run.id],
    ),
    bindAll<CountRow>(
      `SELECT category AS value, COUNT(*) AS count
       FROM official_service_snapshot WHERE sync_run_id = ? GROUP BY category ORDER BY value`,
      [run.id],
    ),
    bindAll<{ sido: string; sigungu: string }>(
      `SELECT ${CANONICAL_SIDO_SQL} AS sido, sigungu
       FROM official_service_snapshot
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
    `SELECT COUNT(*) AS count FROM official_service_snapshot WHERE ${where.sql}`,
  ).bind(...withRun(where, run.id)).first<TotalRow>();
  const totalCount = total?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const offset = (page - 1) * pageSize;
  const [records, regionCounts, categoryCounts, regionCategories, regionTypes, edits] = await Promise.all([
    bindAll<Record<string, unknown>>(
      `SELECT ${SELECT_COLUMNS} FROM official_service_snapshot
       WHERE ${where.sql}
       ORDER BY sido, sigungu, name, id LIMIT ? OFFSET ?`,
      [...withRun(where, run.id), pageSize, offset],
    ),
    bindAll<CountRow>(
      `SELECT ${CANONICAL_SIDO_SQL} AS value, COUNT(*) AS count
       FROM official_service_snapshot WHERE ${nationwideWhere.sql}
       GROUP BY value ORDER BY value`,
      withRun(nationwideWhere, run.id),
    ),
    bindAll<CountRow>(
      `SELECT category AS value, COUNT(*) AS count
       FROM official_service_snapshot WHERE ${where.sql}
       GROUP BY category ORDER BY count DESC, value`,
      withRun(where, run.id),
    ),
    bindAll<CountRow>(
      `SELECT category AS value, COUNT(*) AS count
       FROM official_service_snapshot WHERE ${regionWhere.sql}
       GROUP BY category ORDER BY count DESC, value`,
      withRun(regionWhere, run.id),
    ),
    bindAll<CountRow>(
      `SELECT type AS value, COUNT(*) AS count
       FROM official_service_snapshot WHERE ${regionWhere.sql}
      GROUP BY type ORDER BY count DESC, value`,
      withRun(regionWhere, run.id),
    ),
    cachedWikiEdits(),
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
  };
}

export async function exportOfficialServices(filters: FilterState): Promise<ServiceRow[]> {
  const run = await latestRun();
  if (!run) return [];
  const where = searchWhere(filters);
  const [records, edits] = await Promise.all([
    bindAll<Record<string, unknown>>(
      `SELECT ${SELECT_COLUMNS} FROM official_service_snapshot
       WHERE ${where.sql} ORDER BY sido, sigungu, name, id`,
      withRun(where, run.id),
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
         FROM official_service_snapshot
         WHERE sync_run_id = ?${categoryFilter}${regionFilter}
       ) WHERE targetSido IS NOT NULL AND rowNumber <= ?
       ORDER BY targetSido, sigungu, rowNumber`,
      [run.id, ...categoryValues, ...regionValues, pageSize],
    ),
    bindAll<GroupRow>(
      scope === "sigungu"
        ? `SELECT sido, sigungu, category, type, COUNT(*) AS count FROM official_service_snapshot
           WHERE sync_run_id = ?${regionFilter} GROUP BY sido, sigungu, category, type`
        : "SELECT sido, category, type, COUNT(*) AS count FROM official_service_snapshot WHERE sync_run_id = ? GROUP BY sido, category, type",
      [run.id, ...regionValues],
    ),
    scope === "sigungu"
      ? bindAll<{ readonly sido: string | null; readonly count: number }>(
          `SELECT sido, COUNT(*) AS count FROM official_service_snapshot WHERE sync_run_id = ?${categoryFilter} GROUP BY sido`,
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
