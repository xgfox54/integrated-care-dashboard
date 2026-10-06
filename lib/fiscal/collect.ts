// 지방재정365 QWGJK 수집. 한 번의 수집(run)을 여러 요청에 나눠 페이지 단위로 이어 받고(체크포인트),
// 모든 페이지를 받은 뒤 원천 총건수·고유키 수가 맞을 때만 불변 snapshot을 만든다. 맞지 않으면 보류(INCONSISTENT)한다.
import type { SqlDatabase, SqlStatement } from "../sql-database.ts";
import { NORMALIZATION_RULE_ID, normalizeWon } from "./amount.ts";
import {
  buildQwgjkUrl,
  CONTRACT_VERSION,
  KEY_PAGE_SIZE,
  parseQwgjkResponse,
  type QwgjkQuery,
  type QwgjkRow,
  qwgjkRowKey,
  SAMPLE_PAGE_SIZE,
} from "./qwgjk.ts";

export interface FiscalResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface FiscalDeps {
  fetcher(url: string): Promise<FiscalResponse>;
  now(): number;
  newId(): string;
  /** 발급 인증키. 없으면 원천이 제공하는 표본키(페이지당 5건)로 호출한다. 값은 기록하지 않는다. */
  readonly apiKey: string | null;
  /** 한 단계에서 쓸 수 있는 시간(밀리초). */
  readonly stepBudgetMs?: number;
  /** 이보다 빨리 온 응답이면 줄였던 쪽 크기를 한 단계 되돌린다(기본 2.5초). 요청 제한시간이 긴 수집은 더 크게 준다. */
  readonly growBelowMs?: number;
  /** 모든 쪽을 받은 뒤 공개본으로 옮기는 단계에 쓸 시간(밀리초). 없으면 stepBudgetMs. */
  readonly finalizeBudgetMs?: number;
}

export interface FiscalScope {
  readonly scope_id: string;
  readonly label: string;
  readonly mode: string;
  readonly definition: string;
  readonly access_requirement: string;
  readonly classification_basis: string;
  readonly approval_status: string;
  readonly approved_at: number | null;
  readonly policy_note: string;
  readonly enabled: number;
}

export interface FiscalRun {
  readonly run_id: string;
  readonly scope_id: string;
  readonly trigger: string;
  readonly requested_reference_date: string;
  readonly fiscal_year: string;
  readonly access_tier: string;
  readonly page_size: number;
  readonly contract_version: string;
  readonly started_at: number;
  readonly updated_at: number;
  readonly finished_at: number | null;
  readonly status: string;
  readonly total_count: number | null;
  readonly pages_expected: number | null;
  readonly next_page: number;
  readonly received_rows: number;
  readonly invalid_rows: number;
  readonly duplicate_rows: number;
  readonly retry_count: number;
  readonly error_code: string;
  readonly snapshot_id: string | null;
  readonly lease_token: string;
  readonly lease_expires_at: number;
}

export const MAX_RETRIES = 3;
/** 발급 키 응답 시간 초과 때 차례로 줄여 볼 쪽 크기. 500을 나누어떨어지게 골랐다. */
const SHRINK_STEPS = [250, 125, 25] as const;
const GROW_STEPS = [125, 250, 500] as const;
const GROW_BELOW_MS = 2_500;
const LEASE_SECONDS = 90;
const BATCH_SIZE = 100;
/** D1은 쿼리 하나에 바인딩 변수를 100개까지만 받는다. 키 목록 조회는 이 크기로 나눈다. */
const KEY_QUERY_CHUNK = 90;
/** snapshot 만들기 한 번에 옮기는 행 수(행마다 8개 문장). */
const FINALIZE_CHUNK = 300;
const SOURCE_UNIT = "KRW";
/** 원 단위라는 해석은 과거 대조기록(P6)과 응답 정수값에 근거한다. 이번 범위의 공식 화면 대조 전까지 미검증으로 표시한다. */
const UNIT_VERIFICATION = "UNVERIFIED_IN_SCOPE";

