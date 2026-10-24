import { reviewStatisticsSource } from "./source-review.ts";
import { totalPopulationDataset } from "./total-population.ts";
import type { SqlDatabase } from "../sql-database.ts";
import { STATISTICS_DATASETS, statisticsCatalog, statisticsStatus, verifiedStatistics } from "./catalog.ts";
import { filterStatistics, StatisticsError, type StatisticsReadOptions } from "./read.ts";
import type { StatisticsAutoRefresh, StatisticsResult } from "./types.ts";
import { statisticsConnection } from './connection.ts';
import { STATISTICS_HIGHLIGHT_IDS } from "./highlights.ts";

import { POPULATION_SCOPE, STATISTICS_REFRESH_POLICY } from "./policy.ts";
export { STATISTICS_DAY, STATISTICS_HOUR, POPULATION_SCOPE, STATISTICS_REFRESH_POLICY } from "./policy.ts";
export const STATISTICS_SCOPE_IDS = [POPULATION_SCOPE, ...STATISTICS_DATASETS.filter(d => !d.population && !d.official_report).map(d => d.id)] as const;

export interface StatisticsScopeRow {
  scope_id: string; result_json: string | null; previous_json: string | null; revision: string | null; latest_period: string | null;
  last_attempt_at: number | null; last_success_at: number | null; next_check_at: number;
  failure_count: number; error_code: string | null; stage_json: string | null; updated_at: number; error_detail?: string | null;
}
export interface StatisticsWorkerRow {
  id: number; lease_token: string | null; lease_expires_at: number | null;
  active_scope: string | null; last_wake_at: number | null; host_state_json: string;
}
interface StoredView { readonly rows: readonly StatisticsScopeRow[]; readonly worker: StatisticsWorkerRow | null; readonly available: boolean }
export function statisticsScopeFor(id: string): string { return id.startsWith("population:") ? POPULATION_SCOPE : id; }
function iso(value: number | null | undefined): string | null { return value && Number.isFinite(value) ? new Date(value).toISOString() : null; }

/** Only reads dedicated statistics tables. A missing binding/migration cannot hide the bundled official evidence. */
export async function readStatisticsView(db: SqlDatabase): Promise<StoredView> {
  try {
    const [rows, worker] = await Promise.all([
      db.prepare("SELECT * FROM statistics_refresh_scope").all<StatisticsScopeRow>(),
      db.prepare("SELECT * FROM statistics_refresh_worker WHERE id = 1").first<StatisticsWorkerRow>(),
    ]);
    return { rows: rows.results, worker, available: true };
  } catch { return { rows: [], worker: null, available: false }; }
}

export function publishedResults(row: StatisticsScopeRow | undefined): readonly StatisticsResult[] {
  if (!row?.result_json || row.result_json.length > 500_000) return [];
  try {
    const parsed: unknown = JSON.parse(row.result_json);
    const expectedIds = STATISTICS_DATASETS.filter(d => d.id !== "population:total" && statisticsScopeFor(d.id) === row.scope_id).map(d => d.id);
    if (!Array.isArray(parsed) || parsed.length !== expectedIds.length) return [];
    if (new Set(parsed.map(value => value?.dataset?.id)).size !== expectedIds.length) return [];
    for (const value of parsed) {
      if (!expectedIds.includes(value?.dataset?.id) || value.revision !== row.revision || !value.checked_at
        || !Array.isArray(value.dataset.periods) || !value.dataset.periods.length || !Array.isArray(value.dataset.series)
        || value.dataset.periods.at(-1) !== row.latest_period) return [];
    }
    return parsed as StatisticsResult[];
  } catch { return []; }
}

