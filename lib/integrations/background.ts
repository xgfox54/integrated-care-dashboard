import { fetchBoundedResponse, DEFAULT_UPSTREAM_PAGE_BYTES } from "../upstream-response.ts";
// 외부 연계 정기 수집. 이 호스팅은 예약 작업(cron)을 돌리지 않으므로 방문 요청 뒤 남는 시간(waitUntil)에 한 단계씩 잇는다.
// 방문이 없으면 수집도 멈춘다(상시 자동수집이 아님). 정시 실행이 필요하면 Sites 예약 기능을 운영자 동의 뒤 붙인다.
import { getD1 } from "../d1";
import type { SqlDatabase } from "../sql-database";
import { logServerError } from "../errors";
import type { DatasetKey } from "./adapters";
import { readIntegrationKey } from "./keys";
import { mapKosisRegions } from "./kosis";
import { advanceGov24Matching } from "./matching";
import { advanceRun, DATASET_SPECS, type IntegrationDeps, startRun } from "./runner";
import { CARE_DATASET_KEYS, CARE_RESOURCES_COLLECTED } from "./care-hold.ts";

const CHECK_INTERVAL_MS = 30_000;
const FETCH_TIMEOUT_MS = 15_000;
/** 법정동코드 API의 시·도 코드(행정표준코드관리시스템 2026-10-05 선택 목록). 폐지된 29·46도 원천이 0건을 주는지 확인하려고 넣는다. */
export const LTC_SIDO_CODES = ["11", "12", "26", "27", "28", "29", "30", "31", "36", "41", "43", "44", "46", "47", "48", "50", "51", "52"] as const;
// 돌봄자원(장기요양·KOSIS)은 CARE_RESOURCES_COLLECTED가 꺼져 있으면 배경 수집에서 뺀다(lib/integrations/care-hold.ts).
const ORDER: readonly DatasetKey[] = (["mois.legal_dong", "nhis.ltc_search", "mois.gov24_list", "kosis.stats", "nhis.ltc_detail", "mois.gov24_detail"] as DatasetKey[]).filter((key) => CARE_RESOURCES_COLLECTED || !CARE_DATASET_KEYS.has(key));
let lastCheckAt = 0;
let active = false;
const owner = "w-" + Math.random().toString(36).slice(2, 10);

async function timedFetch(url: string) {
  return fetchBoundedResponse(url, {
    timeoutMs: FETCH_TIMEOUT_MS, maxBytes: DEFAULT_UPSTREAM_PAGE_BYTES,
    headers: { accept: "application/json, application/xml;q=0.9, */*;q=0.5", "user-agent": "integrated-care-dashboard/1.0 (+https://integrated-care-national-dashboard.xgfox54.chatgpt.site/sources)" },
  });
}

export function integrationWorkerDeps(): IntegrationDeps {
  let id = 0;
  return {
    fetcher: timedFetch,
    now: () => Math.floor(Date.now() / 1000),
    newId: () => "ext-" + Date.now().toString(36) + "-" + owner + "-" + ++id,
    keyFor: readIntegrationKey,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    owner,
    stepBudgetMs: 12_000,
    queueCap: 300,
    minIntervalMs: 300,
  };
}

/** 수집 범위 행을 만든다(이미 있으면 그대로). KOSIS는 확인(VERIFIED)된 통계표만 범위가 된다. */
export async function ensureScopes(db: SqlDatabase): Promise<void> {
  const rows: [string, string][] = [["mois.legal_dong", "all"], ["nhis.ltc_detail", "queue"], ["mois.gov24_list", "all"], ["mois.gov24_detail", "queue"], ...LTC_SIDO_CODES.map((code): [string, string] => ["nhis.ltc_search", "sido:" + code])];
  const tables = await db.prepare("SELECT org_id, tbl_id FROM kosis_table WHERE status = 'VERIFIED' AND query_json IS NOT NULL").all<{ org_id: string; tbl_id: string }>();
  for (const table of tables.results) rows.push(["kosis.stats", "tbl:" + table.org_id + ":" + table.tbl_id]);
  await db.batch(rows.map(([dataset, scope]) => db.prepare("INSERT OR IGNORE INTO ext_scope_state (dataset_key, scope_key) VALUES (?, ?)").bind(dataset, scope)));
}

