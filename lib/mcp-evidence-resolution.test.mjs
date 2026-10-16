import assert from "node:assert/strict";
import test from "node:test";
import { resolveProgramEvidence } from "./mcp/evidence-resolution.ts";
import { gov24Dto } from "./mcp/gov24.ts";

const EMPTY_BASE = { application_conditions: null, application_method: null, conditions_basis: null };
const REGION = "region:제주특별자치도|서귀포시";
const SUBJECT = "docprog:test-evidence";
const fieldOf = (result, field) => result.evidence_resolution.fields.find((item) => item.field === field);

function document(overrides = {}) {
  return {
    import_id: "import-test", statement_id: "stmt-test", subject_id: SUBJECT, subject_label: "시험사업",
    subject_sido: "제주특별자치도", subject_sigungu: "서귀포시", predicate_id: "target_group", value_text: "등록된 시험 대상",
    unit: null, scope_text: "2026년 기준", source_version_id: "sv-test-2026", reviewed_at: "2026-10-01T00:00:00Z",
    source_id: "src-test", title: "2026년 시험사업 안내", issuer: "시험기관", document_number: "test-1",
    url: "https://example.go.kr/guide", published_date: "2026-01-01", retrieved_at: "2026-10-01T00:00:00Z",
    format: "HWPX", parse_id: "parse-test", parser: "test", rights_basis: "공개 시험 fixture", document_order: 1,
    ...overrides,
  };
}

function service(overrides = {}, requestedYear = 2026) {
  return gov24Dto({
    service_id: "TEST_GOV24", name: "시험사업", org_name: "보건복지부", org_type: "중앙행정기관",
    target: "2026년 상세 지원대상", criteria: "2026년 상세 선정기준", benefit: "2026년 시험 지원내용",
    apply_method: "2026년 주민센터 방문신청", apply_deadline: "2026.01.01 ~ 2026.12.31",
    required_documents: "2026년 신분증과 신청서", reception: "2026년 관할 주민센터", contact: "시험 상담처",
    modified_at: "2026-09-30", detail_modified_at: "2026-09-30", detail_status: "COLLECTED", presence: "PRESENT",
    last_seen_at: 1_791_331_200, detail_fetched_at: 1_791_331_200, detail_url: "https://example.go.kr/gov24",
    ...overrides,
  }, requestedYear);
}

function resolve(options = {}) {
  return resolveProgramEvidence({ base: EMPTY_BASE, documents: [], services: [], currentYear: 2026, requestedYear: 2026,
    subjectId: SUBJECT, programName: "시험사업", regionId: REGION, ...options });
}

test("같은 문서버전의 2025·2026 scope를 분리하고 해당 연도 사실만 선택한다", () => {
  const result = resolve({ documents: [
    document({ statement_id: "old", predicate_id: "benefit_amount", scope_text: "2025년 기준", value_text: "시험지원 100원" }),
    document({ statement_id: "new", predicate_id: "benefit_amount", scope_text: "2026년 기준", value_text: "시험지원 200원" }),
  ] });
  assert.equal(result.benefit, "시험지원 200원");
  const resolved = fieldOf(result, "benefit");
  assert.equal(resolved.evidence_id, "doc:sv-test-2026");
  assert.equal(resolved.alternatives.length, 2);
  assert.deepEqual(resolved.selected.statement_ids, ["new"]);
  assert.equal(resolved.alternatives.find((item) => item.statement_ids.includes("old")).year_status, "YEAR_MISMATCH");
  assert.ok(!result.benefit.includes("100"));
});

test("같은 출처·연도·scope의 benefit_item과 금액·단위는 원문 순서로 자연스럽게 병합한다", () => {
  const result = resolve({ documents: [
    document({ statement_id: "part-amount", predicate_id: "benefit_amount", value_text: "시험 단가 300", unit: "원/회", document_order: 3 }),
    document({ statement_id: "part-item", predicate_id: "benefit_item", value_text: "식사지원 제공", document_order: 2 }),
    document({ statement_id: "period", predicate_id: "operating_period", value_text: "지원기간은 시험 승인일까지", document_order: 4 }),
  ] });
  assert.equal(result.benefit, "식사지원 제공\n시험 단가 300 (단위: 원/회)");
  assert.equal(fieldOf(result, "benefit").selected.parts.length, 2);
  assert.equal(result.eligibility.operating_period, "지원기간은 시험 승인일까지");
});

