// 통합 검색 순위 결합: 출처별 점수 척도가 달라도 질문 의도에 맞는 후보가 위로 오는지 확인한다.
// 후보는 합성값이며 실제 사업 내용·금액을 검증하지 않는다.
import assert from "node:assert/strict";
import test from "node:test";
import { database } from "./press-test-support.mjs";
import { searchFaq129 } from "./mcp/faq129.ts";
import { refineWelfareQuery } from "./mcp/query-refiner.ts";

test("FAQ question similarity survives fusion despite lexical ties and reversed IDs", async () => {
  const query = refineWelfareQuery("자활근로 참여자도 병가 사용이 가능한가요?", { currentYear: 2026 });
  const { hits } = await searchFaq129(database(), query, { limit: 4 });
  const candidates = hits.map((hit, index) => ({ ...hit, id: "faq129:" + (99 - index), rank: 100 }));
  const result = fuseSearchCandidates(candidates, query);
  assert.equal(result[0].question, query.raw_query);
  assert.equal(result[0].question_exact, true);
  assert.equal(result[0].question_similarity, 1);
});
import { budgetReferenceQuery, fuseSearchCandidates, isNoiseManualTitle, MANUAL_TOP_CAP } from "./mcp/search-fusion.ts";

const plan = (query) => refineWelfareQuery(query, { currentYear: 2026 });
const manual = (id, title, rank = 200) => ({ id: "manual:r:" + id, entity_type: "manual_section", title: "[매뉴얼] " + title, rank });
const types = (results, n) => results.slice(0, n).map((item) => item.entity_type);

test("지역 사업 질문은 이름이 다른 사업 카드도 관련 없는 고득점 매뉴얼보다 앞선다", () => {
  const query = plan("서귀포시 어르신 식사 배달 지원 서비스 찾아줘");
  assert.equal(query.region_id, "region:제주특별자치도|서귀포시");
  const candidates = [
    manual("a", "드림스타트 아동발달 사정도구 문항(청소년)", 188),
    manual("b", "부록", 183),
    manual("c", "Ⅱ 식사지원", 188),
    { id: "service:meal", entity_type: "implementation", title: "[사업] 저소득 재가노인 식사배달지원 (제주특별자치도)", rank: 20, region_id: "region:제주특별자치도" },
    { id: "service:far", entity_type: "implementation", title: "[사업] 경로식당 (강원특별자치도 양구군)", rank: 20, region_id: "region:강원특별자치도|양구군" },
  ];
  const results = fuseSearchCandidates(candidates, query);
  const ids = results.map((item) => item.id);
  assert.ok(ids.indexOf("service:meal") <= 2, JSON.stringify(ids));
  assert.ok(ids.indexOf("service:meal") < ids.indexOf("manual:r:a"));
  assert.ok(ids.indexOf("manual:r:c") < ids.indexOf("manual:r:a"), "제목에 질문 핵심어가 있는 매뉴얼이 우연 일치 매뉴얼보다 앞선다");
  assert.ok(ids.indexOf("service:meal") < ids.indexOf("service:far"), "요청 지역 상위 범위 사업이 다른 지역 사업보다 앞선다");
  assert.equal(results.length, candidates.length, "순위만 바꾸고 후보는 버리지 않는다");
});

for (const scenario of [
  { label: "예산", query: "2026년 서귀포시 통합돌봄 예산", type: "budget_line", extra: { id: "bl-1", entity_type: "budget_line", title: "[예산서] 통합돌봄 사업 (제주특별자치도 2026년 본예산)", rank: 150 } },
  { label: "보도자료", query: "서귀포시 통합돌봄 보도자료 최근", type: "press_release", extra: { id: "news:1", entity_type: "press_release", title: "[보도자료 메타데이터] 통합돌봄 확대 - 서귀포시", rank: 150 } },
]) {
  test(scenario.label + " 의도 질문은 최고점 매뉴얼 8개가 있어도 해당 종류를 3위 안에 둔다", () => {
    const query = plan(scenario.query);
    const manuals = Array.from({ length: 8 }, (_, index) => manual(String(index), "통합돌봄 " + index + "장", 235 - index));
    const results = fuseSearchCandidates([...manuals, scenario.extra], query);
    assert.ok(types(results, 3).includes(scenario.type), JSON.stringify(types(results, 10)));
  });
}

