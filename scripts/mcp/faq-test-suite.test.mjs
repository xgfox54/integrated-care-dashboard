import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadFaqTestSuite } from "./faq-test-suite.mjs";
import { applyManualReview } from "./manual-faq-review.mjs";
import { evaluateRecord, FAQ_PROFILE, summarize } from "./evaluate-golden-qa.mjs";
import { initialState } from "./faq-native-journal.mjs";
import { loadBenchmark } from "./run-golden-qa.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(root, "quality/faq-test-suite.json");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fixtureDirectory(context, prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  context.after(async () => {
    await Promise.all(["suite.json", "source.json", "supplements.json", "registry.ts"].map((name) => rm(path.join(directory, name), { force: true })));
    await rmdir(directory);
  });
  return directory;
}

test("원본 매뉴얼 FAQ와 129 질문·답변이 평가 세트와 native 수집 준비에 보존된다", async () => {
  // Given
  const manual = JSON.parse(await readFile(path.join(root, "quality/manual_faq_20261013.json"), "utf8"));
  const official = JSON.parse(await readFile(path.join(root, "data/faq129/faq129.json"), "utf8"));
  const review = JSON.parse(await readFile(path.join(root, "quality/manual_faq_20261013.review.json"), "utf8"));
  // When
  const benchmark = await loadBenchmark({ golden: manifestPath });
  const state = initialState(benchmark, "faq-suite-test");
  // Then
  assert.equal(benchmark.golden.items.length, manual.items.length + official.items.length);
  assert.equal(state.items.length, benchmark.golden.items.length);
  assert.equal(state.ready, null);
  for (const item of manual.items) {
    const imported = benchmark.golden.items.find((row) => row.id === item.id);
    const expected = applyManualReview(item, review.items.find((row) => row.id === item.id));
    assert.equal(imported.question, expected.raw_question);
    assert.equal(imported.reference_contextual_question, expected.question);
    assert.equal(imported.provenance.query_mode, "original_faq_question");
    assert.equal(imported.reference_answer, expected.reference_answer);
    assert.deepEqual(imported.reference, expected.reference);
    assert.equal(imported.review_status, expected.review_status);
    assert.equal(imported.reference_answer_usable, false);
  }
  for (const item of official.items) {
    const imported = benchmark.golden.items.find((row) => row.id === "FAQ129-" + item.faq_id);
    assert.equal(imported.question, item.question);
    assert.equal(imported.reference_answer, item.answer);
    assert.equal(imported.source.written_at, item.written_date);
  }
});

test("FAQ 원본 파일이 바뀌면 고정된 manifest 해시로 가져오기를 거절한다", async (context) => {
  // Given
  const directory = await fixtureDirectory(context, "faq-suite-sha-");
  const file = path.join(directory, "suite.json");
  await writeFile(file, JSON.stringify({ schema_version: "faq-test-suite-1", dataset_id: "fixture", version: "1", count: 1,
    datasets: [{ dataset_id: "official", format: "faq129", path: "source.json", count: 1, sha256: hash("original") }] }));
  await writeFile(path.join(directory, "source.json"), JSON.stringify({ items: [{ faq_id: "1", question: "question", answer: "changed" }] }));
  // When / Then
  await assert.rejects(loadFaqTestSuite(file), /SHA/);
});

test("manifest 해시를 갱신해도 발췌문과 원문 근거 해시가 다르면 거절한다", async (context) => {
  // Given
  const directory = await fixtureDirectory(context, "faq-suite-excerpt-");
  const manual = JSON.parse(await readFile(path.join(root, "quality/manual_faq_20261013.json"), "utf8"));
  const item = structuredClone(manual.items[0]);
  item.reference.excerpt += "changed";
  const bytes = JSON.stringify({ items: [item] });
  const file = path.join(directory, "suite.json");
  await writeFile(path.join(directory, "source.json"), bytes);
  await writeFile(file, JSON.stringify({ schema_version: "faq-test-suite-1", dataset_id: "fixture", version: "1", count: 1,
    datasets: [{ dataset_id: "manual", format: "manual_faq", path: "source.json", count: 1, sha256: hash(bytes) }] }));
  // When / Then
  await assert.rejects(loadFaqTestSuite(file), /원문 근거/);
});

test("원문 답변 후보를 보존하며 200개를 넘는 전 문항 수집과 부분 수집을 구분한다", async () => {
  // Given
  const suite = await loadFaqTestSuite(manifestPath);
  const items = suite.items.slice(0, 201);
  const expectedIds = items.map((item) => item.id);
  const records = items.map((item) => evaluateRecord(item, { id: item.id, question: item.question,
    search: { arguments: { query: item.question }, result: { structuredContent: { results: [] } } }, fetched: [] }));
  // When
  const complete = summarize(records, { evaluation_profile: FAQ_PROFILE, expected_ids: expectedIds });
  const partial = summarize(records.slice(0, 200), { evaluation_profile: FAQ_PROFILE, expected_ids: expectedIds });
  // Then
  assert.equal(complete.full_dataset_run, true);
  assert.equal(complete.full_collection_complete, true);
  assert.equal(complete.full_200_run, false);
  assert.equal(partial.full_dataset_run, false);
  assert.equal(partial.full_collection_complete, false);
  assert.equal(records[0].reference_answer, items[0].reference_answer);
  assert.deepEqual(records[0].reference, items[0].reference);
  assert.equal(complete.answer_correctness, "NOT_EVALUATED");
  assert.equal(records[0].context.semantic_correctness, "NOT_EVALUATED");
});

