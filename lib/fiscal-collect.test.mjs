// 지방재정 수집·조회: 2026-10-04 실제 QWGJK 응답 형식을 본뜬 가짜 응답과 실제 마이그레이션 SQLite로 시험한다.
import assert from "node:assert/strict";
import test from "node:test";

import { aggregateExecution, executionRate, normalizeWon } from "./fiscal/amount.ts";
import { advanceRun, readScope, setScopeApproval, startRun } from "./fiscal/collect.ts";
import { fiscalCodeHistory } from "./fiscal/history.ts";
import { parseQwgjkResponse } from "./fiscal/qwgjk.ts";
import { chooseSnapshot, fiscalCatalog, projectDto, snapshotProjects, snapshotSummary } from "./fiscal/query.ts";
import { NOW, database } from "./press-test-support.mjs";

const SCOPE = "qwgjk:integrated-care-name";

function qwgjkRow(index, overrides = {}) {
  return {
    fyr: "2026", wa_laf_cd: "4900000", wa_laf_hg_nm: "제주", laf_cd: "4900000", laf_hg_nm: "제주본청", acnt_dv_cd: "100", acnt_dv_nm: "일반회계",
    dept_cd: index === 1 ? "4005301" : "3005407", dbiz_cd: "650000020073" + String(index).padStart(4, "0"), dbiz_nm: "통합돌봄 사업 " + index,
    exe_ymd: "20261003", bdg_cash_amt: 1000 * index, bdg_ntep: 0, capep: 1000 * index, sggep: 0, etc_amt: 0, ep_amt: 333 * index, cpl_amt: 1000 * index,
    fld_cd: "080", fld_nm: "사회복지", ane_part_cd: "082", part_nm: "노인", padm_laf_cd: "6500000", lup_ord: 91300, zon_cd: "49", ...overrides,
  };
}

function page(rows, total) {
  return JSON.stringify({ QWGJK: [{ head: [{ list_total_count: total }, { RESULT: { CODE: "INFO-000", MESSAGE: "정상 처리되었습니다." } }] }, { row: rows }] });
}

function fakeFetcher(pages) {
  const calls = [];
  return {
    calls,
    fetcher: async (url) => {
      calls.push(url);
      const pIndex = Number(new URL(url).searchParams.get("pIndex"));
      const body = typeof pages === "function" ? pages(pIndex) : pages[pIndex - 1];
      return { status: 200, headers: { get: () => "application/json;charset=UTF-8" }, text: async () => body };
    },
  };
}

function deps(fetcher, apiKey = null) {
  let id = 0;
  return { fetcher, now: () => NOW, newId: () => "run-" + ++id, apiKey, stepBudgetMs: 60_000 };
}

test("금액은 원 단위 정수 문자열로만 정규화하고 비율은 0으로 나누지 않는다", () => {
  assert.deepEqual(normalizeWon(107320000), { value: "107320000", precision: "integer_krw" });
  assert.equal(normalizeWon("9007199254740993").value, "9007199254740993");
  assert.equal(normalizeWon(12.5).problem, "NON_INTEGER");
  assert.equal(normalizeWon(null).problem, "MISSING");
  assert.equal(executionRate("80376600", "107320000").value, "74.89");
  assert.equal(executionRate("1", "3").value, "33.33");
  assert.equal(executionRate("2", "3").value, "66.67");
  assert.equal(executionRate("150", "100").value, "150.00");
  assert.deepEqual(executionRate("0", "0"), { value: null, reason: "BUDGET_ZERO" });
  const total = aggregateExecution([{ budget: "100", expenditure: "50" }, { budget: "300", expenditure: null }, { budget: "100", expenditure: "100" }]);
  assert.equal(total.current_budget_krw, "200");
  assert.equal(total.execution_rate_pct.value, "75.00");
  assert.equal(total.excluded_rows, 1);
});