export async function listScopes(db: SqlDatabase): Promise<FiscalScope[]> {
  return (await db.prepare("SELECT * FROM fiscal_scope ORDER BY scope_id").all<FiscalScope>()).results;
}

export async function readScope(db: SqlDatabase, scopeId: string): Promise<FiscalScope | null> {
  return db.prepare("SELECT * FROM fiscal_scope WHERE scope_id = ?").bind(scopeId).first<FiscalScope>();
}

export async function readRun(db: SqlDatabase, runId: string): Promise<FiscalRun | null> {
  return db.prepare("SELECT * FROM fiscal_collection_run WHERE run_id = ?").bind(runId).first<FiscalRun>();
}

export async function activeRun(db: SqlDatabase): Promise<FiscalRun | null> {
  return db.prepare("SELECT * FROM fiscal_collection_run WHERE status = 'RUNNING' ORDER BY started_at LIMIT 1").first<FiscalRun>();
}

/** 범위 정의에서 허용된 원천 필터만 꺼낸다. 정의에 없는 필터를 추정해 붙이지 않는다. */
export function scopeQuery(scope: Pick<FiscalScope, "definition">, fiscalYear: string, referenceDate: string): QwgjkQuery {
  const parsed: unknown = JSON.parse(scope.definition);
  const definition = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const text = (key: string) => (typeof definition[key] === "string" ? String(definition[key]) : undefined);
  return { fyr: fiscalYear, exeYmd: referenceDate.replace(/-/g, ""), waLafCd: text("waLafCd"), lafCd: text("lafCd"), dbizNm: text("dbizNm") };
}

async function updateRun(db: SqlDatabase, runId: string, fields: Partial<Omit<FiscalRun, "run_id">>): Promise<void> {
  const entries = Object.entries(fields);
  if (!entries.length) return;
  await db.prepare("UPDATE fiscal_collection_run SET " + entries.map(([key]) => key + " = ?").join(", ") + " WHERE run_id = ?")
    .bind(...entries.map(([, value]) => value ?? null), runId).run();
}

export async function startRun(db: SqlDatabase, scope: FiscalScope, requestedDate: string, trigger: string, deps: FiscalDeps): Promise<FiscalRun> {
  const now = deps.now();
  const runId = deps.newId();
  const tier = deps.apiKey ? "ISSUED_KEY" : "SAMPLE_KEY";
  const blocked = scope.access_requirement === "KEY_REQUIRED" && !deps.apiKey;
  await db.prepare(
    "INSERT INTO fiscal_collection_run (run_id, scope_id, trigger, requested_reference_date, fiscal_year, access_tier, page_size, contract_version, started_at, updated_at, finished_at, status, error_code) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    runId, scope.scope_id, trigger, requestedDate, requestedDate.slice(0, 4), tier, deps.apiKey ? KEY_PAGE_SIZE : SAMPLE_PAGE_SIZE, CONTRACT_VERSION,
    now, now, blocked ? now : null, blocked ? "BLOCKED" : "RUNNING", blocked ? "KEY_REQUIRED" : "",
  ).run();
  const run = await readRun(db, runId);
  if (!run) throw new Error("수집 기록을 만들지 못했습니다.");
  return run;
}

