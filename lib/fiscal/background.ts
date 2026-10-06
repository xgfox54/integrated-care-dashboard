// 지방재정 정기 수집. 이 호스팅은 예약 작업을 돌리지 않으므로 방문 요청 뒤 남는 시간(waitUntil)에 한 단계씩 진행한다.
// 매일 10시(한국시간) 이후 전날을 기준일로 범위마다 한 번 수집하며, 실패한 범위는 다음 날 다시 시도한다(무한 재시도 없음).
// 광역별 전국 전체 세출처럼 큰 범위는 정의의 cadenceDays(예: 7)에 맞춘 기준일에만 받고, 매일 받는 범위를 막지 않도록 순서를 나눈다.
import { env } from "cloudflare:workers";
import { getD1 } from "../d1";
import { advanceRun, type FiscalDeps, type FiscalResponse, type FiscalRun, listScopes, startRun } from "./collect";
import { advanceUnitCheck, fetchOfficialScreen } from "./unit-check-run";
import { cadenceTarget, scopeCadenceDays } from "./cadence";
import { purgeOldPeriodicSnapshots } from "./retention";
import { readWebPin } from "../platform/public-pin";
import { logServerError } from "../errors";
import { parseBudgetRequest, readBudget } from "./public";
import { purgeBudgetCache } from "./response-cache";
import { advanceIntegratedCareClassification, integratedCareClassVersion } from "./classify";

const CHECK_INTERVAL_MS = 60_000;
/** 진행 중인 수집이 있으면 더 자주 이어 받는다(표본키는 페이지당 5건이라 페이지 수가 많다). */
const ACTIVE_RUN_INTERVAL_MS = 15_000;
const FETCH_TIMEOUT_MS = 7_000;
const PERIODIC_FETCH_TIMEOUT_MS = 20_000;
/** 지난해 말일(코드 이력) 수집이 실패만 했을 때 다시 시작하는 횟수와 간격. */
const HISTORY_ATTEMPTS = 3;
const HISTORY_RETRY_SECONDS = 6 * 3600;
export const FISCAL_COLLECTION_HOUR_KST = 10;
export const FISCAL_SCHEDULE_LABEL = "매일 10시(한국시간) 이후, 전날을 기준일로 수집";
let lastCheckAt = 0;
let runActive = false;
/** 복지예산 기본 화면 미리 계산: 공개본 서명이 바뀌면 처음부터, 같으면 멈춘 곳부터 잇는다. */
let warmedSignature = "";
let warmSignature = "";
let warmIndex = 0;
const WARM_STEP_MS = 15_000;

/** 수집할 기준일: 10시 이후면 어제, 그 전이면 그제(한국시간). */
export function targetReferenceDate(nowSeconds: number): string {
  const kst = new Date((nowSeconds + 9 * 3600) * 1000);
  kst.setUTCDate(kst.getUTCDate() - (kst.getUTCHours() >= FISCAL_COLLECTION_HOUR_KST ? 1 : 2));
  return kst.toISOString().slice(0, 10);
}

// 공개본에서는 지방재정365 인증키를 배포 환경변수로 받는다.
async function readLofinKey(): Promise<string | null> {
  return (env as { LOFIN_API_KEY?: string }).LOFIN_API_KEY?.trim() || null;
}