test("HTTP 200의 인증 오류·필수값 누락은 빈 자료가 아니라 오류로 읽는다", () => {
  const error = (code) => JSON.stringify({ RESULT: [{ CODE: code, MESSAGE: "x" }] });
  assert.deepEqual(parseQwgjkResponse(200, "application/json", error("ERROR-290")), { kind: "error", code: "ERROR-290", retryable: false });
  assert.deepEqual(parseQwgjkResponse(200, "application/json", error("ERROR-500")), { kind: "error", code: "ERROR-500", retryable: true });
  assert.deepEqual(parseQwgjkResponse(200, "application/json", error("INFO-200")), { kind: "empty" });
  assert.equal(parseQwgjkResponse(200, "text/html", "<html>login</html>").code, "NOT_JSON");
  const parsed = parseQwgjkResponse(200, "application/json", page([qwgjkRow(1), qwgjkRow(2, { dept_cd: 4005301 })], 2));
  assert.equal(parsed.kind, "rows");
  assert.equal(parsed.rows.length, 1, "숫자로 온 코드는 앞자리 0 보존을 확인할 수 없어 받지 않는다");
  assert.equal(parsed.invalidRows, 1);
});

test("표본키로 모든 페이지를 받아 총건수가 맞으면 후보 snapshot을 만들고, 승인하면 공개한다", async () => {
  const db = database();
  const rows = Array.from({ length: 7 }, (_, index) => qwgjkRow(index + 1));
  const fake = fakeFetcher((pIndex) => page(rows.slice((pIndex - 1) * 5, pIndex * 5), 7));
  const scope = await readScope(db, SCOPE);
  const run = await startRun(db, scope, "2026-10-03", "manual", deps(fake.fetcher));
  assert.equal(run.page_size, 5);
  assert.equal(run.access_tier, "SAMPLE_KEY");
  const done = await advanceRun(db, run, deps(fake.fetcher));
  assert.equal(done.status, "SUCCEEDED", JSON.stringify(done));
  assert.equal(fake.calls.length, 2);
  assert.ok(fake.calls.every((url) => !url.includes("Key=")), "표본키 호출에는 키를 붙이지 않는다");
  assert.ok(fake.calls[0].includes("dbiz_nm=%ED%86%B5%ED%95%A9%EB%8F%8C%EB%B4%84"));

  assert.equal((await chooseSnapshot(db, "integrated_care", "2026", undefined)).snapshot, null, "승인 전에는 공개하지 않는다");
  await setScopeApproval(db, SCOPE, true, NOW);
  const choice = await chooseSnapshot(db, "integrated_care", "2026", "2026-10-05");
  assert.equal(choice.snapshot.snapshot_id, done.snapshot_id);
  assert.equal(choice.fallback_used, true);
  assert.equal(choice.snapshot.effective_reference_date, "2026-10-03");
  assert.equal((await chooseSnapshot(db, "integrated_care", "2026", "2026-10-20")).reason, "NO_SNAPSHOT_WITHIN_FALLBACK_WINDOW");

  const summary = await snapshotSummary(db, done.snapshot_id, {});
  assert.equal(summary.matching_rows, 7);
  assert.equal(summary.current_budget_krw, "28000");
  assert.equal(summary.public_expenditure_krw, "9324");
  assert.equal(summary.execution_rate_pct, "33.30");
  const department = await snapshotProjects(db, done.snapshot_id, { departmentCodes: ["4005301"] }, 0, 20);
  assert.equal(department.total, 1);
  const dto = projectDto(department.rows[0]);
  assert.equal(dto.current_budget_krw, "1000");
  assert.equal(dto.evidence.source_fields.current_budget_krw, "bdg_cash_amt");
  assert.equal(dto.unit_verification, "UNVERIFIED_IN_SCOPE");
  const classes = await fiscalCatalog(db, done.snapshot_id, "classification", {});
  assert.deepEqual(classes.map((row) => [row.field_code, row.field_name]), [["080", "사회복지"]]);
});

test("수집 중 총건수가 바뀌거나 오류가 오면 snapshot을 만들지 않는다", async () => {
  const db = database();
  const scope = await readScope(db, SCOPE);
  const changing = fakeFetcher((pIndex) => page([qwgjkRow(pIndex)], pIndex === 1 ? 2 : 3));
  const changingDeps = deps(changing.fetcher);
  const run = await startRun(db, scope, "2026-10-03", "manual", changingDeps);
  db.sqlite.prepare("UPDATE fiscal_collection_run SET page_size = 1 WHERE run_id = ?").run(run.run_id);
  const inconsistent = await advanceRun(db, { ...run, page_size: 1 }, changingDeps);
  assert.equal(inconsistent.status, "INCONSISTENT");
  assert.equal(inconsistent.error_code, "TOTAL_CHANGED");
  assert.equal(inconsistent.snapshot_id, null);

  const denied = fakeFetcher(() => JSON.stringify({ RESULT: [{ CODE: "ERROR-290", MESSAGE: "인증키가 유효하지 않습니다." }] }));
  const deniedDeps = { ...deps(denied.fetcher, "bad-key-value"), newId: () => "run-denied" };
  const second = await startRun(db, scope, "2026-10-04", "manual", deniedDeps);
  assert.equal(second.access_tier, "ISSUED_KEY");
  const failed = await advanceRun(db, second, deniedDeps);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.error_code, "ERROR-290");
  const stored = JSON.stringify(db.sqlite.prepare("SELECT * FROM fiscal_collection_run").all());
  assert.ok(!stored.includes("bad-key-value"), "인증키 값은 기록하지 않는다");
});

