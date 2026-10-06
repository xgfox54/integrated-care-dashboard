// 외부 연계 수집 실행기. 한 번의 수집(run)을 여러 요청에 나눠 쪽(page) 단위로 잇고, 실행권(lease)으로 중복 실행을 막는다.
// - 호출 한도: 범위마다 한 번에 한 요청(동시 1), 요청 사이 최소 간격, 시간 초과는 fetcher가 맡는다.
// - 실패: 일시 장애·호출한도는 Retry-After와 지수 백오프로 최대 4번 다시 시도, 인증·미지원·차단은 바로 멈춘다.
// - 결과: 실패를 0건으로 바꾸지 않고, 부분 응답·쪽 누락이면 PARTIAL로 끝내 기존 자료를 표시 변경 없이 둔다.
import type { SqlDatabase } from "../sql-database.ts";
import {
  ADAPTER_VERSION, type DatasetKey, gov24DetailUrl, gov24ListUrl, GOV24_PAGE, isOutcome, kosisDataUrl, type KosisQuery, LEGAL_DONG_PAGE, legalDongUrl,
  LTC_PAGE, ltcGeneralUrl, ltcPartnerUrl, ltcSearchUrl, type ParsedPage, parseGov24Detail, parseGov24List, parseKosisData, parseLegalDong, parseLtcGeneral,
  parseLtcPartners, parseLtcSearch,
} from "./adapters.ts";
import { backoffSeconds, classify, type HttpLike, type Outcome, type OutcomeKind, type Provider, redactQuery, retryable, sha256Hex, succeeded } from "./http.ts";
import { partnersNotSeen, projectNotSeen, projectPage } from "./project.ts";
import { markNotSeen, upsertRecords } from "./store.ts";

export type KeyAccess = "DATA_GO_KR_KEY" | "KOSIS_KEY";

export interface IntegrationDeps {
  fetcher(url: string): Promise<HttpLike>;
  /** 현재 시각(초). */
  now(): number;
  newId(): string;
  /** 주소에 바로 넣을 수 있게 인코딩된 인증키. 없으면 null(네트워크 요청 없이 AUTH_MISSING). */
  keyFor(access: KeyAccess): Promise<string | null>;
  sleep?(ms: number): Promise<void>;
  readonly owner?: string;
  /** 한 단계에서 쓸 시간(밀리초). */
  readonly stepBudgetMs?: number;
  /** 대기열 수집(상세조회)에서 한 실행에 처리할 최대 대상 수. */
  readonly queueCap?: number;
  /** 요청 사이 최소 간격(밀리초). */
  readonly minIntervalMs?: number;
}

export type RunStatus = "RUNNING" | "SUCCEEDED" | "SUCCEEDED_EMPTY" | "PARTIAL" | "AUTH_MISSING" | "AUTH_FAILED" | "RATE_LIMITED" | "TRANSIENT_ERROR" | "UNSUPPORTED" | "BLOCKED" | "PARSE_ERROR";

export interface DatasetSpec {
  readonly provider: Provider;
  readonly access: KeyAccess;
  readonly refreshDays: number;
  readonly mode: "paged" | "queue";
  readonly pageSize: number;
}

export const DATASET_SPECS: Readonly<Record<DatasetKey, DatasetSpec>> = {
  "mois.legal_dong": { provider: "DATA_GO_KR", access: "DATA_GO_KR_KEY", refreshDays: 30, mode: "paged", pageSize: LEGAL_DONG_PAGE },
  "nhis.ltc_search": { provider: "DATA_GO_KR", access: "DATA_GO_KR_KEY", refreshDays: 7, mode: "paged", pageSize: LTC_PAGE },
  "nhis.ltc_detail": { provider: "DATA_GO_KR", access: "DATA_GO_KR_KEY", refreshDays: 30, mode: "queue", pageSize: 1 },
  "mois.gov24_list": { provider: "ODCLOUD", access: "DATA_GO_KR_KEY", refreshDays: 1, mode: "paged", pageSize: GOV24_PAGE },
  "mois.gov24_detail": { provider: "ODCLOUD", access: "DATA_GO_KR_KEY", refreshDays: 1, mode: "queue", pageSize: 1 },
  "kosis.stats": { provider: "KOSIS", access: "KOSIS_KEY", refreshDays: 30, mode: "paged", pageSize: 40_000 },
};