async function timedFetch(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<FiscalResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: { accept: "application/json" }, redirect: "manual", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fiscalWorkerDeps(): Promise<FiscalDeps> {
  return {
    fetcher: timedFetch,
    now: () => Math.floor(Date.now() / 1000),
    newId: () => crypto.randomUUID(),
    apiKey: await readLofinKey(),
    stepBudgetMs: 15_000,
  };
}


async function runningRuns(db: ReturnType<typeof getD1>): Promise<FiscalRun[]> {
  return (await db.prepare("SELECT * FROM fiscal_collection_run WHERE status = 'RUNNING' ORDER BY started_at").all<FiscalRun>()).results;
}

export async function advanceFiscalInBackground(): Promise<void> {
  const now = Date.now();
  if (now - lastCheckAt < (runActive ? ACTIVE_RUN_INTERVAL_MS : CHECK_INTERVAL_MS)) return;
  lastCheckAt = now;
  const db = getD1();
  const nowSeconds = Math.floor(now / 1000);
  const deps = await fiscalWorkerDeps();
  const scopes = (await listScopes(db)).filter((scope) => scope.enabled);
  const cadence = new Map(scopes.map((scope) => [scope.scope_id, scopeCadenceDays(scope)]));
  const isDaily = (scopeId: string) => (cadence.get(scopeId) ?? 1) === 1;
  const running = await runningRuns(db);
  // 광역별 전체 세출은 원천이 쪽마다 수 초씩 걸린다. 응답 뒤 작업 시간(약 30초) 안에서 한 쪽을 크게(최대 500건, 제한 20초) 받는다.
  // 다 받은 뒤 공개본으로 옮기는 단계는 원천 요청이 없으므로 그 작업 시간을 대부분(18초) 쓴다.
  const periodicDeps: FiscalDeps = { ...deps, fetcher: (url) => timedFetch(url, PERIODIC_FETCH_TIMEOUT_MS), stepBudgetMs: 4_000, growBelowMs: 8_000, finalizeBudgetMs: 18_000 };
  // 지난해 말일(T94 코드 이력) 조회는 원천 응답이 7초를 넘기 쉬워 매일 수집용 제한으로는 계속 실패했다. 이력 수집은 주기 범위와 같은 제한을 쓴다.
  const advance = async (run: FiscalRun) => {
    runActive = (await advanceRun(db, run, run.trigger === "history" ? periodicDeps : deps)).status === "RUNNING";
  };
  const advancePeriodic = async (run: FiscalRun) => {
    runActive = (await advanceRun(db, run, periodicDeps, 2)).status === "RUNNING";
  };
  const target = targetReferenceDate(nowSeconds);
  const startDue = async (daily: boolean): Promise<boolean> => {
    for (const scope of scopes) {
      if (isDaily(scope.scope_id) !== daily) continue;
      const date = cadenceTarget(target, cadence.get(scope.scope_id) ?? 1);
      // 주기 범위는 그 주 기준일 이후에 이미 받은 run(관리자가 직접 시작한 것 포함)이 있으면 다시 받지 않는다.
      const existing = await db.prepare("SELECT 1 AS found FROM fiscal_collection_run WHERE scope_id = ? AND requested_reference_date " + (daily ? "=" : ">=") + " ? LIMIT 1")
        .bind(scope.scope_id, date).first<{ found: number }>();
      if (existing) continue;
      const run = await startRun(db, scope, date, "scheduled", deps);
      if (run.status === "RUNNING") await (daily ? advance(run) : advancePeriodic(run));
      return true;
    }
    return false;
  };

  // 1) 매일 받는 범위(통합돌봄·제주 등)를 먼저: 진행 중이면 잇고, 오늘 기준일이 없으면 시작한다.
  const dailyRun = running.find((run) => isDaily(run.scope_id));
  if (dailyRun) return advance(dailyRun);
  if (await startDue(true)) return;
  runActive = false;
  // 2) 공개 snapshot의 공식 화면 자동 대조를 한 쪽씩(실패는 대조 기록에만 남고 수집을 막지 않는다).
  const checked = await advanceUnitCheck(db, fetchOfficialScreen, nowSeconds).catch((error: unknown) => {
    logServerError(error, { path: "background-fiscal-unit-check", status: 500 });
    return false;
  });
  if (checked) {
    runActive = true;
    return;
  }
  // 3) 주기 범위(광역별 전체 세출): 한 번에 하나만 잇거나 시작한다.
  const periodicRun = running.find((run) => !isDaily(run.scope_id));
  if (periodicRun) return advancePeriodic(periodicRun);
  if (await startDue(false)) return;
  // 오래된 주기 snapshot 행 자료를 조금씩 지운다(활성 공개본에 고정된 것은 남김).
  const periodicScopes = scopes.filter((scope) => !isDaily(scope.scope_id)).map((scope) => scope.scope_id);
  if (periodicScopes.length && await purgeOldPeriodicSnapshots(db, periodicScopes, (await readWebPin(db)).fiscalSnapshotIds)) return;
  // 통합돌봄 예산 분류: 공개본·위키 수집본·행정단위가 바뀌면 자치단체 몇 곳씩 다시 대조한다(lib/fiscal/classify.ts).
  const classified = await advanceIntegratedCareClassification(db, nowSeconds).catch((error: unknown) => {
    logServerError(error, { path: "background-fiscal-classify", status: 500 });
    return false;
  });
  if (classified) {
    runActive = true;
    return;
  }
  // 4) 연도별 부서·사업 코드 이력(T94)을 위해 앞 회계연도 말일(12-31) snapshot을 매일 범위마다 한 번 받아 둔다.
  // 발급 키가 필요한 범위는 키가 있을 때만 시작한다(키 없이 시작하면 BLOCKED로만 남는다). 큰 주기 범위는 대상에서 뺀다.
  const previousYearEnd = String(Number(target.slice(0, 4)) - 1) + "-12-31";
  for (const scope of scopes) {
    if (!isDaily(scope.scope_id) || (scope.access_requirement === "KEY_REQUIRED" && !deps.apiKey)) continue;
    // 지난해 말일 조회는 원천 응답이 느려 시간 초과로 실패할 수 있다. 실패만 있었으면 6시간 간격으로 3번까지 다시 시작한다.
    const tried = await db.prepare(
      "SELECT SUM(CASE WHEN status = 'FAILED' THEN 0 ELSE 1 END) AS settled, SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed, MAX(started_at) AS last_started " +
        "FROM fiscal_collection_run WHERE scope_id = ? AND requested_reference_date = ? AND status <> 'BLOCKED'",
    ).bind(scope.scope_id, previousYearEnd).first<{ settled: number | null; failed: number | null; last_started: number | null }>();
    if ((tried?.settled ?? 0) > 0 || (tried?.failed ?? 0) >= HISTORY_ATTEMPTS || (tried?.last_started ?? 0) > nowSeconds - HISTORY_RETRY_SECONDS) continue;
    const run = await startRun(db, scope, previousYearEnd, "history", deps);
    if (run.status === "RUNNING") await advance(run);
    return;
  }
  // 5) 복지예산 기본 화면(사회복지·통합돌봄·보건 × 전국·광역)을 미리 계산해 두어 첫 조회도 빠르게 한다.
  await warmBudgetCache(db, nowSeconds);
}

async function warmBudgetCache(db: ReturnType<typeof getD1>, nowSeconds: number): Promise<void> {
  const latest = await db.prepare("SELECT COUNT(*) AS n, MAX(published_at) AS last FROM fiscal_snapshot WHERE status = 'PUBLISHED'").first<{ n: number; last: number | null }>();
  const signature = String(latest?.n ?? 0) + ":" + String(latest?.last ?? 0) + ":" + String(await integratedCareClassVersion(db));
  if (signature === warmedSignature) return;
  if (signature !== warmSignature) {
    warmSignature = signature;
    warmIndex = 0;
  }
  const regions = (await db.prepare("SELECT DISTINCT wa_code FROM fiscal_entity ORDER BY wa_code").all<{ wa_code: string }>()).results.map((row) => row.wa_code);
  const requests = ["social_welfare", "integrated_care", "health"].flatMap((mode) => ["", ...regions].map((region) => ({ mode, region })));
  const started = Date.now();
  while (warmIndex < requests.length) {
    const { mode, region } = requests[warmIndex];
    const parsed = parseBudgetRequest(new URLSearchParams(region ? { mode, region } : { mode }));
    if (parsed.ok) await readBudget(db, parsed.request);
    warmIndex += 1;
    if (Date.now() - started > WARM_STEP_MS) {
      runActive = true;
      return;
    }
  }
  await purgeBudgetCache(db, nowSeconds);
  warmedSignature = signature;
}