test("다른 종류 후보가 남아 있는 동안 상위 창의 매뉴얼은 최대 4개이며 넘치는 매뉴얼은 뒤로 보낸다", () => {
  const query = plan("기초연금 신청 방법");
  const manuals = Array.from({ length: 10 }, (_, index) => manual(String(index), "기초연금 신청 " + index, 230));
  const gov = [1, 2, 3].map((index) => ({ id: "gov24_service:" + index, entity_type: "gov24_service", title: "[정부24] 기초연금 관련 " + index + " (보건복지부)", rank: 90 }));
  const results = fuseSearchCandidates([...manuals, ...gov], query);
  // 매뉴얼 4개 + 정부24 3개가 먼저 오고, 다른 후보가 없을 때만 남은 매뉴얼이 이어진다.
  assert.equal(types(results, MANUAL_TOP_CAP + 3).filter((type) => type === "manual_section").length, MANUAL_TOP_CAP);
  assert.equal(types(results, MANUAL_TOP_CAP + 3).filter((type) => type === "gov24_service").length, 3);
  assert.equal(results.length, 13);
});

test("같은 제목의 매뉴얼 구간은 한 번만, 서식·목차 조각 제목은 본문 구간보다 뒤에 둔다", () => {
  const query = plan("교육활동지원비 신청 대상");
  const results = fuseSearchCandidates([
    manual("form1", "[ ] 결정(적합) [ ] 결정(대상제외)", 220),
    manual("dup1", "사회보장급여 신청(변경)서", 220),
    manual("dup2", "사회보장급여 신청(변경)서", 219),
    manual("body", "교육활동지원비 지원대상", 200),
  ], query);
  const titles = results.map((item) => item.title);
  assert.equal(titles.filter((title) => title.includes("사회보장급여 신청(변경)서")).length, 1);
  assert.equal(results[0].id, "manual:r:body", JSON.stringify(titles));
  assert.ok(isNoiseManualTitle("[매뉴얼] 원본 파일: 23.[매뉴얼] 2026년 안내.md"));
  assert.ok(isNoiseManualTitle("[매뉴얼] iv ╷ 보건복지부"));
  assert.ok(!isNoiseManualTitle("[매뉴얼] 2 주거급여 신청 구비서류"));
});

test("서식을 직접 물으면 서식 제목을 낮추지 않는다", () => {
  const query = plan("사회보장급여 신청서 서식");
  const results = fuseSearchCandidates([manual("form", "사회보장급여 신청(변경)서", 220), manual("other", "사회보장급여 개요", 200)], query);
  assert.equal(results[0].id, "manual:r:form");
});

test("질문의 세부조건이 제목에 있는 후보가 같은 점수의 일반 후보보다 앞선다", () => {
  const query = plan("2026년 기초연금 선정기준액 단독가구");
  assert.ok(query.detail_terms.includes("선정기준액"), JSON.stringify(query.detail_terms));
  const results = fuseSearchCandidates([manual("general", "기초연금 수급자 선정 개요", 210), manual("detail", "기초연금 선정기준액 단독가구", 210)], query);
  assert.equal(results[0].id, "manual:r:detail");
});

test("relevance_score는 0~100 공통 척도로 돌려주고 원점수(rank)는 노출하지 않는다", () => {
  const results = fuseSearchCandidates([manual("x", "기초연금", 235), { id: "gov24_service:x", entity_type: "gov24_service", title: "[정부24] 기초연금 (보건복지부)", rank: 126 }], plan("기초연금"));
  for (const item of results) {
    assert.ok(item.relevance_score >= 0 && item.relevance_score <= 100);
    assert.equal("rank" in item, false);
  }
});