export const LEASE_SECONDS = 90;
export const MAX_ATTEMPTS = 4;
const DAY = 86_400;

export interface RunRow {
  readonly run_id: string;
  readonly dataset_key: DatasetKey;
  readonly scope_key: string;
  readonly status: RunStatus;
  readonly started_at: number;
  readonly cursor_json: string;
  readonly pages_done: number;
  readonly expected_total: number | null;
  readonly rows_received: number;
  readonly records_seen: number;
  readonly attempts: number;
  readonly retry_at: number | null;
}

interface Cursor {
  page?: number;
  processed?: number;
}

const FAILURE_STATUS: Readonly<Record<OutcomeKind, RunStatus>> = {
  OK: "SUCCEEDED", EMPTY: "SUCCEEDED_EMPTY", AUTH_MISSING: "AUTH_MISSING", AUTH_FAILED: "AUTH_FAILED", RATE_LIMITED: "RATE_LIMITED",
  TRANSIENT: "TRANSIENT_ERROR", UNSUPPORTED: "UNSUPPORTED", BLOCKED: "BLOCKED", PARSE_ERROR: "PARSE_ERROR",
};

export function failureStatus(kind: OutcomeKind): RunStatus {
  return FAILURE_STATUS[kind];
}

export async function readRun(db: SqlDatabase, runId: string): Promise<RunRow | null> {
  return db.prepare("SELECT run_id, dataset_key, scope_key, status, started_at, cursor_json, pages_done, expected_total, rows_received, records_seen, attempts, retry_at FROM ext_run WHERE run_id = ?").bind(runId).first<RunRow>();
}

/** 같은 범위에 진행 중인 수집이 있으면 새로 만들지 않고 그것을 돌려준다(중복 실행 방지). */
export async function startRun(db: SqlDatabase, deps: IntegrationDeps, datasetKey: DatasetKey, scopeKey: string, trigger: string): Promise<{ readonly runId: string; readonly reused: boolean }> {
  const active = await db.prepare("SELECT run_id FROM ext_run WHERE dataset_key = ? AND scope_key = ? AND status = 'RUNNING' ORDER BY started_at DESC LIMIT 1").bind(datasetKey, scopeKey).first<{ run_id: string }>();
  if (active) return { runId: active.run_id, reused: true };
  const runId = deps.newId();
  const now = deps.now();
  await db.batch([
    db.prepare("INSERT INTO ext_run (run_id, dataset_key, scope_key, trigger, status, started_at, updated_at, cursor_json, adapter_version) VALUES (?, ?, ?, ?, 'RUNNING', ?, ?, ?, ?)").bind(runId, datasetKey, scopeKey, trigger, now, now, JSON.stringify({ page: 1, processed: 0 }), ADAPTER_VERSION),
    db.prepare("INSERT INTO ext_scope_state (dataset_key, scope_key, last_attempt_at) VALUES (?, ?, ?) ON CONFLICT(dataset_key, scope_key) DO UPDATE SET last_attempt_at = excluded.last_attempt_at").bind(datasetKey, scopeKey, now),
  ]);
  return { runId, reused: false };
}

async function acquireLease(db: SqlDatabase, runId: string, owner: string, now: number): Promise<boolean> {
  await db.prepare("UPDATE ext_run SET lease_owner = ?, lease_until = ? WHERE run_id = ? AND status = 'RUNNING' AND (lease_until IS NULL OR lease_until <= ? OR lease_owner = ?)")
    .bind(owner, now + LEASE_SECONDS, runId, now, owner).run();
  const row = await db.prepare("SELECT lease_owner, status FROM ext_run WHERE run_id = ?").bind(runId).first<{ lease_owner: string | null; status: string }>();
  return row?.status === "RUNNING" && row.lease_owner === owner;
}

