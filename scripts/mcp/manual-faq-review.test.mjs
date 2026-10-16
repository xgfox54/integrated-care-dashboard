import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyBoundaryCorrection, applyManualReview, auditManualItem, boundaryRisks, reviewHash } from "./manual-faq-review.mjs";
import { loadFaqTestSuite } from "./faq-test-suite.mjs";
import { evaluateRecord } from "./evaluate-golden-qa.mjs";
import { observeAnswer } from "./evaluate-manual-faq-retrieval.mjs";

const data = JSON.parse(await readFile(new URL("../../quality/manual_faq_20261013.json", import.meta.url), "utf8"));
const plan = JSON.parse(await readFile(new URL("../../quality/manual_faq_20261013.review-plan.json", import.meta.url), "utf8"));
const find = (id) => data.items.find((item) => item.id === id);

test("A시 질문의 잘린 뒷부분을 질문으로 복원하고 답변에서 제거한다", () => {
  const id = "MFAQ-35c3a1ff6a09";
  const original = find(id);
  const fixed = applyBoundaryCorrection(original, plan.corrections[id]);
  assert.ok(fixed.raw_question.endsWith("A시에 신청하러 가야하나요?"));
  assert.ok(fixed.reference_answer.startsWith("아니요."));
  assert.equal(fixed.reference.answer_start_line, 2784);
  assert.equal(fixed.reference.excerpt_sha256, reviewHash(fixed.reference.excerpt));
  assert.ok(original.reference_answer.startsWith("시에"));
});

test("원문에서 다른 문항·부록·발행 정보를 제거하고 계산기 답변을 복원한다", () => {
  for (const id of ["MFAQ-9fd3ff405af8", "MFAQ-1c887a4c3edf", "MFAQ-442c93f018ce"]) {
    const fixed = applyBoundaryCorrection(find(id), plan.corrections[id]);
    assert.deepEqual(boundaryRisks(fixed), []);
    assert.doesNotMatch(fixed.reference_answer, /인쇄일|건강보험료 소득판정기준표|Chapter/);
  }
  const calc = applyBoundaryCorrection(find("MFAQ-442c93f018ce"), plan.corrections["MFAQ-442c93f018ce"]);
  assert.match(calc.reference_answer, /소득인정액.*기준으로 계산/s);
  assert.doesNotMatch(calc.raw_question, /•/);
  const housing = applyBoundaryCorrection(find("MFAQ-9fbae4db7f2c"), plan.corrections["MFAQ-9fbae4db7f2c"]);
  assert.doesNotMatch(housing.reference_answer, /4-130|무허가/);
  assert.deepEqual(auditManualItem(find(housing.id), plan.corrections[housing.id], true).risks, ["SOURCE_SCENARIO_DATE_REVIEW"]);
});

test("다른 FAQ가 섞인 표와 참조뿐인 답변을 격리하며 짧은 정상 답변은 유지한다", () => {
  assert.ok(boundaryRisks(find("MFAQ-9c5767752bed")).includes("TABLE_COLUMNS_MIXED_IN_QUESTION"));
  assert.ok(boundaryRisks(find("MFAQ-a3660e1db490")).includes("CROSS_REFERENCE_NEEDS_BODY"));
  assert.deepEqual(boundaryRisks(find("MFAQ-946a470c0225")), []);
});

test("원문 밖 범위·질문 답변 중복·다른 발췌문으로 교정을 적용할 수 없다", () => {
  const item = find("MFAQ-35c3a1ff6a09");
  const correction = plan.corrections[item.id];
  assert.throws(() => applyBoundaryCorrection(item, { ...correction, answer_lines: [2784, 3000] }), /범위/);
  assert.throws(() => applyBoundaryCorrection(item, { ...correction, answer_lines: [2780, 2784] }), /범위/);
  assert.throws(() => applyBoundaryCorrection(item, { ...correction, source_excerpt_sha256: "0".repeat(64) }), /근거/);
  const audit = auditManualItem(item, correction, true);
  assert.throws(() => applyManualReview(item, { ...audit, reference_answer_usable: true }), /검수 상태/);
});

test("격리 상태가 평가 보고서에 남으며 정답률로 자동 승격되지 않는다", async () => {
  const suite = await loadFaqTestSuite(new URL("../../quality/faq-test-suite.json", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
  const item = suite.items.find((row) => row.id === "MFAQ-d772f4e6b3fc");
  assert.equal(item.retrieval_probe_eligible, false);
  const result = evaluateRecord(item, { question: item.question, search: { arguments: { query: item.question }, result: { structuredContent: { results: [] } } }, fetched: [] });
  assert.equal(result.reference_answer_usable, false);
  assert.equal(result.answer_correctness, "NOT_EVALUATED");
  assert.ok(result.faq_observation.review_required_reasons.includes("REFERENCE_ANSWER_QUARANTINED"));
});

test("출처 문서 적중·질문 본문만으로 답변 본문을 찾았다고 집계하지 않는다", () => {
  const item = { reference_answer: "새 임대차계약서 첨부", reference: { sha256: "a".repeat(64), answer_start_line: 20, end_line: 22 } };
  const hits = [{ id: "one" }];
  const source = { document_sha256: item.reference.sha256, location: { start_line: 19, end_line: 22 } };
  const fetched = new Map([["one", { text: "어디에 신청하나요?", sources: [source] }]]);
  assert.deepEqual(observeAnswer(item, hits, fetched, 5), { answer_span_hit: true, complete_answer_text_in_one_fetch: false });
  fetched.get("one").text = "새 임대차계약서 첨부";
  assert.equal(observeAnswer(item, hits, fetched, 5).complete_answer_text_in_one_fetch, true);
  source.document_sha256 = "b".repeat(64);
  assert.equal(observeAnswer(item, hits, fetched, 5).answer_span_hit, false);
  source.document_sha256 = item.reference.sha256;
  source.location.end_line = 19;
  assert.equal(observeAnswer(item, hits, fetched, 5).answer_span_hit, false);
});
