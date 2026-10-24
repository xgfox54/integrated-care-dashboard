import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { refineWelfareQuery } from "./mcp/query-refiner.ts";

const refine = (question) => refineWelfareQuery(question, { currentYear: 2026 });

test("short nouns ending in a particle syllable survive both term-normalization passes", () => {
  for (const noun of ["병가", "휴가", "허가"]) {
    const result = refine("종사자 " + noun + " 기준");
    assert.ok(result.search_tokens.includes(noun), JSON.stringify(result.search_tokens));
    assert.ok(result.detail_terms.includes(noun), JSON.stringify(result.detail_terms));
    assert.ok(refine("종사자 " + noun + "는 기준").detail_terms.includes(noun));
  }
});

test("application-result lookup needs a subject while preserving status-check intent", () => {
  const generic = refine("서귀포시 신청 결과 조회");
  assert.equal(generic.search_query, "");
  assert.deepEqual(generic.detail_terms, []);
  assert.ok(generic.fact_types.includes("status_check"));
  assert.ok(generic.warnings.includes("NO_SEARCH_TERMS"));
  const specific = refine("서귀포시 기초연금 신청 결과 조회");
  assert.deepEqual(specific.search_tokens, ["기초연금"]);
  assert.ok(!specific.detail_terms.includes("결과"));
  assert.ok(specific.fact_types.includes("status_check"));
});

test("district suffixes cannot become another province and exclusive city particles preserve scope", () => {
  for (const question of ["부산 해운대구 복지사업", "부산광역시 해운대구 복지사업"]) {
    assert.equal(refine(question).region_id, "region:부산광역시|해운대구", question);
  }
  assert.equal(refine("대구광역시 복지사업").region_id, "region:대구광역시");
  assert.equal(refine("부산과 대구 복지사업").region_source, "ambiguous");
  assert.equal(refine("제주시만 온정가게").region_id, "region:제주특별자치도|제주시");
});

test("payment amount wording preserves amount and document facts together", () => {
  for (const phrase of ["지급액", "급여액", "급여금액"]) {
    const result = refine(`기초연금 ${phrase}과 구비서류 알려줘`);
    assert.ok(result.intents.includes("amount"), phrase);
    assert.ok(result.fact_types.includes("amount"), phrase);
    assert.ok(result.fact_types.includes("document"), phrase);
  }
});

test("긴 자연어의 조건과 의도는 보존하고 질문 서술어는 검색 AND에서 분리한다", () => {
  const question = "현재 신청서를 검토하고 있습니다. ".repeat(8) + "혼자 살고 월소득이 있는 사람이 기초연금을 받을 수 있는지 검토할 때 필요한 조건을 알려줘";
  assert.ok(question.length > 100);
  const result = refine(question);
  assert.equal(result.raw_query, question);
  assert.deepEqual(result.search_tokens, ["기초연금"]);
  assert.deepEqual(result.programs, ["기초연금"]);
  assert.ok(result.intents.includes("case_review"));
  assert.ok(result.intents.includes("eligibility"));
  assert.ok(result.subject_conditions.includes("월소득"));
});

test("띄어쓰기·약칭을 정규화하되 더 긴 시스템명을 다른 사업으로 쪼개지 않는다", () => {
  assert.deepEqual(refine("장애인 활동 지원 신청 방법 알려줘").programs, ["장애인 활동지원"]);
  assert.deepEqual(refine("기초노령연금 신청 서류").programs, ["기초연금"]);
  assert.deepEqual(refine("지투사업 대상 조건").programs, ["지역사회서비스 투자사업"]);
  assert.deepEqual(refine("행복E음 매뉴얼").programs, ["행복이음"]);
  assert.deepEqual(refine("통합 돌봄 지원 정보 시스템 절차").programs, ["통합돌봄지원정보시스템"]);
  assert.deepEqual(refine("국민기초생활보장 생계급여 기준").programs, ["생계급여"]);
});

