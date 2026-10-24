// 관리자 「이용자 통계」 집계 조회. 화면과 CSV가 같은 함수를 쓴다(합계·분모·기간이 같다).
// 개인별 이벤트·임시 ID·원시 요청은 조회하지 않는다(애초에 저장하지 않는다).
import { getD1 } from "../d1";
import { buildVisitsReport } from "./visits.ts";
import {
  ACTION_CODES,
  CLICK_ACTIONS,
  AGGREGATE_RETENTION_DAYS,
  DURATION_EDGES_MS,
  ENTITY_KINDS,
  MS_BUCKET_EDGES,
  CLS_BUCKET_EDGES,
  SEARCH_SCOPES,
  TAB_CODES,
  dayDiff,
  kstDay,
  shiftDay,
  type ActionCode,
  type EntityKind,
  type PerfMetric,
} from "./codes";
import type {
  ActionRow,
  DailyPoint,
  DayState,
  EntityReport,
  EntityRow,
  EntitySort,
  EntityTrendPoint,
  OverviewReport,
  OverviewTotals,
  QualityReport,
  ReportMeta,
  ReportView,
  SearchReport,
  SearchTotals,
  TabsReport,
} from "./report-types";
import { readUsageOperationStatus, type CollectionPeriod } from "./settings";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KST_OFFSET_MS = 9 * 3600_000;
const ENTITY_PAGE_SIZE = 20;
const SORT_COLUMNS: Record<EntitySort, string> = {
  views: "views",
  searchMatches: "searchMatches",
  searchOpens: "searchOpens",
  activeMs: "activeMs",
};

export interface ReportQuery {
  readonly view: ReportView;
  readonly from: string;
  readonly to: string;
  readonly q: string;
  readonly sort: EntitySort;
  readonly page: number;
  readonly entity: number | null;
}

export class ReportQueryError extends Error {}

/** 기간·보기 검증. 기본은 오늘까지 최근 30일이고, 최대 24개월까지 조회한다. */
export function parseReportQuery(params: URLSearchParams, now = Date.now()): ReportQuery {
  const today = kstDay(now);
  const view = params.get("view") ?? "overview";
  if (!["overview", "visits", "care", "welfare", "search", "tabs", "quality"].includes(view)) throw new ReportQueryError("보기 이름이 올바르지 않습니다.");
  const to = params.get("to") ?? today;
  const from = params.get("from") ?? shiftDay(to, -29);
  if (!DAY_PATTERN.test(from) || !DAY_PATTERN.test(to)) throw new ReportQueryError("날짜 형식이 올바르지 않습니다.");
  if (from > to) throw new ReportQueryError("시작일이 종료일보다 늦습니다.");
  if (to > today) throw new ReportQueryError("오늘 이후 날짜는 조회할 수 없습니다.");
  if (dayDiff(from, to) >= AGGREGATE_RETENTION_DAYS) throw new ReportQueryError("한 번에 24개월까지 조회할 수 있습니다.");
  const sortParam = params.get("sort") ?? "views";
  const sort = (Object.keys(SORT_COLUMNS) as EntitySort[]).includes(sortParam as EntitySort) ? (sortParam as EntitySort) : "views";
  const page = Math.max(1, Math.min(10_000, Number.parseInt(params.get("page") ?? "1", 10) || 1));
  const entityParam = Number.parseInt(params.get("entity") ?? "", 10);
  return {
    view: view as ReportView,
    from,
    to,
    q: (params.get("q") ?? "").trim().slice(0, 60),
    sort,
    page,
    entity: Number.isInteger(entityParam) && entityParam > 0 ? entityParam : null,
  };
}

async function all<T>(sql: string, ...values: unknown[]): Promise<T[]> {
  const result = await getD1().prepare(sql).bind(...values).all<T>();
  return result.results ?? [];
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) days.push(day);
  return days;
}

function dayStart(day: string): number {
  return Date.parse(day + "T00:00:00Z") - KST_OFFSET_MS;
}