/** 한 단계: 진행 중인 수집을 잇거나, 때가 된 범위 하나를 시작한다. 인증키가 없으면 요청 없이 미수집(인증키 필요)으로 둔다. */
export async function advanceIntegrations(db: SqlDatabase, deps: IntegrationDeps): Promise<string> {
  const now = deps.now();
  // 보류 중인 연계(돌봄자원: 장기요양·KOSIS)는 이어 받지도 새로 시작하지도 않는다. ORDER에 있는 연계만 돈다.
  const running = await db.prepare("SELECT run_id, dataset_key, scope_key FROM ext_run WHERE status = 'RUNNING' AND (retry_at IS NULL OR retry_at <= ?) AND (lease_until IS NULL OR lease_until <= ?) AND dataset_key IN (SELECT value FROM json_each(?)) ORDER BY updated_at LIMIT 1")
    .bind(now, now, JSON.stringify(ORDER)).first<{ run_id: string; dataset_key: DatasetKey; scope_key: string }>();
  if (running) return afterRun(db, running.dataset_key, running.scope_key, await advanceRun(db, deps, running.run_id), now);
  await ensureScopes(db);
  const due = await db.prepare("SELECT dataset_key, scope_key FROM ext_scope_state WHERE next_due_at <= ? AND dataset_key <> 'moleg.law'").bind(now).all<{ dataset_key: DatasetKey; scope_key: string }>();
  const succeeded = await db.prepare("SELECT dataset_key FROM ext_scope_state WHERE last_success_at IS NOT NULL GROUP BY dataset_key").all<{ dataset_key: string }>();
  const done = new Set(succeeded.results.map((row) => row.dataset_key));
  const candidates = due.results
    .filter((row) => row.dataset_key in DATASET_SPECS && ORDER.includes(row.dataset_key))
    .filter((row) => (row.dataset_key !== "nhis.ltc_detail" || done.has("nhis.ltc_search")) && (row.dataset_key !== "mois.gov24_detail" || done.has("mois.gov24_list")))
    .sort((a, b) => ORDER.indexOf(a.dataset_key) - ORDER.indexOf(b.dataset_key));
  const next = candidates[0];
  if (!next) {
    const matched = await advanceGov24Matching(db, now);
    return matched.checked ? "matched " + matched.checked : "idle";
  }
  const key = await deps.keyFor(DATASET_SPECS[next.dataset_key].access);
  if (!key) {
    await db.prepare("UPDATE ext_scope_state SET last_status = 'AUTH_MISSING', last_message = ?, last_attempt_at = ?, next_due_at = ? WHERE dataset_key = ? AND scope_key = ?")
      .bind(DATASET_SPECS[next.dataset_key].access === "KOSIS_KEY" ? "KOSIS 인증키가 저장되지 않아 호출하지 않았습니다." : "공공데이터포털 인증키가 저장되지 않아 호출하지 않았습니다.", now, now + 6 * 3600, next.dataset_key, next.scope_key).run();
    return "auth-missing " + next.dataset_key;
  }
  const { runId } = await startRun(db, deps, next.dataset_key, next.scope_key, "background");
  return afterRun(db, next.dataset_key, next.scope_key, await advanceRun(db, deps, runId), now);
}

async function afterRun(db: SqlDatabase, dataset: DatasetKey, scope: string, status: string, now: number): Promise<string> {
  if (dataset === "kosis.stats" && (status === "SUCCEEDED" || status === "SUCCEEDED_EMPTY")) {
    const [, orgId, tblId] = scope.split(":");
    if (orgId && tblId) await mapKosisRegions(db, orgId, tblId, now);
  }
  return dataset + " " + scope + " " + status;
}

export async function advanceIntegrationsInBackground(): Promise<void> {
  const nowMs = Date.now();
  if (active || nowMs - lastCheckAt < CHECK_INTERVAL_MS) return;
  lastCheckAt = nowMs;
  active = true;
  try {
    await advanceIntegrations(getD1(), integrationWorkerDeps());
  } catch (error) {
    logServerError(error, { path: "background-integrations", status: 500 });
  } finally {
    active = false;
  }
}
