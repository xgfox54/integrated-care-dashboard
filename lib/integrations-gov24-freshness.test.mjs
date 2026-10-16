import assert from "node:assert/strict";
import test from "node:test";
import { advanceRun, startRun } from "./integrations/runner.ts";
import { gov24Dto } from "./mcp/gov24.ts";
import { database, NOW, response } from "./press-test-support.mjs";

const ID = "WLF-FRESHNESS";
const OLD_VERSION = "20261001";
const NEW_VERSION = "20261002";
const SHARED = { purpose: "서비스목적", target: "지원대상", criteria: "선정기준", benefit: "지원내용", apply_method: "신청방법", apply_deadline: "신청기한", reception: "접수기관명", contact: "문의처" };
const DETAIL_ONLY = { required_documents: "구비서류", online_url: "온라인신청사이트URL", laws: "법령", ordinances: "자치법규", admin_rules: "행정규칙" };

function listRow(version = OLD_VERSION) {
  return {
    서비스ID: ID, 서비스명: "상세 보존 시험 사업", 소관기관명: "제주특별자치도", 소관기관유형: "지방자치단체", 수정일시: version,
    서비스목적요약: version + " 목록 목적", 지원대상: version + " 목록 대상", 선정기준: version + " 목록 기준", 지원내용: version + " 목록 내용",
    신청방법: version + " 목록 신청", 신청기한: version + " 목록 기한", 접수기관: version + " 목록 접수", 전화문의: version + " 목록 문의",
    상세조회URL: "https://www.gov.kr/portal/rcvfvrSvc/dtlEx/" + ID,
  };
}

function detailRow(version = OLD_VERSION) {
  return {
    서비스ID: ID, 서비스명: "상세 보존 시험 사업", 수정일시: version,
    서비스목적: version + " 상세 목적", 지원대상: version + " 상세 대상", 선정기준: version + " 상세 기준", 지원내용: version + " 상세 내용",
    신청방법: version + " 상세 신청", 신청기한: version + " 상세 기한", 접수기관명: version + " 상세 접수", 문의처: version + " 상세 문의",
    구비서류: version + " 제출서류", 온라인신청사이트URL: "https://www.gov.kr/apply/" + version,
    법령: version + " 근거 법령", 자치법규: version + " 근거 조례", 행정규칙: version + " 근거 규칙",
  };
}

function fixture() {
  const db = database();
  const state = { now: NOW, list: listRow(), detail: detailRow(), detailCalls: 0, listCalls: 0, counter: 0 };
  const deps = {
    now: () => state.now, newId: () => "freshness-run-" + ++state.counter, keyFor: async () => "TEST_ONLY_KEY",
    owner: "freshness-test", stepBudgetMs: 60_000, queueCap: 10,
    fetcher: async (url) => {
      const parsed = new URL(url);
      const list = parsed.pathname.endsWith("serviceList");
      if (list) state.listCalls++; else {
        assert.equal(parsed.searchParams.get("cond[서비스ID::EQ]"), ID);
        state.detailCalls++;
      }
      const rows = list ? [state.list] : state.detail ? [state.detail] : [];
      return response(200, JSON.stringify({ page: 1, perPage: list ? 500 : 1, totalCount: rows.length, currentCount: rows.length, matchCount: rows.length, data: rows }), { "content-type": "application/json" });
    },
  };
  const run = async (dataset) => {
    const { runId } = await startRun(db, deps, dataset, dataset.endsWith("_list") ? "all" : "queue", "test");
    let status = "RUNNING";
    for (let step = 0; status === "RUNNING" && step < 10; step++) status = await advanceRun(db, deps, runId);
    assert.notEqual(status, "RUNNING");
    return status;
  };
  return {
    db, state, run,
    row: () => db.sqlite.prepare("SELECT * FROM gov24_service WHERE service_id = ?").get(ID),
    raw: (dataset) => db.sqlite.prepare("SELECT payload_json, record_hash FROM ext_record WHERE dataset_key = ? AND record_id = ?").get(dataset, dataset.endsWith("_detail") ? ID + ":detail" : ID),
  };
}

async function collected(f) {
  assert.equal(await f.run("mois.gov24_list"), "SUCCEEDED");
  assert.equal(await f.run("mois.gov24_detail"), "SUCCEEDED");
  assert.equal(f.state.detailCalls, 1);
}