export function dayStateOf(day: string, periods: readonly CollectionPeriod[], now: number): DayState {
  const start = dayStart(day);
  const end = Math.min(start + 86_400_000, now);
  const first = periods[0]?.startedAt;
  if (first === undefined || first >= end) return "before";
  let covered = 0;
  for (const period of periods) {
    const overlap = Math.min(end, period.endedAt ?? now) - Math.max(start, period.startedAt);
    if (overlap > 0) covered += overlap;
  }
  if (covered <= 0) return "off";
  return covered >= end - start - 1000 ? "on" : "partial";
}

async function buildMeta(query: ReportQuery, now: number): Promise<ReportMeta> {
  const status = await readUsageOperationStatus();
  const length = dayDiff(query.from, query.to) + 1;
  const prevTo = shiftDay(query.from, -1);
  const prevFrom = shiftDay(prevTo, -(length - 1));
  const dayStates: Record<string, DayState> = {};
  for (const day of daysBetween(query.from, query.to)) dayStates[day] = dayStateOf(day, status.periods, now);
  const prevCollected = daysBetween(prevFrom, prevTo).some((day) => dayStateOf(day, status.periods, now) !== "before");
  const today = kstDay(now);
  return {
    from: query.from,
    to: query.to,
    prevFrom,
    prevTo,
    today,
    includesToday: query.to === today,
    generatedAt: now,
    lastIngestAt: status.lastIngestAt,
    enabled: status.enabled,
    killSwitch: status.killSwitch,
    dayStates,
    prevCollected,
  };
}

// ---- 공통 조회 ----

async function overviewTotals(from: string, to: string): Promise<OverviewTotals> {
  const [row] = await all<Record<string, unknown>>(
    "SELECT " +
      "(SELECT COALESCE(SUM(views), 0) FROM usage_daily_page WHERE day BETWEEN ?1 AND ?2) AS pageViews, " +
      "(SELECT COALESCE(SUM(d.views), 0) FROM usage_daily_entity d JOIN usage_entity e ON e.id = d.entity_id WHERE e.kind = 'care_program' AND d.day BETWEEN ?1 AND ?2) AS careViews, " +
      "(SELECT COALESCE(SUM(d.views), 0) FROM usage_daily_entity d JOIN usage_entity e ON e.id = d.entity_id WHERE e.kind = 'welfare_policy' AND d.day BETWEEN ?1 AND ?2) AS welfareViews, " +
      "(SELECT COALESCE(SUM(searches), 0) FROM usage_daily_search WHERE day BETWEEN ?1 AND ?2) AS searches, " +
      "(SELECT COALESCE(SUM(searches), 0) FROM usage_daily_search WHERE day BETWEEN ?1 AND ?2 AND status = 'ok') AS searchOk, " +
      "(SELECT COALESCE(SUM(searches), 0) FROM usage_daily_search WHERE day BETWEEN ?1 AND ?2 AND status = 'ok' AND results = '0') AS zeroResults, " +
      "(SELECT COALESCE(SUM(active_ms), 0) FROM usage_daily_tab WHERE day BETWEEN ?1 AND ?2) AS activeMs",
    from,
    to,
  );
  return {
    pageViews: num(row?.pageViews),
    careViews: num(row?.careViews),
    welfareViews: num(row?.welfareViews),
    searches: num(row?.searches),
    searchOk: num(row?.searchOk),
    zeroResults: num(row?.zeroResults),
    activeMs: num(row?.activeMs),
  };
}