async function finish(db: SqlDatabase, deps: IntegrationDeps, run: RunRow, status: RunStatus, outcome: Outcome | null, message: string, extraDueSeconds?: number): Promise<RunStatus> {
  const now = deps.now();
  const spec = DATASET_SPECS[run.dataset_key];
  const ok = status === "SUCCEEDED" || status === "SUCCEEDED_EMPTY";
  const state = await db.prepare("SELECT consecutive_failures FROM ext_scope_state WHERE dataset_key = ? AND scope_key = ?").bind(run.dataset_key, run.scope_key).first<{ consecutive_failures: number }>();
  const failures = ok ? 0 : (state?.consecutive_failures ?? 0) + 1;
  const due = extraDueSeconds !== undefined ? now + extraDueSeconds
    : ok ? now + spec.refreshDays * DAY
      // 인증 실패는 활용신청·키 저장 직후 풀리는 경우가 많아 2시간 뒤 다시 본다. 미지원·차단은 하루 뒤.
      : status === "AUTH_MISSING" || status === "AUTH_FAILED" ? now + 2 * 3600
      : status === "UNSUPPORTED" || status === "BLOCKED" ? now + DAY
        : now + backoffSeconds(failures, outcome?.retryAfterSeconds ?? null, 600);
  await db.batch([
    db.prepare("UPDATE ext_run SET status = ?, finished_at = ?, updated_at = ?, message = ?, http_status = COALESCE(?, http_status), result_code = COALESCE(?, result_code), lease_owner = NULL, lease_until = NULL WHERE run_id = ?")
      .bind(status, now, now, message, outcome?.httpStatus ?? null, outcome?.code ?? null, run.run_id),
    db.prepare("INSERT INTO ext_scope_state (dataset_key, scope_key, last_status, last_message, last_attempt_at, last_success_at, last_success_run_id, next_due_at, consecutive_failures) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(dataset_key, scope_key) DO UPDATE SET last_status = excluded.last_status, last_message = excluded.last_message, last_attempt_at = excluded.last_attempt_at, last_success_at = COALESCE(excluded.last_success_at, ext_scope_state.last_success_at), last_success_run_id = COALESCE(excluded.last_success_run_id, ext_scope_state.last_success_run_id), next_due_at = excluded.next_due_at, consecutive_failures = excluded.consecutive_failures")
      .bind(run.dataset_key, run.scope_key, status, message, now, ok ? now : null, ok ? run.run_id : null, due, failures),
  ]);
  return status;
}

/** 일시 장애면 다시 시도 시각을 잡고 RUNNING을 유지한다. 시도 한도를 넘거나 다시 시도할 수 없는 실패면 끝낸다. */
async function handleFailure(db: SqlDatabase, deps: IntegrationDeps, run: RunRow, outcome: Outcome, queryBasis: string): Promise<RunStatus> {
  const now = deps.now();
  const attempts = run.attempts + 1;
  if (retryable(outcome.kind) && attempts < MAX_ATTEMPTS) {
    const wait = backoffSeconds(attempts, outcome.retryAfterSeconds, 30);
    await db.prepare("UPDATE ext_run SET attempts = ?, retry_at = ?, updated_at = ?, http_status = ?, result_code = ?, message = ?, query_basis = ?, lease_owner = NULL, lease_until = NULL WHERE run_id = ?")
      .bind(attempts, now + wait, now, outcome.httpStatus, outcome.code, outcome.message + " · " + wait + "초 뒤 다시 시도(" + attempts + "/" + MAX_ATTEMPTS + ")", queryBasis, run.run_id).run();
    return "RUNNING";
  }
  await db.prepare("UPDATE ext_run SET attempts = ?, query_basis = ? WHERE run_id = ?").bind(attempts, queryBasis, run.run_id).run();
  return finish(db, deps, run, failureStatus(outcome.kind), outcome, outcome.message);
}

async function request(deps: IntegrationDeps, provider: Provider, url: string): Promise<{ readonly outcome: Outcome; readonly body: string; readonly basis: string }> {
  const basis = redactQuery(url);
  try {
    const response = await deps.fetcher(url);
    const { outcome, body } = await classify(provider, response, deps.now() * 1000);
    return { outcome, body, basis };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    return { outcome: { kind: "TRANSIENT", httpStatus: 0, code: timeout ? "TIMEOUT" : "NETWORK", message: timeout ? "응답 시간 초과" : "접속 오류", retryAfterSeconds: null }, body: "", basis };
  }
}

export interface KosisScope {
  readonly orgId: string;
  readonly tblId: string;
  readonly query: KosisQuery;
}

