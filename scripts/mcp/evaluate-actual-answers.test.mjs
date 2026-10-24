import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluateActualAnswers, validateBenchmark, sha256 } from "./evaluate-actual-answers.mjs";

const original = JSON.parse(await readFile(new URL("./fixtures/answer-benchmark-questions.json", import.meta.url), "utf8"));
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "actual-answer-review-test-"));
  t.after(async () => { assert.ok(root.startsWith(join(tmpdir(), "actual-answer-review-test-"))); await rm(root, { recursive: true, force: true }); });
  const benchmark = structuredClone(original);
  const source = JSON.stringify({ fact: "Synthetic test source fact, not welfare policy." });
  await writeFile(join(root, "source.json"), source);
  const sourceArtifact = { path: "source.json", sha256: sha256(source) };
  const records = [];
  for (const item of benchmark.items) {
    item.expected_evidence = [{ artifact_path: "source.json", artifact_sha256: sha256(source), json_pointer: "/fact", source_ids: ["test-fixture"], source_urls: ["https://example.test/source"], inspection_status: "STORED_SOURCE_READ", limitations: "Synthetic test fixture only" }];
    const answer = `Synthetic test answer ${item.id}; this is not an actual ChatGPT answer.`;
    const url = `https://chatgpt.com/c/test-${item.id}`;
    const capture = JSON.stringify({ question: item.question, answer, model: "GPT 5.6 Medium", url, reasoning_effort: "medium" });
    const capturePath = item.id + ".json";
    await writeFile(join(root, capturePath), capture);
    records.push({ observation_type: "actual_chatgpt_answer", benchmark_id: benchmark.benchmark_id, case_id: item.id, domain: item.domain, question_sha256: item.question_sha256,
      answer_text: answer, conversation_url: url, turn_id: "assistant-turn-1", model_label: "GPT 5.6 Medium", reasoning_effort: "medium", captured_at: "2026-10-12T08:00:00Z",
      capture: { path: capturePath, sha256: sha256(capture) }, tool_usage_visibility: "NOT_VISIBLE",
      source_evidence: [{ id: "source-1", artifact: sourceArtifact, source_url: "https://example.test/source", locator: "/fact", source_quote: "Synthetic test source fact, not welfare policy.", kind: "STORED_SOURCE", checked_at: "2026-10-12T08:00:00Z" }],
      review: { reviewer: "unit-test-fixture", reviewed_at: "2026-10-12T08:01:00Z", method: "MANUAL_SOURCE_COMPARISON", criteria: item.rubric.map((rule) => ({ id: rule.id, verdict: "PASS", explanation: "Synthetic fixture exercises the evidence contract, not answer quality.", answer_quote: answer, source_evidence_ids: ["source-1"] })) },
    });
  }
  return { root, benchmark, records };
}

test("questionnaire has 50 distinct prompts with five cases in each domain", () => {
  // Given / When
  const parsed = validateBenchmark(original);
  // Then
  assert.equal(parsed.items.length, 50);
  assert.equal(new Set(parsed.items.map((item) => item.domain)).size, 10);
});

test("all fully reviewed fixture answers pass without pretending retrieval was tested", async (t) => {
  // Given
  const data = await fixture(t);
  // When
  const result = await evaluateActualAnswers(data.benchmark, data.records, data.root);
  // Then
  assert.equal(result.actual_answer_accuracy.gate_passed, true);
  assert.equal(result.actual_answer_accuracy.correct, 50);
  assert.equal(result.actual_answer_accuracy.macro_percent, 100);
  assert.equal(result.retrieval_contract_accuracy, "NOT_EVALUATED");
  assert.equal(result.tool_usage_unobserved, 50);
});