async function dailySeries(from: string, to: string): Promise<DailyPoint[]> {
  const [pages, entities, searches, tabs] = await Promise.all([
    all<{ day: string; n: number }>("SELECT day, SUM(views) AS n FROM usage_daily_page WHERE day BETWEEN ? AND ? GROUP BY day", from, to),
    all<{ day: string; kind: string; n: number }>(
      "SELECT d.day AS day, e.kind AS kind, SUM(d.views) AS n FROM usage_daily_entity d JOIN usage_entity e ON e.id = d.entity_id WHERE d.day BETWEEN ? AND ? GROUP BY d.day, e.kind",
      from,
      to,
    ),
    all<{ day: string; n: number }>("SELECT day, SUM(searches) AS n FROM usage_daily_search WHERE day BETWEEN ? AND ? GROUP BY day", from, to),
    all<{ day: string; n: number }>("SELECT day, SUM(active_ms) AS n FROM usage_daily_tab WHERE day BETWEEN ? AND ? GROUP BY day", from, to),
  ]);
  const byDay = (rows: { day: string; n: number }[]) => new Map(rows.map((row) => [row.day, num(row.n)]));
  const pageMap = byDay(pages);
  const searchMap = byDay(searches);
  const tabMap = byDay(tabs);
  const care = byDay(entities.filter((row) => row.kind === "care_program"));
  const welfare = byDay(entities.filter((row) => row.kind === "welfare_policy"));
  return daysBetween(from, to).map((day) => ({
    day,
    pageViews: pageMap.get(day) ?? 0,
    careViews: care.get(day) ?? 0,
    welfareViews: welfare.get(day) ?? 0,
    searches: searchMap.get(day) ?? 0,
    activeMs: tabMap.get(day) ?? 0,
  }));
}

const ENTITY_SELECT =
  "SELECT e.id AS id, e.kind AS kind, e.name AS name, e.sido AS sido, e.sigungu AS sigungu, e.category AS category, e.status AS status, " +
  "SUM(d.views) AS views, SUM(d.search_matches) AS searchMatches, SUM(d.search_opens) AS searchOpens, " +
  "SUM(d.active_ms) AS activeMs, SUM(d.active_views) AS activeViews " +
  "FROM usage_daily_entity d JOIN usage_entity e ON e.id = d.entity_id ";

function toEntityRow(row: Record<string, unknown>, prevViews = 0): EntityRow {
  return {
    id: num(row.id),
    kind: (ENTITY_KINDS as readonly string[]).includes(String(row.kind)) ? (row.kind as EntityKind) : "care_program",
    name: String(row.name ?? ""),
    sido: String(row.sido ?? ""),
    sigungu: String(row.sigungu ?? ""),
    category: String(row.category ?? ""),
    status: row.status === "inactive" ? "inactive" : "active",
    views: num(row.views),
    searchMatches: num(row.searchMatches),
    searchOpens: num(row.searchOpens),
    activeMs: num(row.activeMs),
    activeViews: num(row.activeViews),
    prevViews,
  };
}

async function prevViewsOf(ids: readonly number[], from: string, to: string): Promise<Map<number, number>> {
  if (ids.length === 0) return new Map();
  const rows = await all<{ id: number; n: number }>(
    "SELECT entity_id AS id, SUM(views) AS n FROM usage_daily_entity WHERE day BETWEEN ? AND ? AND entity_id IN (SELECT value FROM json_each(?)) GROUP BY entity_id",
    from,
    to,
    JSON.stringify(ids),
  );
  return new Map(rows.map((row) => [num(row.id), num(row.n)]));
}

async function topEntities(kind: EntityKind | null, column: EntitySort, meta: ReportMeta, limit: number): Promise<EntityRow[]> {
  const where = kind ? "WHERE e.kind = ? AND d.day BETWEEN ? AND ? " : "WHERE d.day BETWEEN ? AND ? ";
  const values = kind ? [kind, meta.from, meta.to] : [meta.from, meta.to];
  const rows = await all<Record<string, unknown>>(
    ENTITY_SELECT + where + "GROUP BY e.id HAVING " + SORT_COLUMNS[column] + " > 0 ORDER BY " + SORT_COLUMNS[column] + " DESC, e.name LIMIT ?",
    ...values,
    limit,
  );
  const prev = await prevViewsOf(rows.map((row) => num(row.id)), meta.prevFrom, meta.prevTo);
  return rows.map((row) => toEntityRow(row, prev.get(num(row.id)) ?? 0));
}