function resultFromView(id: string, view: StoredView, now: number): StatisticsResult {
  if (id === "population:total") {
    const source = resultFromView("population:middle-aged", view, now);
    const dataset = totalPopulationDataset(source.dataset);
    return { ...source, dataset, warnings: [dataset.note, dataset.source_notes], coverage: {
      ...source.coverage, scope: "national_and_sido_total_resident_population",
    } };
  }
  const baseline = verifiedStatistics(id);
  if (!baseline) throw new StatisticsError("DATA_NOT_CONNECTED", "이 항목은 원문 안내만 제공합니다. 수치가 연결된 통계를 선택하세요.", 404);
  if (baseline.dataset.official_report) return baseline;
  const scope = statisticsScopeFor(baseline.dataset.id);
  const row = view.rows.find(item => item.scope_id === scope);
  const stored = publishedResults(row).find(item => item.dataset.id === baseline.dataset.id);
  const corrupt = Boolean(row?.result_json && !stored);
  const current = stored && stored.dataset.periods.at(-1)! >= baseline.dataset.periods.at(-1)! ? stored : baseline;
  const error = !view.available ? "STATISTICS_STORAGE_UNAVAILABLE" : corrupt ? "STATISTICS_STORAGE_INVALID" : row?.error_code ?? null;
  const checking = Boolean(view.worker?.lease_token && view.worker.active_scope === scope && (view.worker.lease_expires_at ?? 0) > now);
  const autoRefresh: StatisticsAutoRefresh = {
    enabled: true, interval_hours: 24, last_attempt_at: iso(row?.last_attempt_at),
    last_success_at: stored ? iso(row?.last_success_at) : null, next_check_at: iso(row?.next_check_at),
    status: !view.available || corrupt ? "unavailable" : checking ? "checking" : error ? "retry_wait" : row?.stage_json ? "idle" : stored ? "current" : "idle",
    error_code: error,
    check_due: view.available && !checking && (!row || row.next_check_at <= now),
    overdue_seconds: row?.next_check_at ? Math.max(0, Math.floor((now - row.next_check_at) / 1000)) : 0,
    failure_count: row?.failure_count ?? 0,
    continuation_pending: Boolean(row?.stage_json) && !checking,
  };
  return { ...current, state: error ? "SNAPSHOT_FALLBACK" : current === baseline ? "VERIFIED_SNAPSHOT" : "CACHED",
    refresh_error: error, auto_refresh: autoRefresh,
    warnings: [current.dataset.note, ...(current.dataset.population ? [current.dataset.source_notes] : []),
      ...(error ? ["자동 확인이 지연되어 마지막 정상 자료를 유지합니다. 자료 기준 시점과 원문 확인 시각은 다릅니다."] : [])],
    coverage: current.dataset.kosis ? { ...current.coverage, scope: "kosis_api_selected_tables", gaps: ["연결된 대표 통계표의 항목을 제공합니다. 전체 KOSIS 데이터베이스와 파일 통계는 포함하지 않습니다.", "최신 공표 시점을 API로 확인하며 원자료 단위·조사대상·결측 상태를 유지합니다."] } : current.dataset.population ? { scope: current.coverage.scope, complete: false,
      gaps: [`${current.dataset.population.reference_date} 기준 전국·${current.dataset.series.filter(s => s.region?.level === "sido").length}개 광역시·도를 제공합니다. 시·군·구 자료는 포함하지 않습니다.`, "현재 검증된 기준월을 제공합니다. 새 공표 자료는 세 원문을 함께 검증한 뒤 반영합니다."] } : current.coverage,
  };
}

