import assert from "node:assert/strict";
import test from "node:test";
import { hydrateGov24Details, GOV24_DETAIL_HYDRATION_VERSION } from "./integrations/gov24-detail-hydration.ts";
import { advanceRun, startRun } from "./integrations/runner.ts";
import { recordHash } from "./integrations/store.ts";
import { database, NOW, response } from "./press-test-support.mjs";

const ID = "WLF-HYDRATION";
const VERSION = "20261001123000";
const SHARED = { purpose: "서비스목적", target: "지원대상", criteria: "선정기준", benefit: "지원내용", apply_method: "신청방법", apply_deadline: "신청기한", reception: "접수기관명", contact: "문의처" };
const META = ["detail_hydration_status", "detail_hydration_reason", "detail_hydration_record_id", "detail_hydration_record_hash", "detail_hydration_run_id", "detail_hydration_version"];

function listRow(version = VERSION) {
  return {
    서비스ID: ID, 서비스명: "목록에 기재된 사업명", 소관기관명: "제주특별자치도", 소관기관유형: "지방자치단체", 수정일시: version,
    서비스목적요약: "목록 목적", 지원대상: "목록 대상", 선정기준: "목록 기준", 지원내용: "목록 내용",
    신청방법: "목록 신청", 신청기한: "목록 기한", 접수기관: "목록 접수", 전화문의: "목록 문의",
    상세조회URL: "https://www.gov.kr/portal/rcvfvrSvc/dtlEx/" + ID,
  };
}

function detailRow(overrides = {}) {
  return {
    서비스ID: ID, 서비스명: "상세 원문 사업명", 소관기관명: "상세 원문 기관명", 수정일시: VERSION,
    서비스목적: "2026년 상세 목적", 지원대상: "2026년 돌봄이 필요한 도민", 선정기준: "2026년 상세 선정기준", 지원내용: "2026년 상세 지원내용",
    신청방법: "2026년 상세 신청절차", 신청기한: "2026년 상세 신청기간", 접수기관명: "상세 접수창구", 문의처: "상세 문의처",
    구비서류: "상세 구비서류", 온라인신청사이트URL: "https://www.gov.kr/apply/example", 법령: "원문 법령", 자치법규: "원문 조례", 행정규칙: "원문 규칙",
    ...overrides,
  };
}

async function fixture(detailOverrides = {}) {
  const db = database();
  const state = { now: NOW, counter: 0, detailCalls: 0, list: listRow(), detail: detailRow(detailOverrides) };
  const deps = {
    now: () => state.now, newId: () => "hydration-run-" + ++state.counter, keyFor: async () => "TEST_ONLY_KEY",
    owner: "hydration-test", stepBudgetMs: 60_000, queueCap: 10,
    fetcher: async (url) => {
      const list = new URL(url).pathname.endsWith("serviceList");
      if (!list) state.detailCalls++;
      return response(200, JSON.stringify({ page: 1, perPage: list ? 500 : 1, totalCount: 1, currentCount: 1, data: [list ? state.list : state.detail] }), { "content-type": "application/json" });
    },
  };
  const run = async (dataset) => {
    const { runId } = await startRun(db, deps, dataset, dataset.endsWith("_list") ? "all" : "queue", "test");
    return advanceRun(db, deps, runId);
  };
  assert.equal(await run("mois.gov24_list"), "SUCCEEDED");
  state.now++;
  assert.equal(await run("mois.gov24_detail"), "SUCCEEDED"); // gitleaks:allow public dataset identifier
  const row = () => db.sqlite.prepare("SELECT * FROM gov24_service WHERE service_id = ?").get(ID);
  const raw = () => db.sqlite.prepare("SELECT * FROM ext_record WHERE dataset_key = 'mois.gov24_detail' AND record_id = ?").get(ID + ":detail"); // gitleaks:allow public dataset identifier
  const truncateLikeOldProjector = () => {
    const listFields = { purpose: "서비스목적요약", target: "지원대상", criteria: "선정기준", benefit: "지원내용", apply_method: "신청방법", apply_deadline: "신청기한", reception: "접수기관", contact: "전화문의" };
    db.sqlite.prepare("UPDATE gov24_service SET " + Object.keys(listFields).map((field) => field + " = ?").join(",") + " WHERE service_id = ?")
      .run(...Object.values(listFields).map((field) => state.list[field]), ID);
  };
  return { db, state, run, row, raw, truncateLikeOldProjector };
}