test("발급 키가 필요한 범위는 키 없이 시작하면 BLOCKED로 남긴다", async () => {
  const db = database();
  const scope = await readScope(db, "qwgjk:jeju-full");
  const run = await startRun(db, scope, "2026-10-03", "scheduled", deps(fakeFetcher([]).fetcher));
  assert.equal(run.status, "BLOCKED");
  assert.equal(run.error_code, "KEY_REQUIRED");
});

test("발급 키 쪽당 500건 응답이 시간 초과되면 쪽 크기를 줄여 빠짐·겹침 없이 이어 받는다", async () => {
  const db = database();
  const scope = await readScope(db, SCOPE);
  const rows = Array.from({ length: 600 }, (_, index) => qwgjkRow(index + 1));
  const calls = [];
  const fetcher = async (url) => {
    const params = new URL(url).searchParams;
    const size = Number(params.get("pSize"));
    const index = Number(params.get("pIndex"));
    calls.push(size + ":" + index);
    // 500건 쪽은 첫 쪽만 받고, 그다음부터는 시간 초과를 흉내 낸다.
    if (size === 500 && index > 1) throw new Error("The operation was aborted");
    const body = page(rows.slice((index - 1) * size, index * size), rows.length);
    return { status: 200, headers: { get: () => "application/json" }, text: async () => body };
  };
  const keyDeps = { ...deps(fetcher, "issued-key-value"), newId: () => "run-shrink-" + calls.length };
  let run = await startRun(db, scope, "2026-10-03", "manual", keyDeps);
  assert.equal(run.page_size, 500);
  for (let step = 0; step < 6 && run.status === "RUNNING"; step += 1) run = await advanceRun(db, run, keyDeps);
  assert.equal(run.status, "SUCCEEDED", JSON.stringify(run));
  assert.equal(run.page_size, 250, "500건 받은 뒤 250으로 줄여 501~600번째를 3쪽(250건 단위)으로 받는다");
  assert.deepEqual(calls, ["500:1", "500:2", "250:3"]);
  assert.equal(run.received_rows, 600);
  assert.equal(run.duplicate_rows, 0);
});

test("행이 많으면 snapshot 만들기를 여러 단계로 나눠 하고, 다시 해도 겹치지 않는다", async () => {
  const db = database();
  const scope = await readScope(db, SCOPE);
  const rows = Array.from({ length: 650 }, (_, index) => qwgjkRow(index + 1));
  const fetcher = async (url) => {
    const params = new URL(url).searchParams;
    const size = Number(params.get("pSize"));
    const index = Number(params.get("pIndex"));
    const body = page(rows.slice((index - 1) * size, index * size), rows.length);
    return { status: 200, headers: { get: () => "application/json" }, text: async () => body };
  };
  // 시간 예산을 음수로 줘서 매 단계 한 덩어리(300건)만 옮기고 넘기게 한다.
  const slow = { ...deps(fetcher, "issued-key-value"), stepBudgetMs: -1, newId: () => "run-chunk" };
  let run = await startRun(db, scope, "2026-10-03", "manual", slow);
  const states = [];
  for (let step = 0; step < 10 && run.status === "RUNNING"; step += 1) {
    run = await advanceRun(db, run, slow);
    states.push(run.status + ":" + db.sqlite.prepare("SELECT COUNT(*) AS n FROM fiscal_snapshot_member").get().n);
  }
  assert.equal(run.status, "SUCCEEDED", states.join(" "));
  assert.ok(states.filter((state) => state.startsWith("RUNNING")).length >= 3, "여러 단계로 나뉜다: " + states.join(" "));
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM fiscal_snapshot_member WHERE snapshot_id = ?").get(run.snapshot_id).n, 650);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM fiscal_observation WHERE run_id = ?").get(run.run_id).n, 650);
  assert.equal(db.sqlite.prepare("SELECT unique_count FROM fiscal_snapshot WHERE snapshot_id = ?").get(run.snapshot_id).unique_count, 650);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM fiscal_staging_row WHERE run_id = ?").get(run.run_id).n, 0);
});

