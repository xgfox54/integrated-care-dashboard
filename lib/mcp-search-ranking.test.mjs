import assert from "node:assert/strict";
import test from "node:test";
import { database, NOW } from "./press-test-support.mjs";
import { McpData } from "./mcp/data.ts";
import { handleMcpRequest } from "./mcp/server.ts";
import { refineWelfareQuery } from "./mcp/query-refiner.ts";
import { gov24Dto, gov24SearchRelevance, welfareCandidateNotes, welfareRelevance } from "./mcp/gov24.ts";

// These fixtures exercise retrieval order and scope, not real benefit rules or amounts.
function addGov(db, serviceId, name, overrides = {}) {
  const row = {
    service_id: serviceId, name, org_name: "보건복지부", org_type: "중앙행정기관",
    target: "2026년 기준 원문에 기재된 지원대상", criteria: "2026년 기준 원문에 기재된 선정기준",
    benefit: "2026년 기준 원문에 기재된 지원내용", apply_method: "행정복지센터 방문 신청",
    detail_url: "https://www.gov.kr/portal/rcvfvrSvc/dtlEx/" + serviceId,
    modified_at: "20261001120000", detail_modified_at: "20261001120000", detail_status: "COLLECTED",
    detail_fetched_at: NOW, first_seen_at: NOW, last_seen_at: NOW, presence: "PRESENT", list_run_id: "ranking-list",
    ...overrides,
  };
  const keys = Object.keys(row);
  db.sqlite.prepare("INSERT INTO gov24_service (" + keys.join(",") + ") VALUES (" + keys.map(() => "?").join(",") + ")")
    .run(...keys.map((key) => row[key]));
  return row;
}

function addCard(db, id, name, sido, sigungu) {
  db.sqlite.prepare("INSERT OR IGNORE INTO official_sync_run (id, trigger, status, started_at, completed_at) VALUES ('ranking-run', 'manual', 'succeeded', ?, ?)")
    .run(NOW - 60, NOW);
  db.sqlite.prepare("INSERT INTO official_service_snapshot (id, service_id, sync_run_id, sido, sigungu, category, subcategory, name, description, target, detail_target, provider, type, serial, detail_url, updated_date, collected_at, application_method) VALUES (?, ?, 'ranking-run', ?, ?, '일상생활돌봄', '일상생활지원', ?, '공개 요약 카드', '공개 지원대상', '', ?, '지자체', '1', '', '2026-07-01', ?, '행정복지센터 문의')")
    .run("snapshot-" + id, id, sido, sigungu, name, [sido, sigungu].filter(Boolean).join(" "), NOW);
}

async function search(db, query) {
  const response = await handleMcpRequest(new Request("https://dashboard.example/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: { query } } }),
  }), new McpData(db, async () => new Map()), (error) => { throw error; });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.ok(body.result && !body.result.isError, JSON.stringify(body));
  return body.result.structuredContent;
}

function assertBefore(result, firstId, secondId) {
  const ids = result.results.map((item) => item.id);
  assert.ok(ids.includes(firstId), "선행 후보가 실제 검색 결과에 있어야 한다: " + firstId);
  assert.ok(ids.includes(secondId), "후행 후보를 삭제하지 않고 순위를 비교해야 한다: " + secondId);
  assert.ok(ids.indexOf(firstId) < ids.indexOf(secondId), JSON.stringify(result.results));
}

const MUNICIPALITIES = ["수원시", "용인시", "성남시", "고양시", "부천시", "안양시", "안산시", "시흥시"];