function readOnly(db) {
  const queries = [];
  return {
    queries,
    prepare(sql) {
      assert.match(sql, /^SELECT\s/);
      const wrap = (statement) => ({
        bind(...values) { queries.push({ sql, values }); return wrap(statement.bind(...values)); },
        all: () => statement.all(),
        first: () => statement.first(),
        run() { assert.fail("hydration must not write"); },
      });
      return wrap(db.prepare(sql));
    },
    batch() { assert.fail("hydration must not write"); },
  };
}

async function replacePayload(f, overrides) {
  const raw = f.raw();
  const payload = { ...JSON.parse(raw.payload_json), ...overrides };
  const hash = await recordHash({ recordId: raw.record_id, payload, officialUrl: raw.official_url });
  f.db.sqlite.prepare("UPDATE ext_record SET payload_json = ?, record_hash = ? WHERE dataset_key = 'mois.gov24_detail' AND record_id = ?") // gitleaks:allow public dataset identifier
    .run(JSON.stringify(payload), hash, ID + ":detail");
}

function assertPreserved(before, after, except = []) {
  for (const key of Object.keys(before)) if (!except.includes(key)) assert.equal(after[key], before[key], key);
  assert.deepEqual(Object.keys(after).filter((key) => !Object.hasOwn(before, key)).sort(), [...META].sort());
}

test("과거 목록이 축약한 같은 버전 상세를 읽기 전용 복원하며 원문·행·식별자·출처·수집시각을 보존한다", async () => {
  const f = await fixture();
  f.truncateLikeOldProjector();
  f.state.now += 86_400;
  assert.equal(await f.run("mois.gov24_list"), "SUCCEEDED");
  assert.equal(await f.run("mois.gov24_detail"), "SUCCEEDED_EMPTY"); // gitleaks:allow public dataset identifier
  assert.equal(f.state.detailCalls, 1, "이미 축약된 COLLECTED 행은 기존 큐가 재수집하지 않는다");
  const before = Object.freeze(f.row());
  assert.equal(before.target, "목록 대상");
  const originalRaw = f.raw();
  const changes = f.db.sqlite.prepare("SELECT total_changes() AS n").get().n;
  const db = readOnly(f.db);
  const [restored] = await hydrateGov24Details(db, [before]);
  for (const [column, field] of Object.entries(SHARED)) assert.equal(restored[column], f.state.detail[field], column);
  assert.equal(restored.detail_hydration_status, "RESTORED");
  assert.equal(restored.detail_hydration_reason, "SAME_VERSION_COMPLETED_DETAIL");
  assert.equal(restored.detail_hydration_record_id, ID + ":detail");
  assert.equal(restored.detail_hydration_record_hash, originalRaw.record_hash);
  assert.equal(restored.detail_hydration_run_id, originalRaw.last_success_run_id);
  assert.equal(restored.detail_hydration_version, GOV24_DETAIL_HYDRATION_VERSION);
  assertPreserved(before, restored, Object.keys(SHARED));
  assert.deepEqual(f.row(), before);
  assert.deepEqual(f.raw(), originalRaw);
  assert.equal(f.db.sqlite.prepare("SELECT total_changes() AS n").get().n, changes);
  assert.equal(db.queries.length, 1);
  assert.deepEqual(db.queries[0].values, [ID + ":detail"]);
  assert.match(db.queries[0].sql, /WHERE r.dataset_key = 'mois.gov24_detail' AND r.record_id IN/); // gitleaks:allow public dataset identifier
});

test("이미 상세가 투영된 행과 상세의 빈 공용 필드는 원래 값을 유지한다", async () => {
  const f = await fixture({ 선정기준: null });
  const before = f.row();
  assert.equal(before.criteria, "목록 기준");
  const [result] = await hydrateGov24Details(readOnly(f.db), [before]);
  assert.equal(result.detail_hydration_status, "UNCHANGED");
  assertPreserved(before, result);
});