export async function kosisScope(db: SqlDatabase, scopeKey: string): Promise<KosisScope | null> {
  const [, orgId, tblId] = scopeKey.split(":");
  if (!orgId || !tblId) return null;
  const row = await db.prepare("SELECT query_json FROM kosis_table WHERE org_id = ? AND tbl_id = ? AND status = 'VERIFIED'").bind(orgId, tblId).first<{ query_json: string | null }>();
  if (!row?.query_json) return null;
  try {
    return { orgId, tblId, query: JSON.parse(row.query_json) as KosisQuery };
  } catch {
    return null;
  }
}

function pagedUrl(datasetKey: DatasetKey, scopeKey: string, page: number, key: string, kosis: KosisScope | null): string | null {
  if (datasetKey === "mois.legal_dong") return legalDongUrl(page, key);
  if (datasetKey === "nhis.ltc_search") return /^sido:\d{2}$/.test(scopeKey) ? ltcSearchUrl(scopeKey.slice(5), page, key) : null;
  if (datasetKey === "mois.gov24_list") return gov24ListUrl(page, key);
  if (datasetKey === "kosis.stats" && kosis) return page === 1 ? kosisDataUrl(kosis.orgId, kosis.tblId, kosis.query, key) : null;
  return null;
}

function parsePaged(datasetKey: DatasetKey, body: string): ParsedPage | Outcome {
  if (datasetKey === "mois.legal_dong") return parseLegalDong(body);
  if (datasetKey === "nhis.ltc_search") return parseLtcSearch(body);
  if (datasetKey === "mois.gov24_list") return parseGov24List(body);
  return parseKosisData(body);
}

/** 원천 총건수에 비춘 이 쪽의 예상 행 수. 총건수를 모르면 null. */
export function expectedRows(total: number | null, page: number, pageSize: number): number | null {
  if (total === null) return null;
  return Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize));
}