async function actionRows(from: string, to: string): Promise<ActionRow[]> {
  const rows = await all<{ action: string; outcome: string; n: number; msSum: number; msCount: number }>(
    "SELECT action, outcome, SUM(count) AS n, SUM(ms_sum) AS msSum, SUM(ms_count) AS msCount FROM usage_daily_action WHERE day BETWEEN ? AND ? GROUP BY action, outcome",
    from,
    to,
  );
  return ACTION_CODES.map((action) => {
    const of = (outcome: string) => rows.find((row) => row.action === action && row.outcome === outcome);
    const done = rows.filter((row) => row.action === action && (row.outcome === "success" || row.outcome === "failure"));
    return {
      action: action as ActionCode,
      start: num(of("start")?.n),
      success: num(of("success")?.n),
      failure: num(of("failure")?.n),
      cancel: num(of("cancel")?.n),
      click: num(of("click")?.n),
      msSum: done.reduce((sum, row) => sum + num(row.msSum), 0),
      msCount: done.reduce((sum, row) => sum + num(row.msCount), 0),
    };
  });
}

async function durationBuckets(scope: string, from: string, to: string): Promise<number[]> {
  const rows = await all<{ bucket: number; n: number }>(
    "SELECT bucket, SUM(measures) AS n FROM usage_daily_duration WHERE scope = ? AND day BETWEEN ? AND ? GROUP BY bucket",
    scope,
    from,
    to,
  );
  return Array.from({ length: DURATION_EDGES_MS.length + 1 }, (_, bucket) => num(rows.find((row) => num(row.bucket) === bucket)?.n));
}

// ---- 보기별 ----

async function overviewReport(query: ReportQuery, meta: ReportMeta): Promise<OverviewReport> {
  const [current, previous, series, tabs, topCare, topWelfare, actions] = await Promise.all([
    overviewTotals(meta.from, meta.to),
    overviewTotals(meta.prevFrom, meta.prevTo),
    dailySeries(meta.from, meta.to),
    all<{ tab: string; views: number; activeMs: number }>(
      "SELECT tab, SUM(initial_views + selected_views) AS views, SUM(active_ms) AS activeMs FROM usage_daily_tab WHERE day BETWEEN ? AND ? GROUP BY tab ORDER BY views DESC",
      meta.from,
      meta.to,
    ),
    topEntities("care_program", "views", meta, 10),
    topEntities("welfare_policy", "views", meta, 10),
    actionRows(meta.from, meta.to),
  ]);
  void query;
  return {
    view: "overview",
    meta,
    current,
    previous,
    series,
    tabs: tabs
      .filter((row) => (TAB_CODES as readonly string[]).includes(row.tab))
      .map((row) => ({ tab: row.tab as (typeof TAB_CODES)[number], views: num(row.views), activeMs: num(row.activeMs) })),
    topCare,
    topWelfare,
    actions,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => "\\" + char);
}