test("다른 복합어 안의 짧은 별칭을 독립 사업명으로 해석하지 않는다", () => {
  for (const question of [
    "교육활동지원비 지급 절차를 알려줘",
    "교육 활동지원비 신청 방법",
    "사회활동지원사업의 안내 자료",
  ]) {
    const result = refine(question);
    assert.ok(!result.programs.includes("장애인 활동지원"), question);
    assert.ok(!result.search_query.includes("장애인"), question);
  }
  assert.ok(refine("교육활동지원비 지급 절차").search_tokens.includes("교육활동지원비"));
  assert.ok(!refine("지역맞춤돌봄사업 신청 안내").programs.includes("노인맞춤돌봄"));
  assert.deepEqual(refine("교육급여의 교육활동지원비 신청 안내").programs, ["교육급여"]);
  assert.deepEqual(refine("교육 급여와 장애인 활동 지원의 신청 절차 비교").programs, ["교육급여", "장애인 활동지원"]);
});

test("독립된 약칭의 조사·서비스 접미사와 명시한 긴 사업명은 유지한다", () => {
  for (const question of ["활동지원을 신청하려면", "활동지원서비스 대상", "활동지원사의 업무", "장애인 활동 지원 신청"]) {
    assert.deepEqual(refine(question).programs, ["장애인 활동지원"], question);
  }
  assert.deepEqual(refine("맞춤돌봄사업 이용 절차").programs, ["노인맞춤돌봄"]);
  assert.deepEqual(refine("기초생활보장제도 신청").programs, ["국민기초생활보장"]);
});

test("원천에 명시된 교육·가사간병·문화이용권 이름의 중립 별칭을 인식한다", () => {
  assert.deepEqual(refine("교육 급여 신청 창구").programs, ["교육급여"]);
  for (const question of ["가사간병 지원 신청", "가사·간병 방문지원사업 절차", "가사･간병 방문지원 신청"]) {
    assert.deepEqual(refine(question).programs, ["가사간병"], question);
    assert.deepEqual(refine(question).search_tokens, ["가사간병"], question);
  }
  for (const question of ["문화 누리 카드 신청", "문화누리 이용 방법", "통합문화이용권 발급 절차"]) {
    const result = refine(question);
    assert.deepEqual(result.programs, ["문화누리카드"], question);
    assert.deepEqual(result.search_queries, ["문화누리카드", "통합문화이용권"], question);
  }
});

test("포함 연도와 제외 연도를 문장 순서에 관계없이 분리한다", () => {
  for (const question of [
    "2026년 생계급여 기준. 2025년 기준과 섞지 말고 2026년 자료만 사용해줘",
    "2025년 기준은 빼고 2026년 생계급여 알려줘",
    "2026년 생계급여만 알려줘. 2025년 자료를 사용하지 마",
  ]) {
    const result = refine(question);
    assert.equal(result.year, 2026, question);
    assert.equal(result.requested_year, 2026, question);
    assert.deepEqual(result.excluded_years, [2025], question);
  }
  assert.deepEqual(refine("2024년과 2025년은 제외하고 2026년 생계급여").excluded_years, [2024, 2025]);
});

test("비교·상충 연도는 하나의 기준연도로 강제하지 않는다", () => {
  const comparison = refine("2025년과 2026년 생계급여 기준을 비교해줘");
  assert.equal(comparison.year, null);
  assert.equal(comparison.year_source, "comparison");
  assert.deepEqual(comparison.requested_years, [2025, 2026]);
  const ambiguous = refine("2025년 2026년 생계급여 기준");
  assert.equal(ambiguous.year, null);
  assert.equal(ambiguous.year_source, "ambiguous");
  const conflict = refine("2026년 생계급여. 2026년 자료는 제외해줘");
  assert.equal(conflict.year, null);
  assert.ok(conflict.warnings.includes("CONFLICTING_YEAR_CONSTRAINTS"));
});

test("KST 현재연도와 명시·상대연도를 구별하며 질문에 없는 구판 연도를 추측하지 않는다", (context) => {
  const original = Date.now;
  context.after(() => { Date.now = original; });
  Date.now = () => Date.parse("2026-12-31T15:01:00Z");
  const defaultYear = refineWelfareQuery("행복이음 업무 기준");
  assert.equal(defaultYear.current_year, 2027);
  assert.equal(defaultYear.year, 2027);
  assert.equal(defaultYear.requested_year, null);
  assert.equal(defaultYear.year_source, "current_default");
  const relative = refineWelfareQuery("작년은 빼고 올해 생계급여 기준");
  assert.equal(relative.year, 2027);
  assert.equal(relative.year_source, "relative");
  assert.deepEqual(relative.excluded_years, [2026]);
  assert.equal(refineWelfareQuery("2024년 행복이음 업무 기준").year, 2024);
});

