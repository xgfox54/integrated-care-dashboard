import assert from "node:assert/strict";
import test from "node:test";
import { database, NOW } from "./press-test-support.mjs";
import { McpData } from "./mcp/data.ts";
import { handleMcpRequest } from "./mcp/server.ts";
import { refineWelfareQuery } from "./mcp/query-refiner.ts";
import { getGov24Service, gov24Dto, gov24FieldYearEvidence, gov24HouseholdTable, searchGov24Services } from "./mcp/gov24.ts";
import { programPublicInfo } from "./integrations/public.ts";

function addGov(db, overrides = {}) {
  const row = {
    service_id: "TEST-GOV24", name: "부모급여 지원", org_name: "보건복지부", org_type: "중앙행정기관",
    target: "2026년 기준 영아를 양육하는 보호자", criteria: "2026년 기준 원문에 기재된 선정기준",
    benefit: "2026년 기준 원문에 기재된 지원내용", apply_method: "2026년 읍면동 방문 신청",
    required_documents: "2026년 신분증과 원문에 명시된 서류", detail_url: "https://www.gov.kr/portal/rcvfvrSvc/dtlEx/TEST-GOV24",
    modified_at: "20261001120000", detail_modified_at: "20261001120000", detail_status: "COLLECTED",
    detail_fetched_at: NOW, first_seen_at: NOW, last_seen_at: NOW, presence: "PRESENT", list_run_id: "test-list",
    ...overrides,
  };
  const keys = Object.keys(row);
  db.sqlite.prepare("INSERT INTO gov24_service (" + keys.join(",") + ") VALUES (" + keys.map(() => "?").join(",") + ")").run(...keys.map((key) => row[key]));
  return row;
}

function addProgram(db) {
  db.sqlite.prepare("INSERT INTO official_sync_run (id, trigger, status, started_at, completed_at) VALUES ('qa-run', 'manual', 'succeeded', ?, ?)").run(NOW - 60, NOW);
  db.sqlite.prepare("INSERT INTO official_service_snapshot (id, service_id, sync_run_id, sido, sigungu, category, subcategory, name, description, target, detail_target, provider, type, serial, detail_url, updated_date, collected_at, application_method) VALUES ('qa-service', 'QA100', 'qa-run', '제주특별자치도', '제주특별자치도', '일상생활돌봄', '식사지원', '제주가치돌봄', '공개 요약 카드', '누구나', '', '제주특별자치도', '지자체', '1', '', '2026-07-01', ?, '행정복지센터 문의')").run(NOW);
  return "service:qa100|제주특별자치도|제주특별자치도|일상생활돌봄|식사지원|제주가치돌봄";
}

function addLink(db, id, govId = "TEST-GOV24", status = "VERIFIED") {
  db.sqlite.prepare("INSERT INTO program_ext_link (link_id, source_kind, source_id, target_kind, target_id, target_label, score, evidence_json, status, created_at, updated_at, reviewed_at) VALUES (?, 'GOV24', ?, 'service', ?, '제주가치돌봄', 1, '{}', ?, ?, ?, ?)").run("link-" + govId, govId, id, status, NOW, NOW, NOW);
}