/** 수집 한 단계: 실행권을 얻어 시간 예산 안에서 쪽을 잇는다. 돌려준 상태가 RUNNING이면 다음 단계에서 이어 받는다. */
export async function advanceRun(db: SqlDatabase, deps: IntegrationDeps, runId: string): Promise<RunStatus | "BUSY" | "WAITING"> {
  const owner = deps.owner ?? "worker";
  const startedMs = Date.now();
  const budget = deps.stepBudgetMs ?? 12_000;
  let run = await readRun(db, runId);
  if (!run || run.status !== "RUNNING") return run?.status ?? "UNSUPPORTED";
  if (run.retry_at && run.retry_at > deps.now()) return "WAITING";
  if (!(await acquireLease(db, runId, owner, deps.now()))) return "BUSY";
  const spec = DATASET_SPECS[run.dataset_key];
  const key = await deps.keyFor(spec.access);
  if (!key) return finish(db, deps, run, "AUTH_MISSING", null, spec.access === "KOSIS_KEY" ? "KOSIS 인증키가 저장되지 않아 호출하지 않았습니다." : "공공데이터포털 인증키가 저장되지 않아 호출하지 않았습니다.");
  const pause = async () => { if (deps.sleep) await deps.sleep(deps.minIntervalMs ?? 300); };
  if (spec.mode === "queue") return advanceQueue(db, deps, run, key, startedMs, budget, pause);
  const kosis = run.dataset_key === "kosis.stats" ? await kosisScope(db, run.scope_key) : null;
  if (run.dataset_key === "kosis.stats" && !kosis) return finish(db, deps, run, "UNSUPPORTED", null, "확인(VERIFIED)된 KOSIS 통계표 조회 조건이 없습니다.");
  while (Date.now() - startedMs < budget) {
    const cursor = JSON.parse(run.cursor_json) as Cursor;
    const page = cursor.page ?? 1;
    const url = pagedUrl(run.dataset_key, run.scope_key, page, key, kosis);
    if (!url) return finish(db, deps, run, "UNSUPPORTED", null, "지원하지 않는 수집 범위입니다: " + run.scope_key);
    const { outcome, body, basis } = await request(deps, spec.provider, url);
    if (!succeeded(outcome.kind)) return handleFailure(db, deps, run, outcome, basis);
    const parsed = outcome.kind === "EMPTY" ? { records: [], total: page === 1 ? 0 : run.expected_total, rowsReceived: 0 } : parsePaged(run.dataset_key, body);
    if (isOutcome(parsed)) return handleFailure(db, deps, run, parsed, basis);
    const total = parsed.total ?? run.expected_total;
    const expected = expectedRows(total, page, spec.pageSize);
    if (expected !== null && parsed.rowsReceived !== expected) {
      return handleFailure(db, deps, run, { kind: "TRANSIENT", httpStatus: outcome.httpStatus, code: "PAGE_SIZE_MISMATCH", message: page + "쪽 행 수가 원천 총건수와 맞지 않습니다(받은 " + parsed.rowsReceived + ", 예상 " + expected + ").", retryAfterSeconds: null }, basis);
    }
    const now = deps.now();
    const counts = await upsertRecords(db, run.dataset_key, run.scope_key, run.run_id, parsed.records, now);
    await projectPage(db, run.dataset_key, run.run_id, parsed.records, now, { kosis: kosis ? { orgId: kosis.orgId, tblId: kosis.tblId } : undefined });
    const hash = await sha256Hex(body);
    const rowsReceived = run.rows_received + parsed.rowsReceived;
    const last = parsed.rowsReceived < spec.pageSize || (total !== null && page * spec.pageSize >= total) || run.dataset_key === "kosis.stats";
    await db.prepare("UPDATE ext_run SET cursor_json = ?, pages_done = pages_done + 1, expected_total = COALESCE(?, expected_total), rows_received = ?, records_seen = records_seen + ?, records_new = records_new + ?, records_changed = records_changed + ?, attempts = 0, retry_at = NULL, updated_at = ?, http_status = ?, result_code = ?, query_basis = ?, last_response_hash = ? WHERE run_id = ?")
      .bind(JSON.stringify({ page: page + 1 }), total, rowsReceived, counts.seen, counts.created, counts.changed, now, outcome.httpStatus, outcome.code, basis, hash, run.run_id).run();
    run = (await readRun(db, runId)) as RunRow;
    if (last) {
      if (total !== null && rowsReceived !== total) return finish(db, deps, run, "PARTIAL", null, "받은 행 수(" + rowsReceived + ")가 원천 총건수(" + total + ")와 달라 이번 결과로 '보이지 않음' 표시를 하지 않았습니다.");
      const missing = await markNotSeen(db, run.dataset_key, run.scope_key, run.run_id, run.started_at, now);
      await projectNotSeen(db, run.dataset_key, run.scope_key, run.started_at);
      const status: RunStatus = rowsReceived === 0 ? "SUCCEEDED_EMPTY" : "SUCCEEDED";
      return finish(db, deps, run, status, outcome, status === "SUCCEEDED_EMPTY" ? "정상 응답, 해당 자료 0건" : "완료 " + rowsReceived + "행(이번에 보이지 않은 기존 레코드 " + missing + "건 표시)");
    }
    await pause();
  }
  await db.prepare("UPDATE ext_run SET lease_owner = NULL, lease_until = NULL WHERE run_id = ?").bind(run.run_id).run();
  return "RUNNING";
}

async function nextQueueItem(db: SqlDatabase, datasetKey: DatasetKey, now: number): Promise<{ readonly id: string; readonly extra: string | null } | null> {
  if (datasetKey === "nhis.ltc_detail") {
    const row = await db.prepare("SELECT i.admin_sym AS id, (SELECT s.admin_pttn_cd FROM ltc_institution_service s WHERE s.admin_sym = i.admin_sym AND s.presence = 'PRESENT' ORDER BY s.admin_pttn_cd LIMIT 1) AS extra FROM ltc_institution i WHERE i.presence = 'PRESENT' AND (i.detail_fetched_at IS NULL OR i.detail_fetched_at < ?) ORDER BY i.detail_fetched_at IS NOT NULL, i.detail_fetched_at, i.admin_sym LIMIT 1")
      .bind(now - 30 * DAY).first<{ id: string; extra: string | null }>();
    return row ?? null;
  }
  const row = await db.prepare("SELECT service_id AS id, modified_at AS extra FROM gov24_service WHERE presence = 'PRESENT' AND (detail_modified_at IS NULL OR detail_modified_at <> COALESCE(modified_at, '')) ORDER BY detail_fetched_at IS NOT NULL, service_id LIMIT 1").first<{ id: string; extra: string | null }>();
  return row ?? null;
}