for (const verdict of ["FAIL", "SOURCE_UNRESOLVED"]) test(`one ${verdict} cannot hide behind 98 percent aggregate`, async (t) => {
  // Given
  const data = await fixture(t);
  data.records[0].review.criteria[0].verdict = verdict;
  // When
  const result = await evaluateActualAnswers(data.benchmark, data.records, data.root);
  // Then
  assert.equal(result.actual_answer_accuracy.macro_percent, 98);
  assert.equal(result.domains[0].actual_answer_accuracy_percent, 80);
  assert.equal(result.actual_answer_accuracy.denominator, 50);
  assert.equal(result.actual_answer_accuracy.gate_passed, false);
});

const invalidCases = [
  ["missing answer", (data) => data.records.pop(), "INVALID_SCHEMA"],
  ["duplicate answer", (data) => { data.records[1] = data.records[0]; }, "ANSWER_CASE_SET"],
  ["domain imbalance", (data) => { data.benchmark.items[0].domain = "search_faq"; }, "DOMAIN_IMBALANCE"],
  ["retrieval-only row", (data) => { data.records[0] = { id: data.records[0].case_id, pass: true, response: { results: [] } }; }, "INVALID_SCHEMA"],
  ["wrong prompt binding", (data) => { data.records[0].question_sha256 = "a".repeat(64); }, "ANSWER_BINDING"],
  ["duplicate turn", (data) => { data.records[1].conversation_url = data.records[0].conversation_url; data.records[1].answer_text = data.records[0].answer_text; }, "DUPLICATE_TURN"],
  ["missing capture", (data) => { data.records[0].capture.path = "absent.json"; }, "MISSING_ARTIFACT"],
  ["changed capture", (data) => { data.records[0].capture.sha256 = "b".repeat(64); }, "ARTIFACT_HASH"],
  ["answer absent from capture", (data) => { data.records[0].answer_text = "Substituted unobserved answer"; }, "CAPTURE_CONTENT"],
  ["missing criterion", (data) => { data.records[0].review.criteria.pop(); }, "REVIEW_COVERAGE"],
  ["ungrounded review", (data) => { data.records[0].review.criteria[0].source_evidence_ids = ["missing-source"]; }, "REVIEW_SOURCE"],
  ["ungrounded source quote", (data) => { data.records[0].source_evidence[0].source_quote = "Never appears in source"; }, "SOURCE_QUOTE"],
  ["unobserved tool call claim", (data) => { data.records[0].tool_usage_visibility = "OBSERVED"; }, "TOOL_CAPTURE_REQUIRED"],
  ["evidence path outside root", (data) => { data.records[0].capture.path = "../escape.json"; }, "ARTIFACT_PATH"],
  ["reference snapshot drift", (data) => { data.benchmark.items[0].expected_evidence[0].artifact_sha256 = "c".repeat(64); }, "ARTIFACT_HASH"],
  ["reference pointer absent", (data) => { data.benchmark.items[0].expected_evidence[0].json_pointer = "/absent"; }, "REFERENCE_POINTER"],
];
for (const [label, mutate, code] of invalidCases) test(`rejects ${label} instead of reporting accuracy`, async (t) => {
  // Given
  const data = await fixture(t);
  mutate(data);
  // When / Then
  await assert.rejects(evaluateActualAnswers(data.benchmark, data.records, data.root), (error) => error.code === code);
});

test("CLI refuses retrieval-only input and writes a nonpassing diagnostic artifact", async (t) => {
  // Given
  const data = await fixture(t);
  await writeFile(join(data.root, "questions.json"), JSON.stringify(data.benchmark));
  await writeFile(join(data.root, "retrieval.json"), JSON.stringify(data.records.map((row) => ({ id: row.case_id, pass: true }))));
  const output = join(data.root, "report.json");
  // When
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("./evaluate-actual-answers.mjs", import.meta.url)), join(data.root, "questions.json"), join(data.root, "retrieval.json"), output, data.root], { encoding: "utf8" });
  // Then
  assert.equal(child.status, 2, child.stderr);
  const report = JSON.parse(await readFile(output, "utf8"));
  assert.equal(report.actual_answer_accuracy, "NOT_EVALUATED");
  assert.equal(report.gate_passed, false);
});