test("원천에서 빠진 행·STALE·빈 상세·미확인 버전은 원문을 조회하거나 복원하지 않는다", async () => {
  const f = await fixture();
  const before = f.row();
  const cases = [
    [{ presence: "NOT_SEEN" }, "SERVICE_NOT_PRESENT"],
    [{ detail_status: "STALE" }, "DETAIL_NOT_COLLECTED"],
    [{ detail_status: "DETAIL_EMPTY" }, "DETAIL_NOT_COLLECTED"],
    [{ modified_at: null, detail_modified_at: null }, "CURRENT_VERSION_UNCONFIRMED"],
    [{ modified_at: "", detail_modified_at: "" }, "CURRENT_VERSION_UNCONFIRMED"],
    [{ detail_modified_at: "20250101" }, "DETAIL_VERSION_MISMATCH"],
    [{ detail_fetched_at: null }, "DETAIL_COLLECTION_TIME_UNCONFIRMED"],
    [{ service_id: "../other" }, "SERVICE_ID_INVALID"],
  ];
  const rows = cases.map(([override]) => ({ ...before, ...override }));
  const db = readOnly(f.db);
  const results = await hydrateGov24Details(db, rows);
  for (const [index, result] of results.entries()) {
    assert.equal(result.detail_hydration_status, "NOT_RESTORED");
    assert.equal(result.detail_hydration_reason, cases[index][1]);
    assert.equal(result.detail_hydration_record_id, null);
    assertPreserved(rows[index], result);
  }
  assert.equal(db.queries.length, 0);
  f.state.now += 86_400;
  f.state.list = { ...listRow("20261002123000"), 지원대상: "변경 버전 목록 대상" };
  await f.run("mois.gov24_list");
  const [stale] = await hydrateGov24Details(db, [f.row()]);
  assert.equal(stale.target, "변경 버전 목록 대상");
  assert.equal(stale.detail_status, "STALE");
  assert.equal(stale.detail_hydration_status, "NOT_RESTORED");
  assert.equal(db.queries.length, 0, "새 버전에는 옛 상세 원문을 읽지 않는다");
});

test("다른 서비스·범위·버전이거나 존재하지 않는 원문은 축약 행을 덮어쓰지 않는다", async () => {
  const cases = [
    ["RAW_ID_OR_SCOPE_MISMATCH", async (f) => f.db.sqlite.prepare("UPDATE ext_record SET scope_key = 'service:OTHER' WHERE dataset_key = 'mois.gov24_detail'").run()], // gitleaks:allow public dataset identifier
    ["RAW_PAYLOAD_ID_MISMATCH", async (f) => replacePayload(f, { 서비스ID: "OTHER" })],
    ["RAW_VERSION_MISMATCH", async (f) => f.db.sqlite.prepare("UPDATE ext_record SET source_updated_at = '20250101' WHERE dataset_key = 'mois.gov24_detail'").run()], // gitleaks:allow public dataset identifier
    ["RAW_PAYLOAD_VERSION_MISMATCH", async (f) => replacePayload(f, { 수정일시: "20250101" })],
    ["RAW_DETAIL_NOT_PRESENT", async (f) => f.db.sqlite.prepare("UPDATE ext_record SET presence = 'NOT_SEEN' WHERE dataset_key = 'mois.gov24_detail'").run()], // gitleaks:allow public dataset identifier
    ["RAW_DETAIL_NOT_FOUND", async (f) => f.db.sqlite.prepare("DELETE FROM ext_record WHERE dataset_key = 'mois.gov24_detail'").run()], // gitleaks:allow public dataset identifier
  ];
  for (const [reason, mutate] of cases) {
    const f = await fixture();
    f.truncateLikeOldProjector();
    await mutate(f);
    const before = f.row();
    const [result] = await hydrateGov24Details(readOnly(f.db), [before]);
    assert.equal(result.detail_hydration_reason, reason);
    assert.equal(result.detail_hydration_status, "NOT_RESTORED");
    assert.equal(result.detail_hydration_record_id, null, "불일치한 원천의 식별자를 내보내지 않는다");
    assertPreserved(before, result);
  }
});