test("다른 사업을 섞지 말라는 지시는 제외 사업에만 적용한다", () => {
  for (const question of [
    "기초연금 기준을 알려줘. 생계급여 조건은 섞지 마",
    "생계급여는 빼고 기초연금의 자격 기준을 알려줘",
    "생계급여가 아니라 기초연금 기준을 알려줘",
  ]) {
    const result = refine(question);
    assert.deepEqual(result.programs, ["기초연금"], question);
    assert.deepEqual(result.excluded_programs, ["생계급여"], question);
    assert.ok(result.search_queries.every((query) => !query.includes("생계급여")), question);
  }
  const shared = refine("주거급여와 부모급여는 제외하고 기초연금");
  assert.deepEqual(shared.excluded_programs, ["주거급여", "부모급여"]);
  assert.deepEqual(shared.programs, ["기초연금"]);
});

test("부정한 조건 뒤의 독립 요청 사업은 검색에서 사라지지 않는다", () => {
  for (const question of [
    "차상위가 아닌 가구도 가사간병 지원을 신청할 수 있나요?",
    "차상위도 아닌 상황입니다. 가사·간병 방문지원의 신청 절차를 알려줘",
    "차상위는 제외하고 가사 간병 지원의 안내를 찾아줘",
  ]) {
    const result = refine(question);
    assert.deepEqual(result.excluded_programs, ["차상위계층"], question);
    assert.deepEqual(result.programs, ["가사간병"], question);
    assert.deepEqual(result.search_tokens, ["가사간병"], question);
    assert.ok(!result.warnings.includes("NO_INCLUDED_PROGRAM"), question);
  }
});

test("사전에 없는 긍정 주제도 앞선 다른 사업 제외 지시와 분리한다", () => {
  for (const [question, expected] of [
    ["차상위 조건은 빼고 안부확인 신청 절차를 알려줘", ["안부확인"]],
    ["주거급여와 부모급여는 제외하고 방문상담 사업을 찾아주세요", ["방문상담"]],
    ["2025년 자료와 주거급여는 빼고 2026년 안부확인 기준", ["안부확인"]],
  ]) {
    const result = refine(question);
    assert.deepEqual(result.programs, [], question);
    assert.deepEqual(result.search_tokens, expected, question);
    assert.ok(result.excluded_programs.length > 0, question);
  }
  assert.equal(refine("주거급여는 빼고 방문상담도 제외해줘").search_query, "");
});

test("제외 지시의 동사만 남으면 긍정 검색어를 만들어내지 않는다", () => {
  for (const question of [
    "생계급여는 제외해 주세요",
    "기초연금 자료는 사용하지 마세요",
    "부모급여와 주거급여는 빼고",
    "제외: 기초연금",
  ]) {
    const result = refine(question);
    assert.equal(result.search_query, "", question);
    assert.deepEqual(result.search_tokens, [], question);
    assert.ok(result.warnings.includes("NO_INCLUDED_PROGRAM"), question);
  }
});

test("사업의 제외대상 질문과 제외하지 말라는 지시는 사업 제외로 오해하지 않는다", () => {
  for (const question of ["노인맞춤돌봄 제외대상이나 예외 조건 알려줘", "노인맞춤돌봄의 제외 조건", "노인맞춤돌봄은 제외하지 말고 알려줘"]) {
    const result = refine(question);
    assert.deepEqual(result.programs, ["노인맞춤돌봄"], question);
    assert.deepEqual(result.excluded_programs, [], question);
  }
  assert.ok(refine("노인맞춤돌봄 제외대상이나 예외 조건 알려줘").intents.includes("exception"));
});