for (const scenario of [
  { label: "주거급여", card: "주거급여", official: "주거급여 (맞춤형 급여)", query: "주거급여 지원 대상과 신청 절차 알려줘", ministry: "국토교통부" },
  { label: "일상돌봄", card: "일상돌봄", official: "일상돌봄 서비스", query: "일상돌봄 서비스 지원 대상과 신청 절차 알려줘", ministry: "보건복지부" },
]) {
  test(scenario.label + " 포괄 질문은 지역 요약 카드 8개보다 중앙 본사업 상세가 앞선다", async () => {
    const db = database();
    for (const [index, city] of MUNICIPALITIES.entries()) addCard(db, "CARD-" + index, scenario.card, "경기도", city);
    const row = addGov(db, "CENTRAL", scenario.official, { org_name: scenario.ministry });
    const result = await search(db, scenario.query);
    assert.equal(result.query_plan.region_id, null);
    assert.equal(result.results.filter((item) => item.entity_type === "implementation").length, 8, "지역 후보도 모두 유지한다");
    assert.equal(result.results[0].id, "gov24_service:CENTRAL");
    assert.equal(result.results[0].content_scope, "official_service_detail");
    assert.equal(result.results[0].detail_status, "COLLECTED");
    const plan = refineWelfareQuery(scenario.query, { currentYear: 2026 });
    assert.ok(gov24SearchRelevance(gov24Dto(row), plan) > welfareRelevance(scenario.card, plan));
    assert.match(result.results[0].title, new RegExp(scenario.label));
  });
}

test("의료급여 본사업은 일반 질문에서 앞서고 틀니를 명시하면 해당 세부지원이 앞선다", async () => {
  const db = database();
  addGov(db, "DENTAL", "의료급여수급자 틀니·치과임플란트 지원");
  addGov(db, "MAIN", "의료급여 (의료급여)");
  const general = await search(db, "의료급여 대상과 신청 절차 알려줘");
  assertBefore(general, "gov24_service:MAIN", "gov24_service:DENTAL");
  assert.match(general.results[0].title, /의료급여 \(의료급여\)/, "출처의 원래 사업명은 보존한다");
  const specific = await search(db, "의료급여 틀니 지원 대상과 신청 절차 알려줘");
  assertBefore(specific, "gov24_service:DENTAL", "gov24_service:MAIN");
});

test("자활 참여확인서는 일반 대상·구비서류 질문보다 뒤에 두고 명시적 발급 질문에서 앞세운다", async () => {
  const db = database();
  addGov(db, "CERTIFICATE", "자활근로자 참여확인서 발급");
  addGov(db, "MAIN", "자활근로 (기초, 차상위)");
  for (const query of ["자활사업 참여 대상과 신청 절차 알려줘", "자활사업 신청에 필요한 서류 알려줘"]) {
    const result = await search(db, query);
    assertBefore(result, "gov24_service:MAIN", "gov24_service:CERTIFICATE");
    assert.ok(result.results.find((item) => item.id === "gov24_service:CERTIFICATE").relevance_notes.includes("CERTIFICATE_NOT_REQUESTED"));
  }
  const requested = await search(db, "자활 참여확인서 발급 절차 알려줘");
  assertBefore(requested, "gov24_service:CERTIFICATE", "gov24_service:MAIN");
  assert.ok(!requested.results[0].relevance_notes.includes("CERTIFICATE_NOT_REQUESTED"));
});

test("동일 명칭 반복 괄호는 정확 일치하고 세부지원 괄호의 뜻은 유지한다", () => {
  const plan = refineWelfareQuery("의료급여 대상 알려줘", { currentYear: 2026 });
  const plain = welfareRelevance("의료급여", plan);
  for (const repeated of ["의료급여(의료급여)", "의료급여 ( 의료급여 )", "의료급여（의료급여）"]) {
    assert.equal(welfareRelevance(repeated, plan), plain, repeated);
  }
  for (const narrow of ["의료급여(틀니)", "의료급여(치과임플란트)"]) {
    assert.ok(welfareRelevance(narrow, plan) < plain, "세부 지원명을 지워 본사업과 동등하게 만들지 않는다: " + narrow);
  }
  const detailPlan = refineWelfareQuery("의료급여 틀니 신청 방법", { currentYear: 2026 });
  assert.ok(welfareRelevance("의료급여(틀니)", detailPlan) > welfareRelevance("의료급여(의료급여)", detailPlan));
});