test("원문 수집시각과 완료된 상세 실행이 일치해야 하며 부분·진행 중·다른 실행의 원문은 복원하지 않는다", async () => {
  const cases = [
    ["RAW_COLLECTION_TIME_MISMATCH", "UPDATE ext_record SET last_seen_at = last_seen_at + 1 WHERE dataset_key = 'mois.gov24_detail'"], // gitleaks:allow public dataset identifier
    ["RAW_RUN_NOT_COMPLETED", "UPDATE ext_run SET status = 'RUNNING' WHERE dataset_key = 'mois.gov24_detail'"], // gitleaks:allow public dataset identifier
    ["RAW_RUN_NOT_COMPLETED", "UPDATE ext_run SET status = 'PARTIAL' WHERE dataset_key = 'mois.gov24_detail'"], // gitleaks:allow public dataset identifier
    ["RAW_RUN_NOT_COMPLETED", "UPDATE ext_run SET status = 'SUCCEEDED_EMPTY' WHERE dataset_key = 'mois.gov24_detail'"], // gitleaks:allow public dataset identifier
    ["RAW_RUN_NOT_COMPLETED", "UPDATE ext_run SET finished_at = NULL WHERE dataset_key = 'mois.gov24_detail'"], // gitleaks:allow public dataset identifier
    ["RAW_RUN_MISMATCH", "UPDATE ext_record SET last_success_run_id = 'missing-run' WHERE dataset_key = 'mois.gov24_detail'"], // gitleaks:allow public dataset identifier
    ["RAW_RUN_MISMATCH", "UPDATE ext_run SET dataset_key = 'mois.gov24_list' WHERE dataset_key = 'mois.gov24_detail'"], // gitleaks:allow public dataset identifier
    ["RAW_COLLECTION_OUTSIDE_RUN", "UPDATE ext_run SET started_at = finished_at + 1 WHERE dataset_key = 'mois.gov24_detail'"], // gitleaks:allow public dataset identifier
    ["RAW_COLLECTION_OUTSIDE_RUN", "UPDATE ext_run SET finished_at = started_at - 1 WHERE dataset_key = 'mois.gov24_detail'"], // gitleaks:allow public dataset identifier
  ];
  for (const [reason, sql] of cases) {
    const f = await fixture();
    f.truncateLikeOldProjector();
    f.db.sqlite.prepare(sql).run();
    const before = f.row();
    const [result] = await hydrateGov24Details(readOnly(f.db), [before]);
    assert.equal(result.detail_hydration_reason, reason, sql);
    assert.equal(result.detail_hydration_status, "NOT_RESTORED");
    assertPreserved(before, result);
  }
});

test("깨진 JSON·비문자열 필드·해시 불일치는 복원하지 않고 원문의 추가 필드도 응답에 유출하지 않는다", async () => {
  const f = await fixture();
  f.truncateLikeOldProjector();
  await replacePayload(f, { extra_not_for_public_response: "RAW-ONLY-MARKER" });
  const [valid] = await hydrateGov24Details(readOnly(f.db), [f.row()]);
  assert.equal(valid.detail_hydration_status, "RESTORED");
  assert.ok(!JSON.stringify(valid).includes("RAW-ONLY-MARKER"));
  assert.ok(!Object.hasOwn(valid, "payload_json"));
  const validRaw = f.raw();
  const cases = [
    ["RAW_PAYLOAD_INVALID", "{"],
    ["RAW_PAYLOAD_INVALID", JSON.stringify({ ...JSON.parse(validRaw.payload_json), 지원대상: { unexpected: "nested" } })],
    ["RAW_PAYLOAD_INCOMPLETE", JSON.stringify({ 서비스ID: ID, 수정일시: VERSION, 지원대상: "필드가 빠진 원문" })],
    ["RAW_HASH_MISMATCH", JSON.stringify({ ...JSON.parse(validRaw.payload_json), 지원대상: "해시 없이 바뀐 조건" })],
  ];
  for (const [reason, payload] of cases) {
    f.db.sqlite.prepare("UPDATE ext_record SET payload_json = ? WHERE dataset_key = 'mois.gov24_detail'").run(payload); // gitleaks:allow public dataset identifier
    const before = f.row();
    const [result] = await hydrateGov24Details(readOnly(f.db), [before]);
    assert.equal(result.detail_hydration_reason, reason);
    assert.equal(result.detail_hydration_status, "NOT_RESTORED");
    assertPreserved(before, result);
  }
});

test("원문 조회가 불가능해도 기존 카드와 사유만 반환하며 DB 오류 내용을 노출하지 않는다", async () => {
  const f = await fixture();
  const before = f.row();
  const db = { prepare() { throw new Error("RAW-ONLY-ERROR-DETAIL"); }, batch() { assert.fail("must not write"); } };
  const [result] = await hydrateGov24Details(db, [before]);
  assert.equal(result.detail_hydration_status, "NOT_RESTORED");
  assert.equal(result.detail_hydration_reason, "RAW_DETAIL_READ_UNAVAILABLE");
  assertPreserved(before, result);
  assert.ok(!JSON.stringify(result).includes("RAW-ONLY-ERROR-DETAIL"));
});