test("서귀포 행정시와 제주 광역범위를 구별하고 하위서비스는 원사업에 결합한다", () => {
  const result = refine("서귀포에서 제주가치돌봄 식사지원 업무를 처리할 때 적용 기준 알려줘");
  assert.equal(result.region_id, "region:제주특별자치도|서귀포시");
  assert.equal(result.region_source, "explicit");
  assert.equal(result.include_ancestor_scope, true);
  assert.deepEqual(result.programs, ["제주가치돌봄"]);
  assert.deepEqual(result.subservices, ["식사지원"]);
  assert.ok(result.search_queries.includes("제주가치돌봄 식사지원"));
  assert.ok(!result.search_queries.includes("식사지원"));
  assert.equal(refine("제주시에서 제주가치돌봄").region_id, "region:제주특별자치도|제주시");
  assert.equal(refine("제주도 제주가치돌봄").region_id, "region:제주특별자치도");
  assert.equal(refine("서귀포에서 제주가치돌봄 광역 사업 제외").include_ancestor_scope, false);
});

test("질문에 없는 서귀포·기관 기본지역을 임의 지정하지 않는다", () => {
  const impliedProvince = refine("제주가치돌봄 기준");
  assert.equal(impliedProvince.region_id, "region:제주특별자치도");
  assert.equal(impliedProvince.region_source, "program_hint");
  assert.equal(refine("온정가게 신청·지원 기준을 지역 범위에 맞춰 알려줘").region_id, null);
  assert.equal(refine("지역사회서비스 투자사업 대상 기준 알려줘").region_id, null);
  const multiple = refine("서귀포시와 제주시의 제주가치돌봄 비교");
  assert.equal(multiple.region_id, null);
  assert.equal(multiple.region_source, "ambiguous");
  assert.equal(refine("서울특별시 중랑구 기초연금 기준").region_id, "region:서울특별시|중랑구");
});

test("잘못된 전제의 숫자는 검증되지 않은 사용자 입력으로만 보존한다", () => {
  const result = refine("2026년 긴급복지 4인가구가 200만원 맞죠?");
  assert.equal(result.year, 2026);
  assert.equal(result.household_size, 4);
  assert.deepEqual(result.amounts, [{ raw: "200만원", value: 2_000_000, unit: "KRW", source: "user_input", verified: false, role: "premise_to_verify" }]);
  assert.deepEqual(result.search_tokens, ["긴급복지"]);
  assert.equal(refine("2026년 긴급복지 1인가구가 80만원 맞나요?").amounts[0].value, 800_000);
  // These are user-written examples, not a fixture of official entitlement values.
  assert.equal(refine("재산 1억 2천3백만원인 사람의 생계급여").amounts[0].value, 123_000_000);
  assert.equal(refine("월소득 1.5만 원일 때 주거급여").amounts[0].value, 15_000);
  assert.equal(refine("월소득 0만원인 사람의 기초연금").amounts[0].value, 0);
  const currencyNotYear = refine("월소득 2026 원인 기초연금 대상");
  assert.deepEqual(currencyNotYear.requested_years, []);
  assert.equal(currencyNotYear.amounts[0].value, 2026);
});

test("표·각주, 법령근거와 신청서류 의도를 각각 보존한다", () => {
  assert.ok(refine("생계급여 관련 표에 있는 기준을 항목별로 정리해줘").intents.includes("table"));
  assert.ok(refine("기초연금 법령 조문과 시행규칙 근거").intents.includes("legal_basis"));
  const procedure = refine("청년월세 신청할 때 필요한 서류와 방법");
  assert.ok(procedure.intents.includes("required_documents"));
  assert.ok(procedure.intents.includes("procedure"));
});

test("빈 검색이나 전부 제외된 요청을 무조건 전체사업 검색으로 바꾸지 않는다", () => {
  for (const question of ["", "알려줘", "생계급여는 제외해줘"]) {
    const result = refine(question);
    assert.equal(result.search_query, "", question);
    assert.deepEqual(result.search_tokens, [], question);
    assert.ok(result.warnings.includes("NO_SEARCH_TERMS") || result.warnings.includes("NO_INCLUDED_PROGRAM"));
  }
  assert.deepEqual(refine("안부확인 대상 기준 알려줘").search_tokens, ["안부확인"]);
});