test("행복이음 시스템 질문의 동명 장학금은 경고와 함께 유지하고 미수집 매뉴얼을 만들지 않는다", async () => {
  const db = database();
  const name = "행복이음 장학금 지원";
  addGov(db, "SCHOLARSHIP", name, { org_name: "경기도 안산시", org_type: "지방자치단체" });
  const query = "행복이음 정보시스템 접속과 권한 관리 절차 알려줘";
  const result = await search(db, query);
  assert.deepEqual(result.results.map((item) => item.id), ["gov24_service:SCHOLARSHIP"]);
  assert.equal(result.retrieval_status, "CANDIDATES_FOUND");
  assert.ok(result.results[0].relevance_notes.includes("SYSTEM_NAME_OVERLAP_REVIEW_REQUIRED"));
  assert.ok(result.warnings.some((warning) => /동명|정보시스템 매뉴얼/.test(warning)));
  assert.deepEqual(result.results[0].relevance_notes, welfareCandidateNotes(name, refineWelfareQuery(query, { currentYear: 2026 })));
  const requested = await search(db, "행복이음 장학금 신청 대상 알려줘");
  assert.deepEqual(requested.results.map((item) => item.id), ["gov24_service:SCHOLARSHIP"]);
  assert.ok(!requested.results[0].relevance_notes.includes("SYSTEM_NAME_OVERLAP_REVIEW_REQUIRED"));
});

test("다함께돌봄 시설 운영비는 이용자 질문에서 경고하되 냉난방비 명시 요청은 그대로 제공한다", async () => {
  const db = database();
  addGov(db, "FACILITY", "다함께돌봄센터 냉난방비 지원", { org_name: "경기도 안성시", org_type: "지방자치단체" });
  const general = await search(db, "다함께돌봄 이용 대상과 신청 절차 알려줘");
  assert.deepEqual(general.results.map((item) => item.id), ["gov24_service:FACILITY"], "존재하는 운영비 후보를 숨기거나 이용자 본사업을 만들어 넣지 않는다");
  assert.ok(general.results[0].relevance_notes.includes("FACILITY_OPERATION_NOT_REQUESTED"));
  assert.ok(general.warnings.some((warning) => /시설 운영비/.test(warning)));
  const requested = await search(db, "다함께돌봄센터 냉난방비 지원 대상 알려줘");
  assert.deepEqual(requested.results.map((item) => item.id), ["gov24_service:FACILITY"]);
  assert.ok(!requested.results[0].relevance_notes.includes("FACILITY_OPERATION_NOT_REQUESTED"));
});

test("해당 지역만 검색은 중앙 상세 순위 가산에도 전국·도·다른 시 후보를 되살리지 않는다", async () => {
  const db = database();
  const name = "제주가치돌봄";
  addGov(db, "NATIONAL", name);
  addGov(db, "PROVINCE", name, { org_name: "제주특별자치도", org_type: "지방자치단체" });
  addGov(db, "LOCAL", name, { org_name: "제주특별자치도 서귀포시", org_type: "지방자치단체" });
  addGov(db, "SIBLING", name, { org_name: "제주특별자치도 제주시", org_type: "지방자치단체" });
  addCard(db, "PROVINCE-CARD", name, "제주특별자치도", "제주특별자치도");
  addCard(db, "LOCAL-CARD", name, "제주특별자치도", "서귀포시");
  addCard(db, "SIBLING-CARD", name, "제주특별자치도", "제주시");
  const inherited = await search(db, "서귀포시 제주가치돌봄 지원 대상 알려줘");
  const inheritedIds = inherited.results.map((item) => item.id);
  assert.ok(inheritedIds.includes("gov24_service:NATIONAL"));
  assert.ok(inheritedIds.includes("gov24_service:PROVINCE"));
  assert.ok(!inheritedIds.includes("gov24_service:SIBLING"));
  const local = await search(db, "서귀포시 제주가치돌봄 해당 지역만 알려줘");
  assert.equal(local.query_plan.include_ancestor_scope, false);
  assert.equal(local.query_plan.region_id, "region:제주특별자치도|서귀포시");
  assert.deepEqual(local.results.filter((item) => item.entity_type === "gov24_service").map((item) => item.id), ["gov24_service:LOCAL"]);
  assert.equal(local.results.filter((item) => item.entity_type === "implementation").length, 1);
  assert.equal(local.results.length, 2);
  for (const result of local.results) assert.equal(result.publisher_scope?.region_id ?? result.region_id, "region:제주특별자치도|서귀포시");
});