function marks(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/**
 * 다음 페이지들을 받아 임시 행으로 쌓는다. 끝 페이지까지 받으면 snapshot을 만든다.
 * 배경 수집과 관리자 수동 수집이 겹치지 않도록 임대(lease)를 잡은 쪽만 진행한다.
 */
export async function advanceRun(db: SqlDatabase, initial: FiscalRun, deps: FiscalDeps, maxPages = 12): Promise<FiscalRun> {
  const token = deps.newId();
  const now = deps.now();
  await db.prepare("UPDATE fiscal_collection_run SET lease_token = ?, lease_expires_at = ? WHERE run_id = ? AND status = 'RUNNING' AND (lease_token = '' OR lease_expires_at < ?)")
    .bind(token, now + LEASE_SECONDS, initial.run_id, now).run();
  const claimed = await readRun(db, initial.run_id);
  if (!claimed || claimed.lease_token !== token) return claimed ?? initial;
  let result: FiscalRun;
  try {
    result = await advanceClaimed(db, claimed, deps, maxPages);
  } finally {
    await db.prepare("UPDATE fiscal_collection_run SET lease_token = '', lease_expires_at = 0 WHERE run_id = ? AND lease_token = ?").bind(initial.run_id, token).run();
  }
  return (await readRun(db, initial.run_id)) ?? result;
}

async function advanceClaimed(db: SqlDatabase, initial: FiscalRun, deps: FiscalDeps, maxPages: number): Promise<FiscalRun> {
  const scope = await readScope(db, initial.scope_id);
  if (!scope) {
    await updateRun(db, initial.run_id, { status: "FAILED", error_code: "SCOPE_MISSING", finished_at: deps.now(), updated_at: deps.now() });
    return (await readRun(db, initial.run_id)) ?? initial;
  }
  const query = scopeQuery(scope, initial.fiscal_year, initial.requested_reference_date);
  const started = Date.now();
  const budget = deps.stepBudgetMs ?? 15_000;
  let run = initial;
  // 페이지를 다 받은 run은 이 단계 전체를 snapshot 만들기에 쓴다(응답 뒤 작업 시간 한도 안에 끝내기 위해).
  if (run.pages_expected !== null && run.next_page > run.pages_expected) return finalizeRun(db, run, scope, deps);
  for (let fetched = 0; fetched < maxPages && run.status === "RUNNING"; fetched += 1) {
    if (fetched > 0 && Date.now() - started > budget) break;
    const finish = async (status: string, errorCode: string) => {
      await updateRun(db, run.run_id, { status, error_code: errorCode, finished_at: deps.now(), updated_at: deps.now() });
      if (status !== "RUNNING") await db.prepare("DELETE FROM fiscal_staging_row WHERE run_id = ?").bind(run.run_id).run();
    };
    let page;
    const fetchStarted = Date.now();
    try {
      const response = await deps.fetcher(buildQwgjkUrl(query, run.next_page, run.page_size, deps.apiKey ?? undefined));
      page = parseQwgjkResponse(response.status, response.headers.get("content-type") ?? "", await response.text());
    } catch {
      page = { kind: "error" as const, code: "NETWORK_ERROR", retryable: true };
    }
    const fetchMs = Date.now() - fetchStarted;
    if (page.kind === "error") {
      // 발급 키(쪽당 500건) 응답이 느려 시간 초과(NETWORK_ERROR)가 나면 쪽 크기를 줄여 이어 받는다(500→250→125→25).
      // 이미 받은 행 수가 새 쪽 크기로 나누어떨어지는 경계에서만 바꿔, 쪽 번호를 다시 계산해도 겹치거나 빠지는 행이 없다.
      const smaller = page.code === "NETWORK_ERROR" ? SHRINK_STEPS.find((size) => size < run.page_size && run.received_rows % size === 0) : undefined;
      if (smaller !== undefined && run.page_size > smaller) {
        await updateRun(db, run.run_id, {
          page_size: smaller, next_page: run.received_rows / smaller + 1,
          pages_expected: run.total_count === null ? null : Math.ceil(run.total_count / smaller),
          error_code: "NETWORK_ERROR_PAGE_SIZE_" + smaller, updated_at: deps.now(),
        });
        return (await readRun(db, run.run_id)) ?? run;
      }
      if (page.retryable && run.retry_count < MAX_RETRIES) {
        await updateRun(db, run.run_id, { retry_count: run.retry_count + 1, error_code: page.code, updated_at: deps.now() });
      } else {
        await finish("FAILED", page.code);
      }
      return (await readRun(db, run.run_id)) ?? run;
    }
    if (page.kind === "empty") {
      await finish(run.next_page === 1 ? "EMPTY" : "INCONSISTENT", run.next_page === 1 ? "INFO-200" : "EMPTY_PAGE_MID_RUN");
      return (await readRun(db, run.run_id)) ?? run;
    }
    if (run.total_count !== null && page.total !== run.total_count) {
      await finish("INCONSISTENT", "TOTAL_CHANGED");
      return (await readRun(db, run.run_id)) ?? run;
    }
    if (page.rows.length > run.page_size) {
      await finish("INCONSISTENT", "PAGE_SIZE_EXCEEDED");
      return (await readRun(db, run.run_id)) ?? run;
    }
    const keyed = page.rows.map((row) => ({ key: qwgjkRowKey(row), row }));
    const unique = new Map(keyed.map((item) => [item.key, item.row]));
    // 같은 페이지를 다시 받은 경우(중단 후 재시도)는 중복이 아니다. 다른 페이지에 이미 있는 키만 중복으로 센다.
    const keys = [...unique.keys()];
    let existing = 0;
    for (let start = 0; start < keys.length; start += KEY_QUERY_CHUNK) {
      const part = keys.slice(start, start + KEY_QUERY_CHUNK);
      existing += (await db.prepare("SELECT COUNT(*) AS total FROM fiscal_staging_row WHERE run_id = ? AND page <> ? AND row_key IN (" + marks(part.length) + ")")
        .bind(run.run_id, run.next_page, ...part).first<{ total: number }>())?.total ?? 0;
    }
    const statements = [...unique.entries()].map(([key, row]) =>
      db.prepare("INSERT OR IGNORE INTO fiscal_staging_row (run_id, row_key, page, payload) VALUES (?, ?, ?, ?)").bind(run.run_id, key, run.next_page, JSON.stringify(row)));
    if (statements.length) await db.batch(statements);
    const total = page.total;
    const pagesExpected = Math.ceil(total / run.page_size);
    await updateRun(db, run.run_id, {
      total_count: total, pages_expected: pagesExpected, next_page: run.next_page + 1,
      received_rows: run.received_rows + page.rows.length, invalid_rows: run.invalid_rows + page.invalidRows,
      duplicate_rows: run.duplicate_rows + (keyed.length - unique.size) + existing, retry_count: 0, error_code: "", updated_at: deps.now(),
    });
    run = (await readRun(db, run.run_id)) ?? run;
    if (run.next_page > (run.pages_expected ?? 0)) {
      // 남은 시간이 넉넉할 때만 같은 단계에서 마무리하고, 아니면 다음 단계로 넘긴다.
      return Date.now() - started < budget / 3 ? finalizeRun(db, run, scope, deps) : run;
    }
    // 시간 초과로 줄였던 쪽 크기는 응답이 다시 빨라지면(2.5초 미만) 한 단계씩 되돌린다(25→125→250→500).
    // 줄일 때와 같이 이미 받은 행 수가 새 쪽 크기로 나누어떨어지는 경계에서만 바꿔 겹치거나 빠지는 행이 없게 한다.
    const larger = run.access_tier === "ISSUED_KEY" && fetchMs < (deps.growBelowMs ?? GROW_BELOW_MS) ? GROW_STEPS.find((size) => size > run.page_size && run.received_rows % size === 0) : undefined;
    if (larger !== undefined) {
      await updateRun(db, run.run_id, {
        page_size: larger, next_page: run.received_rows / larger + 1,
        pages_expected: run.total_count === null ? null : Math.ceil(run.total_count / larger), updated_at: deps.now(),
      });
      run = (await readRun(db, run.run_id)) ?? run;
    }
  }
  return run;
}

function amountColumns(raw: unknown) {
  const normalized = normalizeWon(raw);
  return { raw: raw === undefined || raw === null ? null : JSON.stringify(raw), value: normalized.value, problem: normalized.problem };
}

function formatYmd(value: string): string | null {
  return /^\d{8}$/.test(value) ? value.slice(0, 4) + "-" + value.slice(4, 6) + "-" + value.slice(6, 8) : null;
}

/** 모든 페이지를 받은 뒤 총건수·고유키·무효행을 검증하고 snapshot을 만든다. 승인된 범위면 바로 공개한다. */
export async function finalizeRun(db: SqlDatabase, run: FiscalRun, scope: FiscalScope, deps: FiscalDeps): Promise<FiscalRun> {
  const now = deps.now();
  const started = Date.now();
  const budget = deps.finalizeBudgetMs ?? deps.stepBudgetMs ?? 15_000;
  const stagedCount = (await db.prepare("SELECT COUNT(*) AS n FROM fiscal_staging_row WHERE run_id = ?").bind(run.run_id).first<{ n: number }>())?.n ?? 0;
  const fail = async (code: string) => {
    await updateRun(db, run.run_id, { status: "INCONSISTENT", error_code: code, finished_at: now, updated_at: now });
    await db.prepare("DELETE FROM fiscal_staging_row WHERE run_id = ?").bind(run.run_id).run();
    return (await readRun(db, run.run_id)) ?? run;
  };
  if (run.invalid_rows > 0) return fail("INVALID_ROWS");
  if (run.duplicate_rows > 0) return fail("DUPLICATE_KEYS");
  if (stagedCount !== run.total_count) return fail("COUNT_MISMATCH");

  const snapshotId = "fs:" + run.run_id;
  // 발급 키 범위는 수천 건이라 응답 뒤 작업 시간(약 30초) 안에 한 번에 옮기지 못한다. 아직 옮기지 않은 행을 FINALIZE_CHUNK건씩 옮기고,
  // 시간이 모자라면 RUNNING 그대로 다음 단계로 넘긴다. 옮긴 행은 snapshot 구성원(PK)으로 알아보므로 다시 해도 겹치지 않는다(INSERT OR IGNORE).
  for (;;) {
    const chunk = (await db.prepare(
      "SELECT s.row_key, s.payload FROM fiscal_staging_row s WHERE s.run_id = ? AND NOT EXISTS (SELECT 1 FROM fiscal_snapshot_member m WHERE m.snapshot_id = ? AND m.fiscal_project_id = 'fp:' || s.row_key) ORDER BY s.page, s.row_key LIMIT ?",
    ).bind(run.run_id, snapshotId, FINALIZE_CHUNK).all<{ row_key: string; payload: string }>()).results;
    if (!chunk.length) break;
    // 자치단체·부서·코드 기록은 한 묶음 안에서 같은 값이 반복되므로 키마다 한 번만 쓴다(행별 기록보다 먼저 실행).
    const shared = new Map<string, SqlStatement>();
    const statements: SqlStatement[] = [];
    for (const { row_key: rowKey, payload } of chunk) {
      const row = JSON.parse(payload) as QwgjkRow;
      const entityId = "lofin:laf:" + row.laf_cd;
      const departmentId = "lofin:dept:" + row.laf_cd + ":" + row.dept_cd;
      const projectId = "fp:" + rowKey;
      const observationId = "fo:" + run.run_id + ":" + rowKey;
      shared.set("entity:" + entityId,
        db.prepare(
          "INSERT INTO fiscal_entity (fiscal_entity_id, code_system, code, name, wa_code, wa_name, padm_code, first_seen_at, last_seen_at) VALUES (?, 'LOFIN_LAF_CD', ?, ?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(fiscal_entity_id) DO UPDATE SET name = excluded.name, wa_code = excluded.wa_code, wa_name = excluded.wa_name, padm_code = excluded.padm_code, last_seen_at = excluded.last_seen_at",
        ).bind(entityId, row.laf_cd, row.laf_hg_nm, row.wa_laf_cd, row.wa_laf_hg_nm, row.padm_laf_cd, now, now));
      if (!shared.has("dept:" + departmentId)) shared.set("dept:" + departmentId,
        db.prepare(
          "INSERT INTO fiscal_department (fiscal_department_id, fiscal_entity_id, code_system, code, name, first_seen_at, last_seen_at) VALUES (?, ?, 'LOFIN_DEPT_CD', ?, NULL, ?, ?) " +
            "ON CONFLICT(fiscal_department_id) DO UPDATE SET last_seen_at = excluded.last_seen_at",
        ).bind(departmentId, entityId, row.dept_cd, now, now));
      for (const [system, code, name] of [["LOFIN_FIELD", row.fld_cd, row.fld_nm], ["LOFIN_PART", row.ane_part_cd, row.part_nm], ["LOFIN_ACCOUNT", row.acnt_dv_cd, row.acnt_dv_nm]] as const) {
        const key = "code:" + system + ":" + code + ":" + row.fyr;
        if (!shared.has(key)) shared.set(key,
          db.prepare("INSERT OR IGNORE INTO fiscal_code_version (code_system, code, fiscal_year, name, source, first_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(system, code, row.fyr, name, CONTRACT_VERSION, now));
      }
      statements.push(
        db.prepare(
          "INSERT INTO fiscal_project (fiscal_project_id, fiscal_year, fiscal_entity_id, account_code, account_name, department_code, dbiz_code, name, field_code, field_name, part_code, part_name, first_seen_at, last_seen_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(fiscal_project_id) DO UPDATE SET name = excluded.name, account_name = excluded.account_name, " +
            "field_code = excluded.field_code, field_name = excluded.field_name, part_code = excluded.part_code, part_name = excluded.part_name, last_seen_at = excluded.last_seen_at",
        ).bind(projectId, row.fyr, entityId, row.acnt_dv_cd, row.acnt_dv_nm, row.dept_cd, row.dbiz_cd, row.dbiz_nm, row.fld_cd, row.fld_nm, row.ane_part_cd, row.part_nm, now, now),
      );
      const budget = amountColumns(row.amounts.bdg_cash_amt);
      const expenditure = amountColumns(row.amounts.ep_amt);
      const national = amountColumns(row.amounts.bdg_ntep);
      const province = amountColumns(row.amounts.capep);
      const municipal = amountColumns(row.amounts.sggep);
      const other = amountColumns(row.amounts.etc_amt);
      const problems = Object.entries({ bdg_cash_amt: budget, ep_amt: expenditure, bdg_ntep: national, capep: province, sggep: municipal, etc_amt: other })
        .filter(([, amount]) => amount.problem).map(([field, amount]) => field + ":" + amount.problem);
      statements.push(
        db.prepare(
          "INSERT OR IGNORE INTO fiscal_observation (observation_id, fiscal_project_id, run_id, reference_date, source_exe_ymd, current_budget_raw, current_budget_krw, public_expenditure_raw, public_expenditure_krw, " +
            "national_raw, national_krw, province_raw, province_krw, municipal_raw, municipal_krw, other_raw, other_krw, compiled_raw, amount_problems, source_amount_unit, unit_verification, normalization_rule_id, contract_version, created_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          observationId, projectId, run.run_id, run.requested_reference_date, row.exe_ymd, budget.raw, budget.value, expenditure.raw, expenditure.value,
          national.raw, national.value, province.raw, province.value, municipal.raw, municipal.value, other.raw, other.value,
          row.amounts.cpl_amt === undefined || row.amounts.cpl_amt === null ? null : JSON.stringify(row.amounts.cpl_amt),
          JSON.stringify(problems), SOURCE_UNIT, UNIT_VERIFICATION, NORMALIZATION_RULE_ID, CONTRACT_VERSION, now,
        ),
        db.prepare("INSERT OR IGNORE INTO fiscal_snapshot_member (snapshot_id, fiscal_project_id, observation_id) VALUES (?, ?, ?)").bind(snapshotId, projectId, observationId),
      );
    }
    statements.unshift(...shared.values());
    for (let start = 0; start < statements.length; start += BATCH_SIZE) await db.batch(statements.slice(start, start + BATCH_SIZE));
    if (Date.now() - started > budget) {
      await updateRun(db, run.run_id, { updated_at: deps.now() });
      return (await readRun(db, run.run_id)) ?? run;
    }
  }
  const dates = new Set((await db.prepare("SELECT DISTINCT json_extract(payload, '$.exe_ymd') AS d FROM fiscal_staging_row WHERE run_id = ?").bind(run.run_id).all<{ d: string }>()).results.map((item) => item.d));
  const onlyDate = dates.size === 1 ? formatYmd([...dates][0]) : null;
  const echoed = onlyDate === run.requested_reference_date;
  const note = dates.size > 1
    ? "원천 행의 집행일자가 여러 날짜로 섞여 있어 단일 기준일을 붙이지 않았습니다."
    : echoed
      ? "원천은 요청한 집행일자를 각 행에 그대로 돌려줍니다. 휴일 등 실제 갱신이 없는 날은 직전 갱신값과 같을 수 있습니다."
      : "원천 행의 집행일자가 요청일과 다릅니다.";
  const publish = scope.approval_status === "POLICY_APPROVED";
  await db.batch([
    db.prepare("UPDATE fiscal_snapshot SET status = 'SUPERSEDED', status_reason = '같은 기준일의 새 snapshot으로 대체' WHERE scope_id = ? AND requested_reference_date = ? AND status IN ('PUBLISHED', 'CANDIDATE')")
      .bind(scope.scope_id, run.requested_reference_date),
    db.prepare(
      "INSERT INTO fiscal_snapshot (snapshot_id, scope_id, run_id, fiscal_year, requested_reference_date, effective_reference_date, reference_date_note, access_tier, expected_count, unique_count, complete, status, status_reason, created_at, published_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
    ).bind(
      snapshotId, scope.scope_id, run.run_id, run.fiscal_year, run.requested_reference_date, onlyDate, note, run.access_tier, run.total_count ?? 0, stagedCount,
      publish ? "PUBLISHED" : "CANDIDATE", publish ? "승인된 범위의 완전 수집" : "범위 공개 승인 전", now, publish ? now : null,
    ),
    db.prepare("UPDATE fiscal_collection_run SET status = 'SUCCEEDED', snapshot_id = ?, finished_at = ?, updated_at = ? WHERE run_id = ?").bind(snapshotId, now, now, run.run_id),
    db.prepare("DELETE FROM fiscal_staging_row WHERE run_id = ?").bind(run.run_id),
  ]);
  return (await readRun(db, run.run_id)) ?? run;
}

/** 범위 공개 승인/해제. 승인하면 그 범위의 완전한 후보 snapshot을 공개하고, 해제하면 공개를 내린다. */
export async function setScopeApproval(db: SqlDatabase, scopeId: string, approve: boolean, nowSeconds: number): Promise<void> {
  await db.batch(approve
    ? [
      db.prepare("UPDATE fiscal_scope SET approval_status = 'POLICY_APPROVED', approved_at = ? WHERE scope_id = ?").bind(nowSeconds, scopeId),
      db.prepare("UPDATE fiscal_snapshot SET status = 'PUBLISHED', status_reason = '범위 공개 승인', published_at = ? WHERE scope_id = ? AND status = 'CANDIDATE' AND complete = 1").bind(nowSeconds, scopeId),
    ]
    : [
      db.prepare("UPDATE fiscal_scope SET approval_status = 'REVOKED', approved_at = NULL WHERE scope_id = ?").bind(scopeId),
      db.prepare("UPDATE fiscal_snapshot SET status = 'CANDIDATE', status_reason = '범위 공개 승인 해제', published_at = NULL WHERE scope_id = ? AND status = 'PUBLISHED'").bind(scopeId),
    ]);
}