test("정부24 같은 버전 목록을 재수집해도 상세 조건·지원내용·서류를 보존하고 원천 목록은 요약 원값을 유지한다", async () => {
  const f = fixture();
  await collected(f);
  const before = f.row();
  const listRaw = f.raw("mois.gov24_list");
  const detailRaw = f.raw("mois.gov24_detail");
  assert.equal(JSON.parse(listRaw.payload_json).지원대상, f.state.list.지원대상);
  assert.equal(JSON.parse(detailRaw.payload_json).지원대상, f.state.detail.지원대상);
  f.state.now += 86_401;
  assert.equal(await f.run("mois.gov24_list"), "SUCCEEDED");
  const after = f.row();
  for (const [column, sourceField] of Object.entries({ ...SHARED, ...DETAIL_ONLY })) {
    assert.equal(after[column], f.state.detail[sourceField], column);
    assert.equal(after[column], before[column], column);
  }
  assert.equal(after.detail_status, "COLLECTED");
  assert.equal(after.detail_modified_at, OLD_VERSION);
  assert.equal(after.detail_fetched_at, before.detail_fetched_at);
  assert.equal(after.last_seen_at, f.state.now);
  assert.deepEqual(f.raw("mois.gov24_list"), listRaw, "같은 목록 원문을 상세로 바꾸지 않는다");
  assert.deepEqual(f.raw("mois.gov24_detail"), detailRaw, "상세 원문도 목록 재수집이 바꾸지 않는다");
  assert.equal(gov24Dto(after).content_scope, "official_service_detail");
  assert.equal(await f.run("mois.gov24_detail"), "SUCCEEDED_EMPTY");
  assert.equal(f.state.detailCalls, 1, "같은 버전의 상세를 불필요하게 다시 수집하지 않는다");
});

test("목록 버전 변경은 새 요약과 STALE만 노출하고 상세 재수집 후 새 내용·서류·법령으로 갱신한다", async () => {
  const f = fixture();
  await collected(f);
  const oldDetailRaw = f.raw("mois.gov24_detail");
  f.state.now += 86_401;
  f.state.list = listRow(NEW_VERSION);
  f.state.detail = { ...detailRow(NEW_VERSION), 선정기준: null, 법령: null };
  assert.equal(await f.run("mois.gov24_list"), "SUCCEEDED");
  let row = f.row();
  assert.equal(row.detail_status, "STALE");
  assert.equal(row.modified_at, NEW_VERSION);
  assert.equal(row.detail_modified_at, OLD_VERSION, "이전 상세의 버전은 추적용으로 보존한다");
  for (const [column, sourceField] of Object.entries(SHARED)) {
    const listField = { 서비스목적: "서비스목적요약", 접수기관명: "접수기관", 문의처: "전화문의" }[sourceField] ?? sourceField;
    assert.equal(row[column], f.state.list[listField], column);
  }
  for (const column of Object.keys(DETAIL_ONLY)) assert.equal(row[column], null, column + "는 이전 상세를 최신처럼 보여주지 않는다");
  const stale = gov24Dto(row);
  assert.equal(stale.detail_status, "STALE");
  assert.equal(stale.content_scope, "official_service_list");
  assert.equal(stale.required_documents, null);
  assert.equal(stale.online_url, null);
  assert.deepEqual(f.raw("mois.gov24_detail"), oldDetailRaw, "오래된 원천 상세는 삭제·변조하지 않는다");
  assert.equal(await f.run("mois.gov24_detail"), "SUCCEEDED");
  assert.equal(f.state.detailCalls, 2);
  row = f.row();
  assert.equal(row.detail_status, "COLLECTED");
  assert.equal(row.detail_modified_at, NEW_VERSION);
  assert.equal(row.detail_fetched_at, f.state.now);
  for (const [column, sourceField] of Object.entries({ ...SHARED, ...DETAIL_ONLY })) {
    const expected = column === "criteria" ? f.state.list.선정기준 : f.state.detail[sourceField];
    assert.equal(row[column], expected, column);
  }
  assert.equal(row.laws, null, "새 상세에서 빠진 법령을 이전 상세로 채우지 않는다");
  assert.equal(gov24Dto(row).content_scope, "official_service_detail");
  assert.equal(await f.run("mois.gov24_detail"), "SUCCEEDED_EMPTY");
  assert.equal(f.state.detailCalls, 2);
});

test("STALE는 버전 문자열이 같아도 상세 재수집되고 빈 상세는 반복 재시도하지 않는다", async () => {
  const f = fixture();
  await collected(f);
  f.db.sqlite.prepare("UPDATE gov24_service SET detail_status = 'STALE' WHERE service_id = ?").run(ID);
  assert.equal(await f.run("mois.gov24_detail"), "SUCCEEDED");
  assert.equal(f.state.detailCalls, 2, "STALE 상태 자체로도 재수집 대기열에 들어간다");
  assert.equal(f.row().detail_status, "COLLECTED");
  f.state.now += 86_401;
  f.state.list = listRow(NEW_VERSION);
  f.state.detail = null;
  await f.run("mois.gov24_list");
  await f.run("mois.gov24_detail");
  assert.equal(f.state.detailCalls, 3);
  assert.equal(f.row().detail_status, "DETAIL_EMPTY");
  for (const column of Object.keys(DETAIL_ONLY)) assert.equal(f.row()[column], null, column);
  assert.equal(await f.run("mois.gov24_detail"), "SUCCEEDED_EMPTY");
  f.state.now += 86_401;
  await f.run("mois.gov24_list");
  assert.equal(f.row().detail_status, "DETAIL_EMPTY", "같은 버전의 빈 상세 결과를 목록 수집이 STALE로 되돌리지 않는다");
  assert.equal(await f.run("mois.gov24_detail"), "SUCCEEDED_EMPTY");
  assert.equal(f.state.detailCalls, 3);
});