test("상위 5위의 129 원문 응답을 수집 근거로 인정하며 정답으로 자동 채점하지 않는다", async () => {
  // Given
  const suite = await loadFaqTestSuite(manifestPath);
  const item = suite.items[0];
  const id = "faq129:" + item.reference.faq_id;
  const input = { question: item.question, search: { arguments: { query: item.question },
    result: { structuredContent: { results: [{ id, title: item.question, entity_type: "official_faq" }] } } },
    fetched: [{ id, rank: 1, result: { structuredContent: { id, body: "returned evidence", sources: [{ url: item.source.url }] } } }] };
  // When
  const record = evaluateRecord(item, input);
  // Then
  assert.equal(record.faq_observation.admissible_details_fetched, 1);
  assert.equal(record.faq_observation.reference_source_url_observed_at[5], true);
  assert.equal(record.faq_observation.fetched_body_present, true);
  assert.equal(record.answer_correctness, "NOT_EVALUATED");
});

test("공식 보강 근거와 사용자 검수 처리가 원문을 보존한 평가 기록에 전달된다", async () => {
  // Given
  const evidence = JSON.parse(await readFile(path.join(root, "quality/faq-reference-supplements-20261013.json"), "utf8"));
  const suite = await loadFaqTestSuite(manifestPath);
  // When
  const records = evidence.items.map(review => evaluateRecord(suite.items.find(item => item.id === review.id), { status: "NOT_RUN" }));
  // Then
  for (const review of evidence.items) {
    const record = records.find(item => item.id === review.id);
    assert.deepEqual(record.reference_supplement, review);
    assert.equal(hash(record.reference_answer), review.original_answer_sha256);
    assert.equal(record.answer_correctness, "NOT_EVALUATED");
  }
  assert.equal(records.find(item => item.id === "FAQ129-8131").reference_supplement.disposition, "EXCLUDED_BY_USER");
  assert.equal(records.find(item => item.id === "FAQ129-15339").reference_supplement.disposition, "LOCAL_AUTHORITY_CONFIRMATION");
});

test("원문 답변이 바뀌면 파일 해시를 갱신해도 과거 보강 근거를 적용하지 않는다", async (context) => {
  // Given
  const directory = await fixtureDirectory(context, "faq-suite-supplement-");
  const official = JSON.parse(await readFile(path.join(root, "data/faq129/faq129.json"), "utf8"));
  const evidence = JSON.parse(await readFile(path.join(root, "quality/faq-reference-supplements-20261013.json"), "utf8"));
  const item = { ...official.items.find(row => row.faq_id === "921"), answer: "revised source answer" };
  const registry = await readFile(path.join(root, "lib/mcp/faq129-clarifications.ts"));
  const sourceBytes = JSON.stringify({ items: [item] });
  const evidenceBytes = JSON.stringify({ ...evidence, runtime_registry: { path: "registry.ts", sha256: hash(registry) }, count: 1,
    items: evidence.items.filter(row => row.id === "FAQ129-921") });
  await writeFile(path.join(directory, "source.json"), sourceBytes);
  await writeFile(path.join(directory, "registry.ts"), registry);
  await writeFile(path.join(directory, "supplements.json"), evidenceBytes);
  await writeFile(path.join(directory, "suite.json"), JSON.stringify({ schema_version: "faq-test-suite-1", dataset_id: "fixture", version: "1", count: 1,
    datasets: [{ dataset_id: "official", format: "faq129", path: "source.json", count: 1, sha256: hash(sourceBytes) }],
    supplements: { path: "supplements.json", sha256: hash(evidenceBytes) } }));
  // When / Then
  await assert.rejects(loadFaqTestSuite(path.join(directory, "suite.json")), /대상 원문/);
});


test("공식 PDF 보강 근거는 본문 해시를 검증하며 잘못된 PDF 해시는 거절한다", async (context) => {
  const directory = await fixtureDirectory(context, "faq-suite-pdf-");
  const official = JSON.parse(await readFile(path.join(root, "data/faq129/faq129.json"), "utf8"));
  const evidence = JSON.parse(await readFile(path.join(root, "quality/faq-reference-supplements-20261013.json"), "utf8"));
  const row = structuredClone(evidence.items.find(item => item.id === "FAQ129-2889"));
  const registry = await readFile(path.join(root, "lib/mcp/faq129-clarifications.ts"));
  const sourceBytes = JSON.stringify({ items: official.items.filter(item => item.faq_id === "2889") });
  await writeFile(path.join(directory, "source.json"), sourceBytes);
  await writeFile(path.join(directory, "registry.ts"), registry);
  async function saveFixture() {
    const evidenceBytes = JSON.stringify({ ...evidence, runtime_registry: { path: "registry.ts", sha256: hash(registry) }, count: 1, items: [row] });
    await writeFile(path.join(directory, "supplements.json"), evidenceBytes);
    await writeFile(path.join(directory, "suite.json"), JSON.stringify({ schema_version: "faq-test-suite-1", dataset_id: "fixture", version: "1", count: 1,
      datasets: [{ dataset_id: "official", format: "faq129", path: "source.json", count: 1, sha256: hash(sourceBytes) }],
      supplements: { path: "supplements.json", sha256: hash(evidenceBytes) } }));
  }
  await saveFixture();
  assert.equal((await loadFaqTestSuite(path.join(directory, "suite.json"))).items[0].reference_supplement.source_observation.observed_pdf_sha256, row.source_observation.observed_pdf_sha256);
  row.source_observation.observed_pdf_sha256 = "not-a-hash";
  await saveFixture();
  await assert.rejects(loadFaqTestSuite(path.join(directory, "suite.json")), /본문 확인/);
});