test("사업·지역이 다른 승인문서는 우선순위가 높아도 현재 사업의 근거가 되지 않는다", () => {
  const result = resolve({ documents: [
    document({ statement_id: "other-program", subject_id: "docprog:other", subject_label: "다른사업", value_text: "다른 사업 대상" }),
    document({ statement_id: "other-city", subject_sigungu: "제주시", value_text: "다른 시 대상" }),
    document({ statement_id: "correct", value_text: "서귀포 해당 사업 대상" }),
  ] });
  assert.equal(result.eligibility.application_conditions, "서귀포 해당 사업 대상");
  const alternatives = fieldOf(result, "application_conditions").alternatives;
  assert.equal(alternatives.find((item) => item.statement_ids.includes("other-program")).program_status, "PROGRAM_MISMATCH");
  assert.equal(alternatives.find((item) => item.statement_ids.includes("other-city")).region_status, "REGION_MISMATCH");
});

test("다른 가구원수 scope의 문서 행을 동일 필드의 하나의 확정값으로 합치지 않는다", () => {
  const result = resolve({ documents: [
    document({ statement_id: "household-one", predicate_id: "benefit_amount", scope_text: "2026년 1인 가구", value_text: "시험지원 400원" }),
    document({ statement_id: "household-four", predicate_id: "benefit_amount", scope_text: "2026년 4인 가구", value_text: "시험지원 700원" }),
  ] });
  assert.equal(result.benefit, null);
  assert.equal(fieldOf(result, "benefit").status, "UNRESOLVED_CONFLICT");
  assert.equal(fieldOf(result, "benefit").pending_candidates.length, 2);
  assert.equal(fieldOf(result, "benefit").alternatives.length, 2);
  assert.equal(result.evidence_resolution.status, "REVIEW_REQUIRED");
});

test("같은 scope·동일 금액항목에 서로 다른 값이 있으면 한 출처라도 확정하지 않는다", () => {
  const result = resolve({ documents: [
    document({ statement_id: "amount-a", predicate_id: "benefit_amount", value_text: "4인 가구 지원금 400원" }),
    document({ statement_id: "amount-b", predicate_id: "benefit_amount", value_text: "4인 가구 지원금 500원" }),
  ] });
  assert.equal(result.benefit, null);
  assert.equal(fieldOf(result, "benefit").status, "UNRESOLVED_CONFLICT");
  assert.equal(fieldOf(result, "benefit").alternatives[0].internal_conflict, true);
});

test("서로 다른 가구 scope에서 값이 우연히 같아도 적용행을 임의 확정하지 않는다", () => {
  const result = resolve({ documents: [
    document({ statement_id: "same-amount-one", predicate_id: "benefit_amount", scope_text: "2026년 1인 가구", value_text: "시험지원 700원" }),
    document({ statement_id: "same-amount-four", predicate_id: "benefit_amount", scope_text: "2026년 4인 가구", value_text: "시험지원 700원" }),
  ] });
  assert.equal(result.benefit, null);
  assert.equal(fieldOf(result, "benefit").pending_candidates.length, 2);
});

test("발행일·검토일·수집일이 2026년이어도 적용연도가 없는 문서를 2026년 근거로 확정하지 않는다", () => {
  const result = resolve({ documents: [document({ title: "시험사업 안내", scope_text: null })] });
  assert.equal(result.eligibility.application_conditions, null);
  const target = fieldOf(result, "application_conditions");
  assert.equal(target.selected, null);
  assert.equal(target.pending_candidate.source_kind, "APPROVED_DOCUMENT");
  assert.equal(target.pending_candidate.year_status, "YEAR_UNCONFIRMED");
  assert.equal(target.final_authority, false);
  assert.equal(result.evidence_resolution.status, "APPLICABILITY_UNCONFIRMED");
});