async function entityReport(query: ReportQuery, meta: ReportMeta, kind: EntityKind, pageSize = ENTITY_PAGE_SIZE): Promise<EntityReport> {
  const nameFilter = query.q ? "AND e.name LIKE ? ESCAPE '\\' " : "";
  const values: unknown[] = [kind, meta.from, meta.to, ...(query.q ? ["%" + escapeLike(query.q) + "%"] : [])];
  const base = ENTITY_SELECT + "WHERE e.kind = ? AND d.day BETWEEN ? AND ? " + nameFilter + "GROUP BY e.id ";
  const [countRow] = await all<{ n: number }>("SELECT COUNT(*) AS n FROM (" + base + ")", ...values);
  const total = num(countRow?.n);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(query.page, pages);
  const rows = await all<Record<string, unknown>>(
    base + "ORDER BY " + SORT_COLUMNS[query.sort] + " DESC, views DESC, e.name LIMIT ? OFFSET ?",
    ...values,
    pageSize,
    (page - 1) * pageSize,
  );
  const [prev, totalsRows, durations, routes] = await Promise.all([
    prevViewsOf(rows.map((row) => num(row.id)), meta.prevFrom, meta.prevTo),
    all<Record<string, unknown>>(
      "SELECT SUM(d.views) AS views, SUM(d.search_matches) AS searchMatches, SUM(d.search_opens) AS searchOpens, SUM(d.active_ms) AS activeMs, SUM(d.active_views) AS activeViews " +
        "FROM usage_daily_entity d JOIN usage_entity e ON e.id = d.entity_id WHERE e.kind = ? AND d.day BETWEEN ? AND ?",
      kind,
      meta.from,
      meta.to,
    ),
    durationBuckets("entity:" + kind, meta.from, meta.to),
    all<{ route: string; views: number }>(
      "SELECT route, SUM(views) AS views FROM usage_daily_route WHERE kind = ? AND day BETWEEN ? AND ? GROUP BY route ORDER BY views DESC",
      kind,
      meta.from,
      meta.to,
    ),
  ]);
  const totals = totalsRows[0] ?? {};
  let trend: EntityReport["trend"] = null;
  if (query.entity !== null) {
    const [entityRow] = await all<Record<string, unknown>>(
      ENTITY_SELECT.replace("FROM usage_daily_entity d JOIN usage_entity e ON e.id = d.entity_id ", "FROM usage_entity e LEFT JOIN usage_daily_entity d ON d.entity_id = e.id AND d.day BETWEEN ? AND ? ") +
        "WHERE e.id = ? AND e.kind = ? GROUP BY e.id",
      meta.from,
      meta.to,
      query.entity,
      kind,
    );
    if (entityRow) {
      const points = await all<Record<string, unknown>>(
        "SELECT day, views, search_matches AS searchMatches, search_opens AS searchOpens, active_ms AS activeMs FROM usage_daily_entity WHERE entity_id = ? AND day BETWEEN ? AND ?",
        query.entity,
        meta.from,
        meta.to,
      );
      const byDay = new Map(points.map((point) => [String(point.day), point]));
      const series: EntityTrendPoint[] = daysBetween(meta.from, meta.to).map((day) => {
        const point = byDay.get(day);
        return {
          day,
          views: num(point?.views),
          searchMatches: num(point?.searchMatches),
          searchOpens: num(point?.searchOpens),
          activeMs: num(point?.activeMs),
        };
      });
      const prevTrend = await prevViewsOf([query.entity], meta.prevFrom, meta.prevTo);
      trend = { entity: toEntityRow(entityRow, prevTrend.get(query.entity) ?? 0), series };
    }
  }
  return {
    view: kind === "care_program" ? "care" : "welfare",
    meta,
    kind,
    rows: rows.map((row) => toEntityRow(row, prev.get(num(row.id)) ?? 0)),
    total,
    page,
    pageSize,
    sort: query.sort,
    q: query.q,
    totals: {
      views: num(totals.views),
      searchMatches: num(totals.searchMatches),
      searchOpens: num(totals.searchOpens),
      activeMs: num(totals.activeMs),
      activeViews: num(totals.activeViews),
    },
    durations,
    routes: routes.map((row) => ({ route: row.route as EntityReport["routes"][number]["route"], views: num(row.views) })),
    trend,
  };
}

function searchTotalsOf(rows: readonly Record<string, unknown>[]): SearchTotals {
  const sum = (pick: (row: Record<string, unknown>) => boolean, column = "searches") =>
    rows.filter(pick).reduce((total, row) => total + num(row[column]), 0);
  return {
    searches: sum(() => true),
    ok: sum((row) => row.status === "ok"),
    errors: sum((row) => row.status === "error"),
    zero: sum((row) => row.status === "ok" && row.results === "0"),
    converted: sum((row) => row.status === "ok", "converted"),
    matched: sum((row) => row.status === "ok" && row.match === "matched"),
    ambiguous: sum((row) => row.status === "ok" && row.match === "ambiguous"),
    unmatched: sum((row) => row.status === "ok" && row.match === "unmatched"),
  };
}