test("세부조건(서류)만 맞는 다른 제도 구간이 질문한 사업 구간을 앞서지 않는다", () => {
  const query = plan("장애인 활동지원 서비스 신청 방법과 서류");
  const results = fuseSearchCandidates([
    manual("other", "【 신장장애 장애인등록심사 구비서류 】", 235),
    manual("target", "라. 가족에 의한 활동지원급여 제공 신청서 접수", 235),
  ], query);
  assert.equal(results[0].id, "manual:r:target", JSON.stringify(results.map((item) => item.title)));
  // 여러 장애인 제도를 묶은 문서여서 문서 맥락이 사업명을 모두 담아도 결과가 같아야 한다.
  const context = "2026년 장애인 활동지원 및 장애인등록 업무안내.md 장애인 활동지원";
  const withContext = fuseSearchCandidates([
    { ...manual("other", "【 신장장애 장애인등록심사 구비서류 】", 235), context },
    { ...manual("target", "라. 가족에 의한 활동지원급여 제공 신청서 접수", 235), context },
    { ...manual("review", "신청의 조사(서류심사)", 235), context },
  ], query);
  assert.equal(withContext[0].id, "manual:r:target", JSON.stringify(withContext.map((item) => item.title)));
});

test("사업명을 반복하지 않는 구간 제목도 문서 맥락으로 같은 사업임을 인정하고, 맥락은 응답에 내보내지 않는다", () => {
  const query = plan("2026년 기초연금 선정기준액 단독가구");
  const results = fuseSearchCandidates([
    { ...manual("generic", "기초연금액의 감액 [법 제8조]", 235), context: "2026년 기초연금 사업안내.md 기초연금 > 감액" },
    { ...manual("detail", "∎ 단독가구･부부1인 수급가구", 235), context: "2026년 기초연금 사업안내.md 기초연금 > 선정기준액" },
    { ...manual("elsewhere", "단독가구 기준", 235), context: "2026년 주거급여 사업안내.md 주거급여 > 가구 기준" },
  ], query);
  assert.equal(results[0].id, "manual:r:detail", JSON.stringify(results.map((item) => item.title)));
  assert.ok(results.findIndex((item) => item.id === "manual:r:elsewhere") > results.findIndex((item) => item.id === "manual:r:generic"), "다른 제도 문서의 같은 세부어 구간은 뒤로");
  assert.ok(results.every((item) => !("context" in item)));
});

test("짧은 목차 조각·영문 표지·별지 서식 제목은 잡음으로 본다", () => {
  for (const title of ["서비스", "돌봄", "MINISTRY OF HEALTH & WELFARE", "■ 행정절차법 시행규칙【별지 제8호서식】"]) assert.ok(isNoiseManualTitle("[매뉴얼] " + title), title);
  for (const title of ["통합돌봄", "청소년쉼터", "1 생계지원 (법 시행령 제2조)"]) assert.ok(!isNoiseManualTitle("[매뉴얼] " + title), title);
});

test("예산서 검색어는 의도어·지역명을 빼고 시·군·구 접미사 없는 사업명에도 맞춘다", () => {
  assert.equal(budgetReferenceQuery(plan("충청북도 청년인턴 예산"), { sido: "충청북도", sigungu: "" }), "청년인턴");
  assert.equal(budgetReferenceQuery(plan("2026년 용인시 청년 인턴 예산"), { sido: "", sigungu: "" }), "용인 청년 인턴");
  assert.equal(budgetReferenceQuery(plan("2026년 서귀포시 통합돌봄 예산"), { sido: "제주특별자치도", sigungu: "서귀포시" }), "통합돌봄");
  assert.equal(budgetReferenceQuery(plan("예산 현황"), { sido: "", sigungu: "" }), "", "남는 사업어가 없으면 예산서 후보를 고르지 않는다");
});

test("fusion preserves supplied evidence flags when adding program or empty-body flags", () => {
  const incoming = { ...manual("flagged", "기초연금 신청"), scope_flags: ["YEAR_EXCLUDED", "REGION_MISMATCH"], body_available: false };
  const [result] = fuseSearchCandidates([incoming], plan("주거급여 신청"));
  assert.deepEqual(new Set(result.scope_flags), new Set(["YEAR_EXCLUDED", "REGION_MISMATCH", "PROGRAM_MISMATCH", "EMPTY_SOURCE_BODY"]));
});