test("scope와 값이 다른 연도를 명시하면 제목이 최신이어도 해당 행을 보류한다", () => {
  const result = resolve({ documents: [document({ predicate_id: "benefit_amount", scope_text: "2026년 기준", value_text: "2025년 시험지원 600원" })] });
  assert.equal(result.benefit, null);
  assert.equal(fieldOf(result, "benefit").alternatives[0].year_status, "CONFLICTING_FIELD_SCOPE_YEARS");
});

test("정부24 신청기간 2026년을 연도 미상 지원대상·지원액에 전파하지 않는다", () => {
  const detail = service({ target: "원문에 적힌 지원대상", benefit: "1인 가구 800원", criteria: "별도 기준 확인 필요" });
  assert.ok(detail.year_evidence.explicit_reference_years.includes(2026));
  const result = resolve({ services: [detail] });
  assert.equal(result.eligibility.application_conditions, null);
  assert.equal(result.eligibility.selection_criteria, null);
  assert.equal(result.benefit, null);
  assert.match(result.eligibility.application_period, /2026/);
  assert.equal(fieldOf(result, "application_conditions").pending_candidate.year_status, "YEAR_UNCONFIRMED");
  assert.equal(fieldOf(result, "benefit").pending_candidate.year_status, "YEAR_UNCONFIRMED");
});

test("여러 연도 서비스에서도 각 필드의 연도를 독립적으로 판단한다", () => {
  const result = resolve({ services: [service({ benefit: "2025년 1인 가구 900원", target: "2026년 해당 지원대상" })] });
  assert.equal(result.eligibility.application_conditions, "2026년 해당 지원대상");
  assert.equal(result.benefit, null);
  assert.equal(fieldOf(result, "benefit").alternatives[0].year_status, "YEAR_MISMATCH");
  assert.equal(fieldOf(result, "application_conditions").final_authority, true);
});

test("field_year_evidence가 누락되어도 서비스 전체 요약연도를 대체 적용하지 않는다", () => {
  const detail = service();
  const result = resolve({ services: [{ ...detail, field_year_evidence: undefined }] });
  assert.equal(result.eligibility.application_conditions, null);
  assert.equal(fieldOf(result, "application_conditions").pending_candidate.year_status, "FIELD_YEAR_METADATA_MISSING");
  assert.equal(result.benefit, null);
});

test("연도 미지정에서는 비금액 원문 설명을 미확인 표시로 제공하고 금액 권위선택은 보류한다", () => {
  const result = resolve({ requestedYear: null, services: [service({ target: "등록된 지원대상", apply_method: "행정복지센터 방문", benefit: "1인 가구 1100원" }, null)],
    base: { application_conditions: "누구나", application_method: "문의", conditions_basis: "source_target" } });
  assert.equal(result.eligibility.application_conditions, "등록된 지원대상");
  assert.equal(result.eligibility.application_method, "행정복지센터 방문");
  assert.equal(fieldOf(result, "application_conditions").status, "SELECTED_YEAR_UNCONFIRMED");
  assert.equal(fieldOf(result, "application_conditions").final_authority, false);
  assert.equal(result.benefit, null);
  assert.ok(result.eligibility.unknowns.some((item) => item.includes("지원대상") && item.includes("적용연도")));
  const plainBenefit = resolve({ requestedYear: null, services: [service({ benefit: "안전확인 방문 제공", criteria: "소득금액 1100원 이하" }, null)] });
  assert.equal(plainBenefit.benefit, "안전확인 방문 제공");
  assert.equal(fieldOf(plainBenefit, "benefit").final_authority, false);
  assert.equal(plainBenefit.eligibility.selection_criteria, null);
});

test("출처순위에 앞서 적용연도를 검사하고 적용 가능한 승인 문서는 상세정보보다 우선한다", () => {
  const oldDocument = document({ title: "2025년 안내", scope_text: "2025년", value_text: "구년도 대상" });
  const currentDetail = service({ target: "2026년 최신 상세 대상" });
  const outdated = resolve({ documents: [oldDocument], services: [currentDetail] });
  assert.equal(outdated.eligibility.application_conditions, "2026년 최신 상세 대상");
  assert.equal(fieldOf(outdated, "application_conditions").source_kind, "GOV24_DETAIL");
  const approved = resolve({ documents: [document({ value_text: "승인된 현재 대상" })], services: [currentDetail] });
  assert.equal(approved.eligibility.application_conditions, "승인된 현재 대상");
  assert.equal(fieldOf(approved, "application_conditions").source_kind, "APPROVED_DOCUMENT");
});

