import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRecord, extractManualFetchBody, FAQ_PROFILE } from "./evaluate-golden-qa.mjs";

const id = "manual:test-revision:section-1";
const item = { id: "WFAQ-001", question: "수급 신청 방법을 알려 주세요.", evaluation_profile: FAQ_PROFILE };
const source = {
  document_title: "2026년 안내 모음.md", original_name: "2025년 사업안내.pdf",
  source_year: "2025", source_year_basis: "filename_inferred", applicable_year: null,
  url: "https://example.test/2028/manual.md", location: { start_line: 12, end_line: 18, heading_path: "2027년 개정 이력" },
};
const prefix = "문서: 2026년 안내 모음.md\n내부 원문명: 2025년 사업안내.pdf\n위치: 파싱 Markdown 12–18행 / 2027년 개정 이력\n연도 표기: 2025 (filename_inferred, 적용연도 확인값 아님)\n출처: https://example.test/2028/manual.md\n\n";
const warning = "2030년 적용 여부는 확인되지 않았습니다.";
const card = (body, { offset = 0, total = offset + Array.from(body).length } = {}) => {
  const returned = Array.from(body).length, truncated = offset + returned < total;
  const next = truncated ? offset + returned : null;
  const continuation = truncated ? "\n\n이 구간의 본문이 더 있습니다. get_manual_section에 같은 section_id와 next_offset=" + next + "을 전달해 이어 읽으세요." : "";
  return { id, text: prefix + body + continuation + "\n\n" + warning,
    metadata: { entity_type: "manual_section", sources: [source], warnings: [warning],
      excerpt: { offset, returned_chars: returned, total_chars: total, next_offset: next, truncated } } };
};
const observed = (payload) => evaluateRecord(item, {
  search: { arguments: { query: item.question }, result: { results: [{ id, title: source.document_title }] } },
  fetched: [{ id, rank: 1, result: payload }],
});

test("카드 표제·파일명 연도·위치·URL·경고를 본문 연도로 세지 않는다", () => {
  const row = observed(card("읍면동에 신청합니다.")), hit = row.candidates[0];
  assert.equal(hit.body_present, true);
  assert.deepEqual(hit.year_provenance.body_year_mentions, []);
  assert.equal(hit.year_provenance.body_basis, "MANUAL_BODY_FROM_VERIFIED_CARD_FRAME");
  assert.ok(hit.year_provenance.source_year_fields.some((field) => field.value === "2025"));
  assert.equal(hit.year_provenance.applicability, "NOT_EVALUATED");
  assert.equal(hit.body_observation_error, null);
});

test("실제 본문의 연도 언급만 남기며 적용연도 정답으로 승격하지 않는다", () => {
  const hit = observed(card("2024년 개정 내용이며 시행일은 2023-12-01입니다.")).candidates[0];
  assert.deepEqual(hit.year_provenance.body_year_mentions, ["2023", "2024"]);
  assert.equal(hit.year_provenance.applicability, "NOT_EVALUATED");
});

test("본문이 비어 있으면 카드 안내문만으로 본문 존재를 만들지 않는다", () => {
  const payload = card("");
  assert.equal(extractManualFetchBody(payload), "");
  const row = observed(payload);
  assert.equal(row.candidates[0].body_present, false);
  assert.equal(row.faq_observation.manual_section_body_present, false);
  assert.deepEqual(row.candidates[0].year_provenance.body_year_mentions, []);
});

test("부분 응답의 Unicode 문자 수와 CRLF·본문 내부 출처 표기를 보존한다", () => {
  const body = "가😀나\r\n출처: 2024년 실제 본문\n끝";
  const payload = card(body, { offset: 9, total: 100 });
  assert.equal(extractManualFetchBody(payload), body);
  const hit = observed(payload).candidates[0];
  assert.equal(hit.body_extent.returned_chars, Array.from(body).length);
  assert.equal(hit.body_extent.offset, 9);
  assert.equal(hit.body_extent.truncated, true);
  assert.deepEqual(hit.year_provenance.body_year_mentions, ["2024"]);
});

test("깨진 프레임·본문 길이·이어읽기 메타데이터를 카드 전체 fallback으로 집계하지 않는다", () => {
  const changes = [
    (payload) => { payload.text = payload.text.replace("문서: ", "다른 표제: "); },
    (payload) => { payload.text += "\n2029년 누락된 경고"; },
    (payload) => { payload.metadata.excerpt.returned_chars -= 1; },
    (payload) => { payload.metadata.excerpt.returned_chars = 9000; },
    (payload) => { payload.metadata.excerpt.next_offset = 12; },
    (payload) => { delete payload.metadata.excerpt; },
  ];
  for (const change of changes) {
    const payload = structuredClone(card("2024년 신청 기준")); change(payload);
    assert.throws(() => extractManualFetchBody(payload), /Manual fetch/);
    const row = observed(payload), hit = row.candidates[0];
    assert.equal(hit.fetched, true);
    assert.equal(hit.body_present, null);
    assert.equal(hit.body_observation_error.code, "MANUAL_CARD_FRAME_UNVERIFIED");
    assert.deepEqual(hit.year_provenance.body_year_mentions, []);
    assert.ok(row.faq_observation.review_required_reasons.includes("MANUAL_BODY_FRAME_UNVERIFIED"));
  }
});

test("별도 명시 body 필드 계약은 카드 표제가 아닌 그 필드를 관찰한다", () => {
  const hit = observed({ ...card("2026년 카드 본문"), body: "2024년 명시 본문" }).candidates[0];
  assert.equal(hit.body_field, "body");
  assert.equal(hit.year_provenance.body_basis, "EXPLICIT_BODY_FIELD");
  assert.deepEqual(hit.year_provenance.body_year_mentions, ["2024"]);
});