async function advanceQueue(db: SqlDatabase, deps: IntegrationDeps, initial: RunRow, key: string, startedMs: number, budget: number, pause: () => Promise<void>): Promise<RunStatus> {
  let run = initial;
  const cap = deps.queueCap ?? 300;
  const spec = DATASET_SPECS[run.dataset_key];
  while (Date.now() - startedMs < budget) {
    const cursor = JSON.parse(run.cursor_json) as Cursor;
    const processed = cursor.processed ?? 0;
    if (processed >= cap) return finish(db, deps, run, "SUCCEEDED", null, "이번 실행 처리 " + processed + "건(한도). 남은 대상은 1시간 뒤 이어 받습니다.", 3600);
    const item = await nextQueueItem(db, run.dataset_key, deps.now());
    if (!item) return finish(db, deps, run, processed ? "SUCCEEDED" : "SUCCEEDED_EMPTY", null, processed ? "상세 조회 " + processed + "건 완료" : "새로 조회할 대상이 없습니다.");
    const now = deps.now();
    let records: ParsedPage["records"] = [];
    let basis = "";
    if (run.dataset_key === "nhis.ltc_detail") {
      const general = await request(deps, spec.provider, ltcGeneralUrl(item.id, item.extra ?? "", key));
      basis = general.basis;
      if (!succeeded(general.outcome.kind)) return handleFailure(db, deps, run, general.outcome, basis);
      const parsedGeneral = parseLtcGeneral(general.body, item.id);
      if (isOutcome(parsedGeneral)) return handleFailure(db, deps, run, parsedGeneral, basis);
      await pause();
      const partners = await request(deps, spec.provider, ltcPartnerUrl(item.id, key));
      if (!succeeded(partners.outcome.kind)) return handleFailure(db, deps, run, partners.outcome, partners.basis);
      const parsedPartners = partners.outcome.kind === "EMPTY" ? { records: [], total: 0, rowsReceived: 0 } : parseLtcPartners(partners.body, item.id);
      if (isOutcome(parsedPartners)) return handleFailure(db, deps, run, parsedPartners, partners.basis);
      records = [...parsedGeneral.records, ...parsedPartners.records];
      await upsertRecords(db, run.dataset_key, "inst:" + item.id, run.run_id, records, now);
      await projectPage(db, run.dataset_key, run.run_id, records, now, { sym: item.id });
      const complete = parsedPartners.total === null || parsedPartners.total === parsedPartners.records.length;
      if (complete) await partnersNotSeen(db, item.id, now);
      await db.prepare("UPDATE ltc_institution SET detail_status = ?, detail_fetched_at = ?, detail_run_id = ? WHERE admin_sym = ?").bind(parsedGeneral.records.length ? (complete ? "COLLECTED" : "PARTNERS_PARTIAL") : "GENERAL_EMPTY", now, run.run_id, item.id).run();
    } else {
      const detail = await request(deps, spec.provider, gov24DetailUrl(item.id, key));
      basis = detail.basis;
      if (!succeeded(detail.outcome.kind)) return handleFailure(db, deps, run, detail.outcome, basis);
      const parsed = detail.outcome.kind === "EMPTY" ? { records: [], total: 0, rowsReceived: 0 } : parseGov24Detail(detail.body, item.id);
      if (isOutcome(parsed)) return handleFailure(db, deps, run, parsed, basis);
      records = parsed.records;
      await upsertRecords(db, run.dataset_key, "service:" + item.id, run.run_id, records, now);
      await projectPage(db, run.dataset_key, run.run_id, records, now);
      if (!records.length) await db.prepare("UPDATE gov24_service SET detail_status = 'DETAIL_EMPTY', detail_modified_at = COALESCE(modified_at, ''), detail_fetched_at = ? WHERE service_id = ?").bind(now, item.id).run();
    }
    await db.prepare("UPDATE ext_run SET cursor_json = ?, records_seen = records_seen + ?, attempts = 0, retry_at = NULL, updated_at = ?, query_basis = ? WHERE run_id = ?")
      .bind(JSON.stringify({ processed: processed + 1 }), records.length, now, basis, run.run_id).run();
    run = (await readRun(db, run.run_id)) as RunRow;
    await pause();
  }
  await db.prepare("UPDATE ext_run SET lease_owner = NULL, lease_until = NULL WHERE run_id = ?").bind(run.run_id).run();
  return "RUNNING";
}