test("정부24 상세정보를 목록보다 우선하고 동순위 상세 충돌은 확정하지 않는다", () => {
  const detail = service({ service_id: "DETAIL", target: "2026년 상세 대상" });
  const list = service({ service_id: "LIST", detail_status: "NOT_COLLECTED", target: "2026년 목록 요약 대상" });
  assert.equal(resolve({ services: [list, detail] }).eligibility.application_conditions, "2026년 상세 대상");
  const secondDetail = service({ service_id: "SECOND", target: "2026년 상충되는 대상" });
  const conflict = resolve({ services: [detail, secondDetail] });
  assert.equal(conflict.eligibility.application_conditions, null);
  assert.equal(fieldOf(conflict, "application_conditions").status, "UNRESOLVED_CONFLICT");
  const equivalent = resolve({ services: [detail, service({ service_id: "COPY", target: "2026년 상세 대상" })] });
  assert.equal(equivalent.eligibility.application_conditions, "2026년 상세 대상");
});

test("검토된 연결은 다른 서비스명을 허용하지만 다른 지역의 자격으로 대체하지 않는다", () => {
  const linked = service({ name: "공식 원천의 다른 표기", service_id: "LINKED", target: "2026년 연결된 공식 대상" });
  assert.equal(resolve({ services: [linked] }).eligibility.application_conditions, null);
  assert.equal(resolve({ services: [linked], verifiedServiceIds: [linked.id] }).eligibility.application_conditions, "2026년 연결된 공식 대상");
  assert.equal(resolve({ services: [linked], verifiedServiceIds: [linked.service_id] }).eligibility.application_conditions, "2026년 연결된 공식 대상");
  const wrongCity = service({ org_name: "제주특별자치도 제주시", org_type: "지자체", target: "2026년 제주시 대상" });
  assert.equal(resolve({ services: [wrongCity], verifiedServiceIds: [wrongCity.id] }).eligibility.application_conditions, null);
  const province = service({ org_name: "제주특별자치도", org_type: "지자체" });
  assert.equal(fieldOf(resolve({ services: [province] }), "application_conditions").selected.region_status, "ANCESTOR_SCOPE");
});

test("상위범위 제외는 정부24 도·전국 상세와 목록을 제외하고 동일 시군구 근거는 유지한다", () => {
  for (const detail_status of ["COLLECTED", "NOT_COLLECTED"]) {
    const province = service({ service_id: "PROVINCE", org_name: "제주특별자치도", org_type: "지자체", target: "2026년 도 대상", detail_status });
    const national = service({ service_id: "NATIONAL", target: "2026년 전국 대상", detail_status });
    const local = service({ service_id: "LOCAL", org_name: "제주특별자치도 서귀포시", org_type: "지자체", target: "2026년 시 대상", detail_status });
    const result = resolve({ services: [province, national, local], includeAncestorScope: false });
    const target = fieldOf(result, "application_conditions");
    assert.equal(result.eligibility.application_conditions, "2026년 시 대상");
    assert.equal(target.final_authority, true);
    assert.equal(target.selected.region_status, "MATCHED");
    assert.ok(target.alternatives.filter((candidate) => candidate.program_id !== local.id).every((candidate) => candidate.region_status === "REGION_MISMATCH" && !candidate.applicability_confirmed));
    assert.equal(resolve({ services: [province, national], includeAncestorScope: false }).eligibility.application_conditions, null);
    assert.equal(resolve({ services: [province] }).eligibility.application_conditions, "2026년 도 대상", "옵션 생략은 상위범위를 허용한다");
    assert.equal(resolve({ services: [national] }).eligibility.application_conditions, "2026년 전국 대상");
    for (const source of [province, national]) {
      const same = resolve({ services: [source], regionId: source.publisher_scope.region_id, includeAncestorScope: false });
      assert.equal(same.eligibility.application_conditions, source.target, "전국·도 요청과 동일한 원천 범위는 유지한다");
      assert.equal(fieldOf(same, "application_conditions").selected.region_status, "MATCHED");
    }
  }
});