async function call(db, name, args, expectedError = null) {
  const response = await handleMcpRequest(new Request("https://dashboard.example/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }), new McpData(db, async () => new Map()), (error) => { throw error; });
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  if (expectedError) {
    assert.equal(body.result?.isError, true, JSON.stringify(body));
    assert.equal(body.result.structuredContent.error.code, expectedError);
    return body.result.structuredContent;
  }
  assert.ok(body.result && !body.result.isError, JSON.stringify(body));
  return body.result.structuredContent;
}

test("시행사업 연결이 없는 정부24 사업도 자연어 search→fetch→context에서 상세와 출처를 제공한다", async () => {
  const db = database();
  addGov(db);
  const search = await call(db, "search", { query: "2026년 부모급여 신청 절차와 준비서류 알려줘" });
  assert.equal(search.results[0].id, "gov24_service:TEST-GOV24");
  assert.equal(search.results[0].entity_type, "gov24_service");
  assert.equal(search.query_plan.requested_year, 2026);
  assert.match(search.gov24_revision, /^gov24:/);
  const fetched = await call(db, "fetch", { id: search.results[0].id });
  assert.match(fetched.text, /읍면동 방문 신청/);
  assert.match(fetched.text, /신분증/);
  assert.equal(fetched.metadata.content_scope, "official_service_detail");
  assert.equal(fetched.metadata.source.evidence_id, search.results[0].id);
  const context = await call(db, "get_welfare_context", { implementation_id: search.results[0].id, question: "2026년 부모급여 신청 절차 알려줘" });
  assert.match(context.data.eligibility.application_conditions, /영아를 양육하는 보호자/);
  assert.equal(context.data.fiscal.status, "UNLINKED");
  assert.equal(context.data.program.entity_type, "gov24_service");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM program_ext_link").get().n, 0, "검색이 미확인 사업 연결을 만들지 않는다");
});

test("정부24 SQL은 본문·사업명 부분 일치 80건 제한보다 정확한 사업명을 먼저 선택한다", async () => {
  const db = database();
  for (let index = 0; index < 95; index++) addGov(db, { service_id: "NOISE-" + index, name: "가나다 부모급여 연계 " + index });
  addGov(db, { service_id: "EXACT", name: "부모급여" });
  const rows = await searchGov24Services(db, refineWelfareQuery("부모급여 신청하려면?", { currentYear: 2026 }));
  assert.equal(rows[0].service_id, "EXACT");
});

test("지역 필터를 후보 제한 전에 적용하고 도 공통사업을 서귀포에 포함하되 제주시 전용사업은 제외한다", async () => {
  const db = database();
  for (let index = 0; index < 90; index++) addGov(db, { service_id: "SEOUL-" + index, name: "제주가치돌봄", org_name: "서울특별시 강남구", org_type: "지방자치단체" });
  addGov(db, { service_id: "JEJU", name: "제주가치돌봄", org_name: "제주특별자치도", org_type: "지방자치단체" });
  addGov(db, { service_id: "SEOGWIPO", name: "제주가치돌봄", org_name: "제주특별자치도 서귀포시", org_type: "지방자치단체" });
  addGov(db, { service_id: "JEJU-CITY", name: "제주가치돌봄", org_name: "제주특별자치도 제주시", org_type: "지방자치단체" });
  const plan = refineWelfareQuery("서귀포시 제주가치돌봄 식사지원 기준은?", { currentYear: 2026 });
  const rows = await searchGov24Services(db, plan);
  assert.deepEqual(rows.map((row) => row.service_id).sort(), ["JEJU", "SEOGWIPO"]);
  assert.equal(rows.find((row) => row.service_id === "JEJU").publisher_scope.level, "province");
  const localOnly = refineWelfareQuery("서귀포시 제주가치돌봄 해당 지역만", { currentYear: 2026 });
  assert.equal(localOnly.include_ancestor_scope, false);
  assert.deepEqual((await searchGov24Services(db, localOnly)).map((row) => row.service_id), ["SEOGWIPO"]);
});

test("SQL 후보 검색과 JS 순위는 하이픈·특수 공백을 동일하게 정규화한다", async () => {
  const db = database();
  addGov(db, { service_id: "HYPHEN", name: "장애인-활동지원" });
  addGov(db, { service_id: "NBSP", name: "장애인\u00a0활동지원" });
  const rows = await searchGov24Services(db, refineWelfareQuery("장애인 활동지원 신청 방법", { currentYear: 2026 }));
  assert.deepEqual(rows.map((row) => row.service_id).sort(), ["HYPHEN", "NBSP"]);
});

test("정부24 개체·신청조건·종합맥락은 과거 as_of에 현재 자료를 섞지 않고 실제 수집 기준일을 밝힌다", async () => {
  const db = database();
  addGov(db);
  for (const name of ["get_entity", "get_eligibility", "get_welfare_context"]) {
    const args = { [name === "get_entity" ? "entity_id" : "implementation_id"]: "gov24_service:TEST-GOV24" };
    await call(db, name, { ...args, as_of: "2020-01-01" }, "AS_OF_NOT_AVAILABLE");
    const result = await call(db, name, args);
    assert.match(result.basis.effective_reference_date, /^2026-\d{2}-\d{2}$/);
  }
});

test("검증된 연결 상세가 요약 누구나보다 우선하고 원래 사업 ID와 정규화한 광역 범위를 함께 보존한다", async () => {
  const db = database();
  const id = addProgram(db);
  addGov(db, { name: "제주가치돌봄", org_name: "제주특별자치도", org_type: "지방자치단체", target: "2026년 기준 돌봄이 필요하며 기존 서비스 이용이 어려운 도민" });
  addLink(db, id);
  const eligibility = await call(db, "get_eligibility", { implementation_id: id, question: "2026년 제주가치돌봄 지원대상은?" });
  assert.match(eligibility.data.application_conditions, /돌봄이 필요하며/);
  assert.notEqual(eligibility.data.application_conditions, "누구나");
  assert.equal(eligibility.data.official_public_info.gov24.services.length, 1);
  assert.equal(eligibility.data.region_id, "region:제주특별자치도");
  const context = await call(db, "get_welfare_context", { implementation_id: id });
  assert.equal(context.data.program.implementation_id, id);
  assert.equal(context.data.program.scope_level, "province");
  assert.equal(context.data.program.region.region_id, "region:제주특별자치도");
  assert.match(context.data.eligibility.application_conditions, /돌봄이 필요하며/);
  const fetched = await call(db, "fetch", { id });
  assert.match(fetched.text, /신청조건: 2026년 기준 돌봄이 필요하며/);
  assert.ok(fetched.metadata.sources.some((source) => source.evidence_id === "gov24_service:TEST-GOV24"));
});

test("미검증 정부24 후보는 사업 조건을 덮어쓰지 않고 원천에서 빠진 검증 연결도 수집됨으로 표시하지 않는다", async () => {
  const db = database();
  const id = addProgram(db);
  addGov(db, { name: "제주가치돌봄", target: "미확인 후보 전용 조건" });
  addLink(db, id, "TEST-GOV24", "CANDIDATE");
  const eligibility = await call(db, "get_eligibility", { implementation_id: id });
  assert.equal(eligibility.data.official_public_info.gov24.services.length, 0);
  assert.ok(!JSON.stringify(eligibility).includes("미확인 후보 전용 조건"));
  db.sqlite.prepare("UPDATE program_ext_link SET status = 'VERIFIED'").run();
  db.sqlite.prepare("UPDATE gov24_service SET presence = 'NOT_SEEN'").run();
  const info = await programPublicInfo(db, id);
  assert.equal(info.gov24.state, "NOT_COLLECTED");
  assert.equal(info.gov24.verified_links_without_present_source, 1);
  await assert.rejects(getGov24Service(db, "gov24_service:TEST-GOV24"), /현재 수집된/);
});

test("상세 버전 불일치는 오래된 서류와 신청주소를 숨기며 목록 정보로 명시한다", () => {
  const service = gov24Dto({ service_id: "STALE", name: "시험", detail_status: "COLLECTED", modified_at: "20261002", detail_modified_at: "20261001", required_documents: "예전 서류", online_url: "https://www.gov.kr/old" });
  assert.equal(service.detail_status, "STALE");
  assert.equal(service.required_documents, null);
  assert.equal(service.online_url, null);
  assert.equal(service.source.kind, "GOV24_SERVICE_LIST");
});

test("신청기간과 수정일의 연도를 금액에 전파하지 않고 출생연도와 도입연도를 적용연도에서 제외한다", () => {
  const service = gov24Dto({ service_id: "YEARS", name: "시험", modified_at: "20261231", apply_deadline: "2026년 상시 신청", benefit: "2025년 기준\n1인 가구 월 123,000원", target: "2024년 출생 아동" }, 2026);
  assert.equal(service.field_year_evidence.benefit.status, "YEAR_MISMATCH");
  assert.equal(service.field_year_evidence.apply_deadline.status, "MATCHED");
  assert.equal(service.structured_tables[0].year, 2025);
  assert.equal(service.source.effective_year, null);
  assert.equal(gov24FieldYearEvidence("2024년 출생 아동", 2026).status, "YEAR_UNCONFIRMED");
  assert.equal(gov24FieldYearEvidence("2022년부터 시행한 사업", 2026).status, "YEAR_UNCONFIRMED");
  assert.equal(gov24FieldYearEvidence("금액 원문에는 적용연도가 없음", 2026, "20260101").status, "YEAR_UNCONFIRMED");
  assert.equal(gov24FieldYearEvidence("2026년생에게 1인 가구 월 123,000원 지원", 2026).status, "YEAR_UNCONFIRMED");
  assert.equal(gov24FieldYearEvidence("2020년생 아동", 2026).status, "YEAR_UNCONFIRMED");
  assert.equal(gov24FieldYearEvidence("2026년 기준 2024년생 아동", 2026).status, "MATCHED");
  assert.equal(gov24FieldYearEvidence("2026년 생계지원", 2026).status, "MATCHED");
});

test("가구원수 표는 이상 범위·월/연 주기·각주 원문을 보존하고 같은 가구의 복수 기준을 확정하지 않는다", () => {
  const tables = gov24HouseholdTable({ service_id: "TABLE", name: "시험", benefit: "2026년 기준\n1인 가구 월 123,000원\n4인 이상 가구 456,000원 연 1회\n※ 가구별 심사 필요" });
  const table = tables[0];
  assert.equal(table.year, 2026);
  assert.deepEqual(table.rows.map((cell) => [cell.household_size, cell.household_size_operator, cell.amount_krw, cell.payment_period]), [[1, "eq", "123000", "monthly"], [4, "gte", "456000", "annual"]]);
  assert.equal(table.payment_period, "MIXED_PERIODS_REVIEW_REQUIRED");
  assert.equal(table.footnote_scope, "WHOLE_FIELD_UNMAPPED");
  assert.match(table.rows[1].source_locator, /line:3/);
  assert.equal(gov24HouseholdTable({ service_id: "DUP", name: "시험", benefit: "1인 123,000원\n1인 456,000원" })[0].verification_status, "AMBIGUOUS_ROWS_REVIEW_REQUIRED");
  const sameLine = gov24HouseholdTable({ service_id: "MIX", name: "시험", benefit: "1인 가구 123,000원/월, 2인 가구 456,000원 연간" })[0];
  assert.deepEqual(sameLine.rows.map((cell) => cell.payment_period), ["monthly", "annual"]);
  assert.equal(sameLine.payment_period, "MIXED_PERIODS_REVIEW_REQUIRED");
});

test("연도 비교·제외 모순은 현재연도로 바꾸지 않으며 해당 지역만 조건이 상세 근거 선택에도 이어진다", async () => {
  const db = database();
  addGov(db, { name: "제주가치돌봄", org_name: "제주특별자치도", org_type: "지방자치단체", benefit: "2026년 기준 1인 가구 월 123,000원" });
  for (const name of ["get_eligibility", "get_welfare_context"]) {
    for (const question of ["2026년은 제외하고 올해 제주가치돌봄", "2025년과 2026년 제주가치돌봄 비교"]) await call(db, name, { implementation_id: "gov24_service:TEST-GOV24", question }, "YEAR_SCOPE_REVIEW_REQUIRED");
    const local = await call(db, name, { implementation_id: "gov24_service:TEST-GOV24", question: "2026년 서귀포시 제주가치돌봄 해당 지역만" });
    assert.equal(local.data.benefit, null);
    assert.equal(local.data.evidence_resolution.fields.find((field) => field.field === "benefit").final_authority, false);
  }
});

test("정부24 ID는 수집된 서비스 식별자만 허용한다", async () => {
  const db = database();
  for (const id of ["https://www.gov.kr/example", "gov24_service:../../secret", "gov24_service:x' OR 1=1--"]) await assert.rejects(getGov24Service(db, id), /정부24 ID/);
});
