import assert from "node:assert/strict";
import test from "node:test";
import { database, NOW } from "./press-test-support.mjs";
import { gov24Dto, gov24SearchRelevance, searchGov24Services, welfareCandidateNotes, welfareRelevance } from "./mcp/gov24.ts";
import { refineWelfareQuery } from "./mcp/query-refiner.ts";

function fixture() {
  const db = database();
  const add = (overrides) => {
    const row = {
      service_id: "DEFAULT", name: "시험 사업", org_name: "보건복지부", org_type: "중앙행정기관",
      target: "2026년 원문에 기재된 지원대상", modified_at: "20261001", detail_modified_at: "20261001", detail_status: "COLLECTED",
      detail_fetched_at: NOW, first_seen_at: NOW, last_seen_at: NOW, presence: "PRESENT", list_run_id: "candidate-limit-test",
      ...overrides,
    };
    const keys = Object.keys(row);
    db.sqlite.prepare("INSERT INTO gov24_service (" + keys.join(",") + ") VALUES (" + keys.map(() => "?").join(",") + ")")
      .run(...keys.map((key) => row[key]));
    return row;
  };
  return { db, add };
}

test("정부24 SQL 후보 80개 제한 전에 공식 별칭·중립 접미어·반복 괄호의 본사업을 우선한다", async () => {
  const cases = [
    { query: "주거급여", title: "주거급여(맞춤형급여)" },
    { query: "부모급여", title: "부모급여 지원" },
    { query: "부모급여", title: "부모급여 지원사업" },
    { query: "기초연금", title: "기초연금(기초연금)" },
    { query: "장애인 활동지원", title: "장애인 활동지원(장애인 활동지원)" },
    { query: "부모급여", title: "부모급여 지원(부모급여 지원)" },
  ];
  for (const { query, title } of cases) {
    const { db, add } = fixture();
    try {
      const plan = refineWelfareQuery(query + " 대상 기준 알려줘", { currentYear: 2026 });
      for (let index = 0; index < 95; index++) add({ service_id: "NOISE-" + index, name: "가나다 " + query + " 연계 " + index });
      add({ service_id: "POLICY-TITLE", name: title });
      assert.ok(welfareRelevance(title, plan) > welfareRelevance("가나다 " + query + " 연계 0", plan), title + "는 본사업 후보다");
      const rows = await searchGov24Services(db, plan);
      assert.equal(rows[0]?.service_id, "POLICY-TITLE", title + "를 SQL 제한 전에 포함해 최종 선두에 반환해야 한다");
      assert.equal(rows.length, 8);
    } finally { db.sqlite.close(); }
  }
});

test("동일한 사업명 중앙 후보가 80개를 넘더라도 질문에 명시한 시군구 후보를 먼저 반환한다", async () => {
  const { db, add } = fixture();
  try {
    const plan = refineWelfareQuery("서귀포시 기초연금 대상 기준 알려줘", { currentYear: 2026 });
    assert.equal(plan.region_id, "region:제주특별자치도|서귀포시");
    let national;
    for (let index = 0; index < 85; index++) national = add({ service_id: "NATIONAL-" + index, name: "기초연금" });
    const local = add({ service_id: "LOCAL-EXACT", name: "기초연금", org_name: "제주특별자치도 서귀포시", org_type: "지방자치단체" });
    assert.ok(gov24SearchRelevance(gov24Dto(local), plan) > gov24SearchRelevance(gov24Dto(national), plan));
    const rows = await searchGov24Services(db, plan);
    assert.equal(rows[0]?.service_id, "LOCAL-EXACT", "JS 지역 우선순위가 적용되기 전에 SQL 중앙 후보로 자리를 채우면 안 된다");
    assert.equal(rows[0].publisher_scope.region_id, plan.region_id);
    assert.equal(rows[0].publisher_scope.basis, "publisher_jurisdiction_not_personal_eligibility");
    assert.equal(rows[0].personal_determination, false, "지역 검색 우선순위를 개인 자격 확정으로 바꾸지 않는다");
  } finally { db.sqlite.close(); }
});

test("제외한 본사업은 공식 별칭·중립 접미어·반복 괄호로 적혀 있어도 긍정 후보나 세부제목 가산점으로 되살리지 않는다", async () => {
  const { db, add } = fixture();
  try {
    const plan = refineWelfareQuery("주거급여는 제외하고 부모급여 대상 기준 알려줘", { currentYear: 2026 });
    assert.deepEqual(plan.excluded_programs, ["주거급여"]);
    const excluded = ["주거급여", "주거급여(맞춤형급여)", "주거급여 지원", "주거급여 지원사업", "주거급여(주거급여)"];
    for (const [index, name] of excluded.entries()) {
      add({ service_id: "EXCLUDED-" + index, name, target: "부모급여와 함께 안내하는 목록 문구" });
      assert.ok(welfareRelevance(name, plan) < 0, name + "를 명시적 제외로 처리해야 한다");
    }
    add({ service_id: "INCLUDED", name: "부모급여" });
    const rows = await searchGov24Services(db, plan);
    assert.deepEqual(rows.map((row) => row.service_id), ["INCLUDED"]);
  } finally { db.sqlite.close(); }
});

test("증명서를 제외한 질문은 증명서·세부제목 가산점을 받지 않고 명시적으로 요청한 경우에만 우선한다", async () => {
  const { db, add } = fixture();
  try {
    const main = "기초연금", certificate = "기초연금 수급자 증명서 발급";
    add({ service_id: "MAIN", name: main });
    add({ service_id: "CERTIFICATE", name: certificate });
    const excluded = refineWelfareQuery("기초연금 지원대상만 알려줘. 증명서는 제외하고", { currentYear: 2026 });
    assert.ok(welfareCandidateNotes(certificate, excluded).includes("CERTIFICATE_NOT_REQUESTED"));
    assert.ok(welfareRelevance(main, excluded) > welfareRelevance(certificate, excluded), "제외 구절을 긍정적인 세부제목·증명서 요청으로 사용하지 않는다");
    assert.equal((await searchGov24Services(db, excluded))[0]?.service_id, "MAIN");
    const requested = refineWelfareQuery("기초연금 수급자 증명서 발급 방법을 알려줘", { currentYear: 2026 });
    for (let index = 0; index < 85; index++) add({ service_id: "MAIN-DUP-" + index, name: main });
    assert.ok(!welfareCandidateNotes(certificate, requested).includes("CERTIFICATE_NOT_REQUESTED"));
    assert.ok(welfareRelevance(certificate, requested) > welfareRelevance(main, requested));
    assert.equal((await searchGov24Services(db, requested))[0]?.service_id, "CERTIFICATE", "명시한 세부항목을 본사업 80개 후보 제한 전에 포함한다");
  } finally { db.sqlite.close(); }
});