test("승인문서도 상위범위 제외를 지키며 다른 출처보다 순위가 높아도 범위를 우회하지 않는다", () => {
  const province = document({ statement_id: "province-scope", subject_sigungu: "제주특별자치도", value_text: "승인 도 대상" });
  const national = document({ statement_id: "national-scope", subject_sido: "전국", subject_sigungu: "", value_text: "승인 전국 대상" });
  const local = document({ statement_id: "local-scope", value_text: "승인 시 대상" });
  const result = resolve({ documents: [province, national, local], includeAncestorScope: false });
  assert.equal(result.eligibility.application_conditions, "승인 시 대상");
  assert.deepEqual(fieldOf(result, "application_conditions").selected.statement_ids, ["local-scope"]);
  assert.ok(fieldOf(result, "application_conditions").alternatives.filter((candidate) => !candidate.statement_ids.includes("local-scope")).every((candidate) => candidate.region_status === "REGION_MISMATCH"));
  assert.equal(resolve({ documents: [province, national], includeAncestorScope: false }).eligibility.application_conditions, null);
  assert.equal(resolve({ documents: [province] }).eligibility.application_conditions, "승인 도 대상");
  assert.equal(resolve({ documents: [national], regionId: "region:전국", includeAncestorScope: false }).eligibility.application_conditions, "승인 전국 대상");
  assert.equal(resolve({ documents: [province], regionId: "region:제주특별자치도", includeAncestorScope: false }).eligibility.application_conditions, "승인 도 대상");
  const localDetail = service({ org_name: "제주특별자치도 서귀포시", org_type: "지자체", target: "2026년 공식 시 대상" });
  assert.equal(resolve({ documents: [province], services: [localDetail] }).eligibility.application_conditions, "승인 도 대상");
  assert.equal(resolve({ documents: [province], services: [localDetail], includeAncestorScope: false }).eligibility.application_conditions, "2026년 공식 시 대상");
});

test("기본 카드 원래 범위를 질문 지역으로 바꾸지 않고 상위범위 제외를 동일하게 적용한다", () => {
  const base = { application_conditions: "카드 원문의 지원대상", application_method: "카드 원문의 신청방법", conditions_basis: "source_target" };
  for (const baseRegionId of ["region:제주특별자치도", "region:전국"]) {
    const blocked = resolve({ base, baseRegionId, requestedYear: null, includeAncestorScope: false });
    assert.equal(blocked.eligibility.application_conditions, null);
    assert.equal(blocked.eligibility.application_method, null);
    assert.equal(fieldOf(blocked, "application_conditions").alternatives[0].region_id, baseRegionId);
    assert.equal(fieldOf(blocked, "application_conditions").alternatives[0].region_status, "REGION_MISMATCH");
    assert.equal(blocked.evidence_resolution.include_ancestor_scope, false);
    assert.equal(blocked.evidence_resolution.base_region_id, baseRegionId);
    const included = resolve({ base, baseRegionId, requestedYear: null });
    assert.equal(included.eligibility.application_conditions, base.application_conditions);
    assert.equal(fieldOf(included, "application_conditions").status, "SELECTED_YEAR_UNCONFIRMED");
    assert.equal(fieldOf(included, "application_conditions").final_authority, false);
  }
  for (const baseRegionId of [REGION, "region:제주특별자치도", "region:전국"]) {
    const same = resolve({ base, baseRegionId, regionId: baseRegionId, requestedYear: null, includeAncestorScope: false });
    assert.equal(same.eligibility.application_conditions, base.application_conditions);
    assert.equal(fieldOf(same, "application_conditions").selected.region_status, "MATCHED");
  }
  const sibling = resolve({ base, baseRegionId: "region:제주특별자치도|제주시", requestedYear: null });
  assert.equal(sibling.eligibility.application_conditions, null, "상위 허용이 형제 시의 범위를 넓히지 않는다");
});