test("두 회계연도 snapshot을 코드 그대로 비교해 부서 신설·폐지, 사업 이관·명칭 변경 후보를 낸다", async () => {
  const db = database();
  const scope = await readScope(db, SCOPE);
  await setScopeApproval(db, SCOPE, true, NOW);
  const byYear = {
    2025: [qwgjkRow(1, { fyr: "2025", dept_cd: "0100001" }), qwgjkRow(2, { fyr: "2025", dept_cd: "0100002" }), qwgjkRow(3, { fyr: "2025", dept_cd: "0100002", dbiz_nm: "옛 이름" })],
    2026: [qwgjkRow(1, { dept_cd: "0100001" }), qwgjkRow(2, { dept_cd: "0100009" }), qwgjkRow(3, { dept_cd: "0100002", dbiz_nm: "새 이름" }), qwgjkRow(4, { dept_cd: "0100009" })],
  };
  const fetcher = async (url) => {
    const rows = byYear[new URL(url).searchParams.get("fyr")];
    const body = page(rows, rows.length);
    return { status: 200, headers: { get: () => "application/json" }, text: async () => body };
  };
  for (const date of ["2025-12-31", "2026-10-03"]) {
    const d = { ...deps(fetcher), newId: () => "run-" + date };
    db.sqlite.prepare("UPDATE fiscal_collection_run SET status = 'SUCCEEDED' WHERE status = 'RUNNING'").run();
    let run = await startRun(db, scope, date, "history", d);
    for (let step = 0; step < 5 && run.status === "RUNNING"; step += 1) run = await advanceRun(db, run, d);
    assert.equal(run.status, "SUCCEEDED", date);
  }
  const history = await fiscalCodeHistory(db, SCOPE);
  assert.deepEqual(history.years, ["2025", "2026"]);
  assert.deepEqual(history.departments.added, ["lofin:laf:4900000:0100009"], "앞자리 0을 지킨 문자열 코드");
  assert.deepEqual(history.departments.removed, []);
  assert.deepEqual([history.projects.previous, history.projects.current, history.projects.continuing, history.projects.added], [3, 4, 3, 1]);
  assert.equal(history.transfers.total, 1);
  assert.deepEqual([history.transfers.items[0].previous_departments, history.transfers.items[0].current_departments], [["0100002"], ["0100009"]]);
  assert.deepEqual(history.renamed.items.map((item) => [item.previous_name, item.current_name]), [["옛 이름", "새 이름"]]);
});


test("다른 수집이 임대를 잡고 있으면 같은 run을 동시에 진행하지 않고, 같은 페이지 재수신은 중복으로 세지 않는다", async () => {
  const db = database();
  const scope = await readScope(db, SCOPE);
  const rows = Array.from({ length: 6 }, (_, index) => qwgjkRow(index + 1));
  const fake = fakeFetcher((pIndex) => page(rows.slice((pIndex - 1) * 5, pIndex * 5), 6));
  let counter = 0;
  const shared = { ...deps(fake.fetcher), newId: () => "id-" + ++counter };
  const run = await startRun(db, scope, "2026-10-03", "manual", shared);
  db.sqlite.prepare("UPDATE fiscal_collection_run SET lease_token = 'other', lease_expires_at = ? WHERE run_id = ?").run(NOW + 60, run.run_id);
  const skipped = await advanceRun(db, run, shared);
  assert.equal(skipped.next_page, 1);
  assert.equal(fake.calls.length, 0);
  db.sqlite.prepare("UPDATE fiscal_collection_run SET lease_token = '', lease_expires_at = 0 WHERE run_id = ?").run(run.run_id);
  const first = await advanceRun(db, run, shared, 1);
  assert.equal(first.next_page, 2);
  db.sqlite.prepare("UPDATE fiscal_collection_run SET next_page = 1 WHERE run_id = ?").run(run.run_id);
  const done = await advanceRun(db, { ...first, next_page: 1 }, shared);
  assert.equal(done.status, "SUCCEEDED", JSON.stringify(done));
  assert.equal(done.duplicate_rows, 0);
  assert.equal(done.lease_token, "");
});