export async function readCurrentStatistics(db: SqlDatabase, id: string, options: StatisticsReadOptions = {}, now = Date.now()): Promise<StatisticsResult> {
  const baseline = verifiedStatistics(id);
  if (!baseline) throw new StatisticsError("DATA_NOT_CONNECTED", "수치가 연결된 통계를 선택하세요.", 404);
  filterStatistics(baseline, options);
  if (options.mode === "verified") return filterStatistics({ ...baseline, auto_refresh: { enabled: false, interval_hours: 0, last_attempt_at: null, last_success_at: null, next_check_at: null, status: "idle", error_code: null } }, options);
  return filterStatistics(resultFromView(id, await readStatisticsView(db), now), options);
}
export async function readCurrentStatisticsSnapshots(db: SqlDatabase, now = Date.now(), selectedId?: string): Promise<StatisticsResult[]> {
  const view = await readStatisticsView(db);
  const selected = selectedId ? verifiedStatistics(selectedId)?.dataset.id : undefined;
  return STATISTICS_DATASETS.filter(dataset => !dataset.kosis || STATISTICS_HIGHLIGHT_IDS.has(dataset.id) || dataset.id === selected).map(dataset => reviewStatisticsSource(resultFromView(dataset.id, view, now)));
}
export async function currentStatisticsCatalog(db: SqlDatabase) {
  const view = await readStatisticsView(db);
  const results = new Map(STATISTICS_DATASETS.map(dataset => { const result = resultFromView(dataset.id, view, Date.now()); return [dataset.id, result] as const; }));
  const descriptions = new Map([...results].map(([id, result]) => [id, result.dataset.description]));
  return statisticsCatalog().map(item => ({ ...item, description: item.dataset_id && descriptions.get(item.dataset_id)
    ? (item.data_provider === "index" ? "지표누리 API · " : "") + descriptions.get(item.dataset_id) : item.description,
    connection: statisticsConnection(item, item.dataset_id ? results.get(item.dataset_id) ?? verifiedStatistics(item.dataset_id) ?? undefined : undefined) }));
}
export async function currentStatisticsStatus(db: SqlDatabase) {
  const view = await readStatisticsView(db);
  const results = STATISTICS_DATASETS.map(dataset => resultFromView(dataset.id, view, Date.now()));
  return { ...statisticsStatus(),
    datasets: results.map(result => ({ id: result.dataset.id, title: result.dataset.title, periods: result.dataset.periods,
      table_code: result.dataset.table_code, source_url: result.dataset.source_url,
      ...(result.dataset.population ? { population: result.dataset.population } : {}),
      revision: result.revision, checked_at: result.checked_at, refresh_mode: result.dataset.official_report ? "verified_snapshot" : "daily_background", auto_refresh: result.auto_refresh })),
    refresh_policy: STATISTICS_REFRESH_POLICY,
    automatic_refresh: { enabled: true, interval_hours: 24, scope_count: STATISTICS_SCOPE_IDS.length, table_count: results.filter(result => result.dataset.id !== "population:total" && !result.dataset.official_report).length,
      trigger: "website_requests_and_registered_pc_wake", storage_available: view.available,
      last_wake_at: iso(view.worker?.last_wake_at),
      successful_tables: results.filter(result => result.auto_refresh?.last_success_at).length,
      waiting_tables: results.filter(result => result.auto_refresh?.status === "idle" || result.auto_refresh?.status === "checking").length,
      retry_tables: results.filter(result => result.refresh_error).length,
      due_tables: results.filter(result => result.auto_refresh?.check_due).length,
      retry_scopes: view.rows.filter(row => row.error_code).map(row => ({ scope_id: row.scope_id,
        error_code: row.error_code, error_detail: row.error_detail ?? null, failure_count: row.failure_count, last_attempt_at: iso(row.last_attempt_at),
        last_success_at: iso(row.last_success_at), next_check_at: iso(row.next_check_at) })),
      no_requests_policy: "정기 접속 PC가 모두 꺼져 있고 웹 요청도 없으면 다음 접속 때 확인을 이어갑니다.",
    },
  };
}

export async function claimStatisticsWorker(db: SqlDatabase, now: number, token: string): Promise<StatisticsWorkerRow | null> {
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO statistics_refresh_worker (id) VALUES (1)"),
    ...STATISTICS_SCOPE_IDS.map(id => db.prepare("INSERT OR IGNORE INTO statistics_refresh_scope (scope_id, updated_at) VALUES (?, ?)").bind(id, now)),
  ]);
  return db.prepare("UPDATE statistics_refresh_worker SET lease_token = ?, lease_expires_at = ?, active_scope = NULL, last_wake_at = ? WHERE id = 1 AND (lease_token IS NULL OR lease_expires_at <= ?) RETURNING *")
    .bind(token, now + 27_000, now, now).first<StatisticsWorkerRow>();
}
export async function releaseStatisticsWorker(db: SqlDatabase, token: string): Promise<void> {
  await db.prepare("UPDATE statistics_refresh_worker SET lease_token = NULL, lease_expires_at = NULL, active_scope = NULL WHERE id = 1 AND lease_token = ?").bind(token).run();
}
export const STATISTICS_LEASE_GUARD = "EXISTS (SELECT 1 FROM statistics_refresh_worker WHERE id = 1 AND lease_token = ? AND lease_expires_at > ?)";