test("기본 카드의 원천 지역이 없으면 요청 지역을 출처 범위로 추정하지 않는다", () => {
  const base = { application_conditions: "범위 미확인 카드", application_method: null, conditions_basis: "source_target" };
  for (const includeAncestorScope of [true, false]) {
    const result = resolve({ base, requestedYear: null, includeAncestorScope });
    assert.equal(result.eligibility.application_conditions, null);
    assert.equal(fieldOf(result, "application_conditions").final_authority, false);
    assert.equal(fieldOf(result, "application_conditions").alternatives[0].region_id, null);
    assert.equal(fieldOf(result, "application_conditions").alternatives[0].region_status, "REGION_UNCONFIRMED");
  }
});

test("원천에 없는 서류와 오래된 상세 서류를 만들거나 최신 목록에 덧붙이지 않는다", () => {
  const missing = resolve({ services: [service({ required_documents: null })] });
  assert.equal(missing.eligibility.required_documents, null);
  assert.equal(fieldOf(missing, "required_documents").status, "EVIDENCE_MISSING");
  const stale = service({ modified_at: "2026-10-01", detail_modified_at: "2026-09-30", required_documents: "2026년 오래된 상세 서류" });
  assert.equal(stale.detail_status, "STALE");
  assert.equal(stale.required_documents, null);
  assert.equal(resolve({ services: [stale] }).eligibility.required_documents, null);
});

test("질문 숫자·예산·보도자료를 문서 근거로 받을 수 없고 근거 없음은 성공이 아니다", () => {
  const documents = [
    document({ statement_id: "budget", subject_id: "budget_line:one", predicate_id: "benefit_amount", value_text: "예산 999원" }),
    document({ statement_id: "news", source_kind: "OFFICIAL_PRESS_RELEASE", predicate_id: "benefit_amount", value_text: "보도 999원" }),
    document({ statement_id: "question", assertion_type: "user_input", predicate_id: "benefit_amount", value_text: "질문 999원" }),
    document({ statement_id: "unapproved", review_status: "pending", value_text: "미승인 대상" }),
  ];
  const result = resolve({ documents, base: { application_conditions: "200만원 맞죠", application_method: null, conditions_basis: "USER_QUERY" } });
  assert.equal(result.benefit, null);
  assert.equal(result.eligibility.application_conditions, null);
  assert.equal(result.evidence_resolution.status, "EVIDENCE_MISSING");
  assert.equal(result.evidence_resolution.selected_field_count, 0);
  assert.equal(result.evidence_resolution.complete, false);
  assert.equal(result.evidence_resolution.human_review, "PENDING");
  assert.equal(resolve().evidence_resolution.status, "EVIDENCE_MISSING");
});

test("지역 미확인 자료와 서로 다른 문서사업을 암묵적으로 하나의 사업으로 병합하지 않는다", () => {
  const unknownRegion = service({ org_name: "관할 미확인 기관", org_type: "기타" });
  assert.equal(resolve({ services: [unknownRegion] }).eligibility.application_conditions, null);
  assert.equal(fieldOf(resolve({ services: [unknownRegion] }), "application_conditions").alternatives[0].region_status, "REGION_UNCONFIRMED");
  const mixed = resolveProgramEvidence({ base: EMPTY_BASE, documents: [document(), document({ subject_id: "docprog:other", subject_label: "다른사업", statement_id: "other" })], services: [], requestedYear: 2026, currentYear: 2026 });
  assert.equal(mixed.eligibility.application_conditions, null);
  assert.ok(fieldOf(mixed, "application_conditions").alternatives.every((item) => item.program_status === "PROGRAM_UNCONFIRMED"));
});

test("Gov24 exact input placeholders are absent from resolved eligibility while original text remains", () => {
  for (const value of ["직접입력", " 직접입력 "]) {
    const original = service({ apply_method: value }, null);
    const result = resolve({ services: [original], requestedYear: null });
    assert.equal(result.eligibility.application_method, null);
    assert.equal(fieldOf(result, "application_method").status, "EVIDENCE_MISSING");
    assert.equal(original.apply_method, value.trim());
  }
  const meaningful = resolve({ services: [service({ apply_method: "신청서에 직접입력 후 주민센터 제출" }, null)], requestedYear: null });
  assert.equal(meaningful.eligibility.application_method, "신청서에 직접입력 후 주민센터 제출");
});
