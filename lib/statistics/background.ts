import type { SqlDatabase } from "../sql-database.ts";
import { analyzeRobots } from "../press/robots.ts";
import { STATISTICS_DATASETS, verifiedStatistics } from "./catalog.ts";
import { parseStatisticsHtml, StatisticsError } from "./read.ts";
import { mergePopulationPages, parsePopulationPage, POPULATION_PAGE_URLS, type PopulationPageKind, type PopulationPageStage } from "./population-refresh.ts";
import { claimStatisticsWorker, releaseStatisticsWorker, publishedResults, POPULATION_SCOPE, STATISTICS_DAY, STATISTICS_HOUR, STATISTICS_LEASE_GUARD,
  type StatisticsScopeRow } from "./store.ts";
import type { StatisticsDataset, StatisticsResult } from "./types.ts";
import { indexApiUrl, parseIndexApi, indexApiTables, mergeIndexApiTables } from "./index-api.ts";
import { USER_AGENT, PACE_MS, SourceError, apiMessage, apiMessageCode, fetchSource } from "./refresh-source.ts";
import { readIndexStage, appendIndexStage, indexStageParts } from "./refresh-index-stage.ts";
import { INDEX_API_SERIES } from "./index-verified-data.ts";

const POPULATION_KINDS: readonly PopulationPageKind[] = ["age", "older", "children"];
interface HostState { next_request_at: number; robots?: { status: number; body: string; expires_at: number }; retry_after?: number; api_enabled?: boolean }
interface PopulationStage { started_at: number; pages: readonly PopulationPageStage[]; source_hashes: Record<string, string> }
export interface StatisticsRefreshDependencies {
  now?: () => number; fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
  sleep?: (milliseconds: number) => Promise<void>; budgetMs?: number; timeoutMs?: number; maxSteps?: number;
  readIndexKey?: () => Promise<string | null>;
  scopeId?: string;
  force?: boolean;
}
class BudgetFinished extends Error {}
class LeaseLost extends Error {}
async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function decodeHosts(raw: string): Record<string, HostState> {
  try {
    if (raw.length > 150_000) return {};
    const value = JSON.parse(raw);
    return value && !Array.isArray(value) && typeof value === "object" ? value : {};
  } catch { return {}; }
}
function decodeStage(raw: string | null, now: number): PopulationStage {
  if (raw && raw.length <= 100_000) {
    try { const stage = JSON.parse(raw); if (typeof stage.started_at === "number" && now - stage.started_at >= 0 && now - stage.started_at < STATISTICS_DAY
      && Array.isArray(stage.pages) && stage.pages.length <= 3 && stage.source_hashes && typeof stage.source_hashes === "object") return stage; } catch { /* restart bounded staging */ }
  }
  return { started_at: now, pages: [], source_hashes: {} };
}
function sourceCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "SOURCE_UNAVAILABLE";
  return /^(?:SOURCE_[A-Z_]+|ROBOTS_(?:UNAVAILABLE|DISALLOWED)|INVALID_CHECK_TIME)$/.test(code) ? code : "SOURCE_UNAVAILABLE";
}
/** Server-owned fixed sources. One global D1 lease also serializes requests across Worker isolates and PC wakes. */
export async function runStatisticsRefresh(db: SqlDatabase, dependencies: StatisticsRefreshDependencies = {}): Promise<{ status: string; completed: number; failed: number; staged: number }> {
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const fetcher = dependencies.fetcher ?? fetch;
  const timeoutMs = Math.min(5_000, Math.max(10, dependencies.timeoutMs ?? 5_000));
  const budgetMs = Math.min(22_000, Math.max(10, dependencies.budgetMs ?? 22_000));
  const started = now(), wallStarted = Date.now(), deadline = started + budgetMs;
  const token = crypto.randomUUID();
  if (dependencies.scopeId && !INDEX_API_SERIES[dependencies.scopeId]) throw new SourceError("SOURCE_NOT_ALLOWED");
  const summary = { status: "idle", completed: 0, failed: 0, staged: 0 };
  const lease = await claimStatisticsWorker(db, started, token);
  if (!lease) return { ...summary, status: "busy_or_current" };
  const hosts = decodeHosts(lease.host_state_json);
  let key: string | null = null;
  let keyUnavailable = false;
  const remaining = () => Math.min(deadline - now(), budgetMs - (Date.now() - wallStarted));
  async function persistHosts(): Promise<void> {
    const owned = await db.prepare("UPDATE statistics_refresh_worker SET host_state_json = ? WHERE id = 1 AND lease_token = ? AND lease_expires_at > ? RETURNING id")
      .bind(JSON.stringify(hosts), token, now()).first();
    if (!owned) throw new LeaseLost();
  }
  async function paced(url: string, requestTimeout = timeoutMs) {
    const origin = new URL(url).origin;
    const host = hosts[origin] ??= { next_request_at: 0 };
    const pause = Math.max(0, (host.next_request_at ?? 0) - now());
    if (pause + requestTimeout + 300 > remaining()) throw new BudgetFinished();
    if (pause) await sleep(pause);
    host.next_request_at = now() + PACE_MS;
    await persistHosts();
    return fetchSource(url, fetcher, requestTimeout, now);
  }
  async function permitted(url: string): Promise<string> {
    const target = new URL(url);
    const host = hosts[target.origin] ??= { next_request_at: 0 };
    if ((host.retry_after ?? 0) > now()) throw new SourceError("SOURCE_RATE_LIMITED", host.retry_after);
    if (!host.robots || host.robots.expires_at <= now()) {
      try {
        const response = await paced(target.origin + "/robots.txt");
        const policy = analyzeRobots(response.status, response.body, USER_AGENT, target.pathname + target.search);
        host.robots = { status: response.status, body: response.body, expires_at: now() + (policy.verdict === "UNREADABLE" ? STATISTICS_HOUR : STATISTICS_DAY) };
        if (response.retryAfter) host.retry_after = response.retryAfter;
        await persistHosts();
      } catch (error) {
        if (error instanceof BudgetFinished || error instanceof LeaseLost) throw error;
        host.robots = { status: 503, body: "", expires_at: now() + STATISTICS_HOUR };
        await persistHosts();
        throw new SourceError("ROBOTS_UNAVAILABLE");
      }
    }
    const policy = analyzeRobots(host.robots.status, host.robots.body, USER_AGENT, target.pathname + target.search);
    if (policy.verdict !== "ALLOWED" && policy.verdict !== "NO_ROBOTS") throw new SourceError(policy.verdict === "DISALLOWED" ? "ROBOTS_DISALLOWED" : "ROBOTS_UNAVAILABLE", host.retry_after);
    const response = await paced(url);
    if (response.status !== 200) {
      if (response.status === 429 || response.status === 503) { host.retry_after = Math.max(now() + STATISTICS_HOUR, response.retryAfter); await persistHosts(); }
      throw new SourceError(response.status === 429 ? "SOURCE_RATE_LIMITED" : [401,403].includes(response.status) ? "SOURCE_ACCESS_DENIED" : response.status === 404 ? "SOURCE_NOT_FOUND" : "SOURCE_UNAVAILABLE", response.retryAfter);
    }
    return response.body;
  }
  async function guardRun(sql: string, values: unknown[]) {
    const row = await db.prepare(sql + " AND " + STATISTICS_LEASE_GUARD + " RETURNING scope_id").bind(...values, token, now()).first();
    if (!row) throw new LeaseLost();
  }
  try {
    if (dependencies.scopeId && dependencies.force) await guardRun("UPDATE statistics_refresh_scope SET next_check_at = ?, updated_at = ? WHERE scope_id = ?", [now(), now(), dependencies.scopeId]);
    if (dependencies.readIndexKey) {
      try { key = await dependencies.readIndexKey(); } catch { keyUnavailable = true; }
    }
    const indexHost = hosts["https://www.index.go.kr"] ??= { next_request_at: 0 };
    if (key && !indexHost.api_enabled) {
      const ids = Object.keys(INDEX_API_SERIES);
      await db.prepare("UPDATE statistics_refresh_scope SET next_check_at = MIN(next_check_at, ?), stage_json = NULL WHERE scope_id IN (" + ids.map(() => "?").join(",") + ") AND " + STATISTICS_LEASE_GUARD)
        .bind(now(), ...ids, token, now()).run();
      indexHost.api_enabled = true;
      await persistHosts();
    }
    if (key) {
      const ids = Object.keys(INDEX_API_SERIES);
      await db.prepare("UPDATE statistics_refresh_scope SET next_check_at = MIN(next_check_at, last_attempt_at + 30000) WHERE failure_count = 1 AND last_success_at IS NULL AND error_code = 'SOURCE_API_UNAVAILABLE' AND scope_id IN (" + ids.map(() => "?").join(",") + ") AND " + STATISTICS_LEASE_GUARD)
        .bind(...ids, token, now()).run();
    }
    for (let step = 0; step < Math.min(24, dependencies.maxSteps ?? 16) && remaining() > timeoutMs + 300; step++) {
      const scope = await db.prepare("SELECT * FROM statistics_refresh_scope WHERE next_check_at <= ?" + (dependencies.scopeId ? " AND scope_id = ?" : "") + " ORDER BY next_check_at, COALESCE(last_attempt_at, 0), scope_id LIMIT 1")
        .bind(now(), ...(dependencies.scopeId ? [dependencies.scopeId] : [])).first<StatisticsScopeRow>();
      if (!scope) break;
      const active = await db.prepare("UPDATE statistics_refresh_worker SET active_scope = ? WHERE id = 1 AND lease_token = ? AND lease_expires_at > ? RETURNING id").bind(scope.scope_id, token, now()).first();
      if (!active) throw new LeaseLost();
      const saved = publishedResults(scope);
      const expected = STATISTICS_DATASETS.filter(d => (d.population ? POPULATION_SCOPE : d.id) === scope.scope_id);
      if (!expected.length) break;
      const minimumPeriod = [scope.latest_period ?? "", ...expected.map(d => d.periods.at(-1)!)].sort().at(-1)!;
      const stage = scope.scope_id === POPULATION_SCOPE ? decodeStage(scope.stage_json, now()) : null;
      let indexStage = key && INDEX_API_SERIES[expected[0].id]
        ? await readIndexStage(scope.stage_json, expected[0], scope.revision, now(), key) : null;
      if (!stage?.pages.length && !indexStage?.parts.length) await guardRun("UPDATE statistics_refresh_scope SET last_attempt_at = ?, error_code = NULL, stage_json = NULL, updated_at = ? WHERE scope_id = ?", [now(), now(), scope.scope_id]);
      try {
        let datasets: readonly StatisticsDataset[];
        if (stage) {
          const kind = POPULATION_KINDS.find(key => !stage.pages.some(page => page.kind === key));
          if (!kind) throw new SourceError("SOURCE_FORMAT_CHANGED");
          const html = await permitted(POPULATION_PAGE_URLS[kind]);
          const page = parsePopulationPage(kind, html);
          const nextStage: PopulationStage = { ...stage, pages: [...stage.pages, page], source_hashes: { ...stage.source_hashes, [kind]: await hash(html) } };
          if (nextStage.pages.length < 3) {
            await guardRun("UPDATE statistics_refresh_scope SET stage_json = ?, next_check_at = ?, updated_at = ? WHERE scope_id = ?", [JSON.stringify(nextStage), now(), now(), scope.scope_id]);
            summary.staged++; continue;
          }
          datasets = mergePopulationPages(nextStage.pages, { now: now(), minimumPeriod });
        } else {
          let dataset: StatisticsDataset;
          if (keyUnavailable && INDEX_API_SERIES[expected[0].id]) throw new SourceError("SOURCE_KEY_UNAVAILABLE");
          if (key && INDEX_API_SERIES[expected[0].id]) {
            if ((indexHost.retry_after ?? 0) > now()) throw new SourceError("SOURCE_RATE_LIMITED", indexHost.retry_after);
            const tables = indexApiTables(expected[0]);
            // 직전 시도가 응답 시간 초과였던 표는 다음 한 번을 12초까지 기다린다(전체 실행 예산 안에서만).
            const requestTimeout = dependencies.timeoutMs === undefined && (expected[0].id === "stat:2764" || scope.error_code === "SOURCE_TIMEOUT" || indexStage?.long_timeout) ? 12_000 : timeoutMs;
            const parts: StatisticsDataset[] = indexStage ? indexStageParts(indexStage, expected[0], now()) : [];
            for (const table of tables) {
              if (parts.some(part => part.table_code === table.table_code)) continue;
              const response = await paced(indexApiUrl(table, key, new Date(now()).getUTCFullYear()), requestTimeout);
              if (response.status !== 200) {
                if ([429, 503].includes(response.status)) { indexHost.retry_after = Math.max(now() + STATISTICS_HOUR, response.retryAfter); await persistHosts(); }
                throw new SourceError(response.status === 429 ? "SOURCE_RATE_LIMITED" : [401, 403].includes(response.status) ? "SOURCE_ACCESS_DENIED" : "SOURCE_API_UNAVAILABLE", response.retryAfter);
              }
              const message = apiMessage(response.body, key);
              if (message) throw new SourceError(apiMessageCode(message), 0, message);
              const body = response.body.split(key).join("[KEY]");
              parts.push(parseIndexApi(body, table, now()));
              if (parts.length < tables.length && indexStage) {
                indexStage = appendIndexStage(indexStage, table.table_code, body, requestTimeout > timeoutMs);
                await guardRun("UPDATE statistics_refresh_scope SET stage_json = ?, next_check_at = ?, updated_at = ? WHERE scope_id = ?", [JSON.stringify(indexStage), now(), now(), scope.scope_id]);
                summary.staged++;
              }
            }
            dataset = tables.length === 1 ? parts[0] : mergeIndexApiTables(expected[0], parts);
          } else {
            if (expected[0].index_api) throw new SourceError("SOURCE_KEY_REQUIRED");
            dataset = parseStatisticsHtml(await permitted(expected[0].source_url), expected[0]);
          }
          if (!dataset.series.some(series => series.points.some(point => point.value !== null))) throw new SourceError("SOURCE_INCOMPLETE");
          if (dataset.periods.at(-1)! < minimumPeriod) throw new StatisticsError("SOURCE_PERIOD_REGRESSION", "원문 수록 기간이 마지막 확인본보다 이전입니다.", 502);
          if (!dataset.index_api?.projection && Number(dataset.periods.at(-1)) > new Date(now()).getUTCFullYear() + (dataset.id === "stat:2762" ? 1 : 0)) throw new SourceError("SOURCE_FUTURE_PERIOD");
          datasets = [dataset];
        }
        // Keep previously published periods from an annually rolling source window.
        if (!stage) {
          const previous = saved[0]?.dataset ?? expected[0];
          const current = datasets[0];
          const periods = [...new Set([...previous.periods, ...current.periods])].sort();
          datasets = [{ ...current, periods, series: current.series.map(series => {
            const prior = previous.series.find(item => item.id === series.id);
            const points = new Map(prior?.points.map(point => [point.period, point]) ?? []);
            series.points.forEach(point => points.set(point.period, point));
            return { ...series, points: periods.map(period => points.get(period)!).filter(Boolean) };
          }) }];
        }
        const checkedAt = new Date(now()).toISOString();
        const revision = (stage ? "mois-population:" : (key && datasets[0].index_api ? "index-api:" : "public-table:") + datasets[0].table_code + ":") + (await hash(JSON.stringify(datasets))).slice(0, 24);
        const results: StatisticsResult[] = datasets.map(dataset => {
          const baseline = verifiedStatistics(dataset.id)!;
          return { ...baseline, dataset, revision, checked_at: checkedAt, state: "LIVE", refresh_error: null,
            available_periods: dataset.periods, warnings: [dataset.note, dataset.source_notes],
            coverage: dataset.population ? { scope: baseline.coverage.scope, complete: false, gaps: ["전국과 확인된 광역시·도의 현재 기준월을 제공합니다. 시·군·구 자료는 포함하지 않습니다."] } : baseline.coverage };
        });
        const latestPeriod = datasets[0].periods.at(-1)!;
        const payload = JSON.stringify(results);
        if (payload.length > 500_000) throw new SourceError("SOURCE_TOO_LARGE");
        await guardRun("UPDATE statistics_refresh_scope SET previous_json = CASE WHEN revision IS NULL OR revision <> ? THEN result_json ELSE previous_json END, result_json = ?, revision = ?, latest_period = ?, last_success_at = ?, next_check_at = ?, failure_count = 0, error_code = NULL, error_detail = NULL, stage_json = NULL, updated_at = ? WHERE scope_id = ? AND (latest_period IS NULL OR latest_period <= ?)",
          [revision, payload, revision, latestPeriod, now(), now() + STATISTICS_DAY, now(), scope.scope_id, latestPeriod]);
        summary.completed++;
      } catch (error) {
        if (error instanceof BudgetFinished || error instanceof LeaseLost) throw error;
        const initialApiRetry = key && INDEX_API_SERIES[scope.scope_id] && !scope.last_success_at && scope.failure_count === 0 && sourceCode(error) === "SOURCE_API_UNAVAILABLE";
        const retryMs = initialApiRetry ? 30_000 : Math.min(STATISTICS_DAY, STATISTICS_HOUR * 2 ** Math.min(scope.failure_count, 5));
        const next = Math.max(now() + retryMs, error instanceof SourceError ? error.retryAfter : 0);
        await guardRun("UPDATE statistics_refresh_scope SET failure_count = failure_count + 1, error_code = ?, error_detail = ?, next_check_at = ?, stage_json = ?, updated_at = ? WHERE scope_id = ?", [sourceCode(error), error instanceof SourceError ? error.detail : null, next, indexStage?.parts.length ? JSON.stringify(indexStage) : null, now(), scope.scope_id]);
        summary.failed++;
      }
    }
    summary.status = summary.completed || summary.failed || summary.staged ? "advanced" : "current";
  } catch (error) {
    if (!(error instanceof BudgetFinished) && !(error instanceof LeaseLost)) throw error;
    summary.status = error instanceof LeaseLost ? "lease_lost" : "continuation_pending";
  } finally { await releaseStatisticsWorker(db, token); }
  return summary;
}

let backgroundActive = false;
let nextBackgroundCheck = 0;
/** Every invocation is bounded; this function does not create or depend on a hosting cron. */
export async function advanceStatisticsInBackground(db: SqlDatabase, dependencies: StatisticsRefreshDependencies = {}): Promise<void> {
  if (backgroundActive || Date.now() < nextBackgroundCheck) return;
  backgroundActive = true; nextBackgroundCheck = Date.now() + 30_000;
  try { await runStatisticsRefresh(db, dependencies); } finally { backgroundActive = false; }
}