async function searchReport(meta: ReportMeta): Promise<SearchReport> {
  const grouped = (from: string, to: string) =>
    all<Record<string, unknown>>(
      "SELECT scope, status, results, match, SUM(searches) AS searches, SUM(converted) AS converted FROM usage_daily_search WHERE day BETWEEN ? AND ? GROUP BY scope, status, results, match",
      from,
      to,
    );
  const [current, previous, topMatched, topOpened, filters] = await Promise.all([
    grouped(meta.from, meta.to),
    grouped(meta.prevFrom, meta.prevTo),
    topEntities(null, "searchMatches", meta, 15),
    topEntities(null, "searchOpens", meta, 15),
    all<{ filter: string; code: string; uses: number }>(
      "SELECT filter, code, SUM(uses) AS uses FROM usage_daily_filter WHERE day BETWEEN ? AND ? GROUP BY filter, code ORDER BY uses DESC, code",
      meta.from,
      meta.to,
    ),
  ]);
  const resultOrder = ["0", "1", "2-10", "11-50", "51-200", "201+"];
  return {
    view: "search",
    meta,
    current: searchTotalsOf(current),
    previous: searchTotalsOf(previous),
    byScope: SEARCH_SCOPES.map((scope) => ({ scope, ...searchTotalsOf(current.filter((row) => row.scope === scope)) })),
    byResults: resultOrder.map((results) => ({
      results,
      searches: current.filter((row) => row.status === "ok" && row.results === results).reduce((sum, row) => sum + num(row.searches), 0),
    })),
    topMatched,
    topOpened,
    filters: filters.map((row) => ({ filter: row.filter as SearchReport["filters"][number]["filter"], code: row.code, uses: num(row.uses) })),
  };
}

async function tabsReport(meta: ReportMeta): Promise<TabsReport> {
  const [tabs, prevTabs, pages, actions, sources] = await Promise.all([
    all<Record<string, unknown>>(
      "SELECT tab, SUM(initial_views) AS initialViews, SUM(selected_views) AS selectedViews, SUM(active_ms) AS activeMs, SUM(measures) AS measures FROM usage_daily_tab WHERE day BETWEEN ? AND ? GROUP BY tab",
      meta.from,
      meta.to,
    ),
    all<{ tab: string; n: number }>(
      "SELECT tab, SUM(initial_views + selected_views) AS n FROM usage_daily_tab WHERE day BETWEEN ? AND ? GROUP BY tab",
      meta.prevFrom,
      meta.prevTo,
    ),
    all<{ page: string; views: number }>("SELECT page, SUM(views) AS views FROM usage_daily_page WHERE day BETWEEN ? AND ? GROUP BY page ORDER BY views DESC", meta.from, meta.to),
    actionRows(meta.from, meta.to),
    all<{ dest: string; clicks: number }>(
      "SELECT dest, SUM(count) AS clicks FROM usage_daily_action WHERE action = 'source_link' AND day BETWEEN ? AND ? GROUP BY dest ORDER BY clicks DESC",
      meta.from,
      meta.to,
    ),
  ]);
  const durations: Record<string, number[]> = {};
  await Promise.all(
    TAB_CODES.map(async (tab) => {
      durations[tab] = await durationBuckets("tab:" + tab, meta.from, meta.to);
    }),
  );
  return {
    view: "tabs",
    meta,
    tabs: TAB_CODES.map((tab) => {
      const row = tabs.find((item) => item.tab === tab) ?? {};
      return {
        tab,
        initialViews: num(row.initialViews),
        selectedViews: num(row.selectedViews),
        activeMs: num(row.activeMs),
        measures: num(row.measures),
        prevViews: num(prevTabs.find((item) => item.tab === tab)?.n),
      };
    }),
    durations,
    pages: pages.map((row) => ({ page: row.page as TabsReport["pages"][number]["page"], views: num(row.views) })),
    actions,
    sources: sources.map((row) => ({ dest: row.dest as TabsReport["sources"][number]["dest"], clicks: num(row.clicks) })),
  };
}