// The full source dataset is supplied by the evaluator, never embedded in the runtime module.
const goldenPath = process.env.WELFARE_GOLDEN_QA_PATH ?? new URL("../quality/golden_qa_v1.4.0.json", import.meta.url);
test("실제 골든200의 기대업무 추출·제외연도·제외사업을 검증한다(최종 답변 정확도 평가는 별도)", { skip: existsSync(goldenPath) ? false : "Private evaluation fixture is excluded from public source" }, () => {
  const source = JSON.parse(readFileSync(goldenPath, "utf8"));
  assert.equal(source.items.length, 200);
  const normalize = (value) => value.replace(/[\s·]/g, "");
  for (const item of source.items) {
    const result = refine(item.question);
    const expected = normalize(item.expected_section);
    const terms = [...result.programs, ...result.subservices].map(normalize);
    // A generic emergency-welfare question identifies the program but does not prove the benefit subtype.
    const sectionFound = terms.some((term) => term.includes(expected)) || expected === "생계지원" && result.programs.includes("긴급복지");
    assert.ok(sectionFound, `${item.id}: expected business family ${item.expected_section}; got ${result.programs.join(", ")}`);
    assert.ok(result.search_query, item.id);
    if (item.category === "year_confusion") {
      assert.equal(result.year, Number(item.expected_year), item.id);
      assert.deepEqual(result.excluded_years, [2025], item.id);
    }
    if (item.category === "program_mix") {
      assert.equal(result.programs.length, 1, item.id);
      assert.equal(result.excluded_programs.length, 1, item.id);
      assert.ok(!result.programs.includes(result.excluded_programs[0]), item.id);
    }
  }
});

test("specific long-term-care home medical programs are not replaced by the insurance parent program", () => {
  for (const question of ["장기요양재택의료시범사업", "장기요양 재택의료센터 시범사업", "부산 해운대구 장기요양 재택의료 신청 방법"]) {
    const result = refine(question);
    assert.deepEqual(result.programs, ["장기요양 재택의료"]);
    assert.deepEqual(result.search_tokens, ["장기요양", "재택의료"]);
    assert.ok(!result.programs.includes("노인장기요양보험"));
  }
  const scoped = refine("부산 해운대구 장기요양 재택의료 신청 방법");
  assert.equal(scoped.region_id, "region:부산광역시|해운대구");
  assert.ok(scoped.intents.includes("procedure"));
  assert.deepEqual(refine("장기요양 등급 신청").programs, ["노인장기요양보험"]);
  const excluded = refine("노인장기요양보험 말고 장기요양재택의료시범사업 안내");
  assert.deepEqual(excluded.programs, ["장기요양 재택의료"]);
  assert.deepEqual(excluded.excluded_programs, ["노인장기요양보험"]);
});

test("붙여 쓴 접속사 '및'을 세부어에서 떼어내고 붙여 쓴 일반 의도어로 근거 충분성을 오판하지 않는다", async () => {
  const { assessAnswerability } = await import("./mcp/search-support.ts");
  const { welfareRelevance } = await import("./mcp/gov24.ts");
  const sunchang = refine("순창군 저소득층 건강보험료및 장기요양보험료 지원사업");
  assert.ok(sunchang.detail_terms.includes("건강보험료"), JSON.stringify(sunchang.detail_terms));
  assert.ok(!sunchang.detail_terms.includes("건강보험료및"));
  const partialTitlePlan = refine("순창군 저소득층 건강보험료 지원");
  assert.ok(welfareRelevance("순창군 저소득층 건강보험료및 장기요양보험료 지원사업", partialTitlePlan) >= 88);
  const unspacedProcedure = refine("서귀포시 노인맞춤돌봄 신청방법 알려줘");
  const assessment = assessAnswerability({
    plan: unspacedProcedure,
    results: [{ entity_type: "manual_section", relevance_score: 90, title: "[매뉴얼] 노인맞춤돌봄 서비스 신청", excerpt: "읍면동 주민센터에 방문하여 신청서를 제출합니다.", sources: [{ document_title: "2026년 노인맞춤돌봄 안내" }] }],
    relaxed: false,
    legalStatus: "NOT_REQUIRED",
  });
  assert.equal(assessment.answerability, "SUPPORTED");
  assert.ok(!assessment.reason_codes.includes("INSUFFICIENT_DETAIL_EVIDENCE"));
});