async function qualityReport(meta: ReportMeta): Promise<QualityReport> {
  const [actions, searches, errors, perf, screens, status] = await Promise.all([
    actionRows(meta.from, meta.to),
    all<{ scope: string; status: string; n: number }>(
      "SELECT scope, status, SUM(searches) AS n FROM usage_daily_search WHERE day BETWEEN ? AND ? GROUP BY scope, status",
      meta.from,
      meta.to,
    ),
    all<{ op: string; code: string; n: number }>(
      "SELECT op, code, SUM(count) AS n FROM usage_daily_error WHERE day BETWEEN ? AND ? GROUP BY op, code ORDER BY n DESC",
      meta.from,
      meta.to,
    ),
    all<{ metric: string; page: string; bucket: number; n: number; total: number }>(
      "SELECT metric, page, bucket, SUM(count) AS n, SUM(value_sum) AS total FROM usage_daily_perf WHERE day BETWEEN ? AND ? GROUP BY metric, page, bucket",
      meta.from,
      meta.to,
    ),
    all<{ screen: string; views: number }>("SELECT screen, SUM(views) AS views FROM usage_daily_screen WHERE day BETWEEN ? AND ? GROUP BY screen", meta.from, meta.to),
    readUsageOperationStatus(),
  ]);
  const perfKeys = [...new Set(perf.map((row) => row.metric + "|" + row.page))];
  return {
    view: "quality",
    meta,
    actions: actions.filter((row) => !CLICK_ACTIONS.includes(row.action)),
    searches: SEARCH_SCOPES.map((scope) => ({
      scope,
      ok: num(searches.find((row) => row.scope === scope && row.status === "ok")?.n),
      errors: num(searches.find((row) => row.scope === scope && row.status === "error")?.n),
    })),
    errors: errors.map((row) => ({ op: row.op, code: row.code as QualityReport["errors"][number]["code"], count: num(row.n) })),
    perf: perfKeys
      .map((key) => {
        const [metric, page] = key.split("|");
        const rows = perf.filter((row) => row.metric === metric && row.page === page);
        const edges = metric === "cls" ? CLS_BUCKET_EDGES : MS_BUCKET_EDGES;
        return {
          metric: metric as PerfMetric,
          page: page as QualityReport["perf"][number]["page"],
          count: rows.reduce((sum, row) => sum + num(row.n), 0),
          sum: rows.reduce((sum, row) => sum + num(row.total), 0),
          buckets: Array.from({ length: edges.length + 1 }, (_, bucket) => num(rows.find((row) => num(row.bucket) === bucket)?.n)),
        };
      })
      .sort((left, right) => left.metric.localeCompare(right.metric) || left.page.localeCompare(right.page)),
    screens: screens.map((row) => ({ screen: row.screen as QualityReport["screens"][number]["screen"], views: num(row.views) })),
    operation: { periods: status.periods, cleanup: status.cleanup, tempRows: status.tempRows },
  };
}

export async function buildUsageReport(query: ReportQuery, now = Date.now(), entityPageSize?: number) {
  const meta = await buildMeta(query, now);
  switch (query.view) {
    case "overview":
      return overviewReport(query, meta);
    case "visits":
      return buildVisitsReport(getD1(), meta);
    case "care":
      return entityReport(query, meta, "care_program", entityPageSize);
    case "welfare":
      return entityReport(query, meta, "welfare_policy", entityPageSize);
    case "search":
      return searchReport(meta);
    case "tabs":
      return tabsReport(meta);
    case "quality":
      return qualityReport(meta);
  }
}

