import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, relative, dirname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { AnswerSchema, BenchmarkSchema, DOMAINS } from "./actual-answer-schema.mjs";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export class BenchmarkInputError extends Error {
  constructor(code, detail) { super(`${code}: ${detail}`); this.name = "BenchmarkInputError"; this.code = code; }
}
const requireInput = (condition, code, detail) => { if (!condition) throw new BenchmarkInputError(code, detail); };
const normalized = (text) => text.normalize("NFKC").replace(/[\p{P}\p{S}\s]+/gu, "");
const unique = (values) => new Set(values).size === values.length;
const sameSet = (left, right) => left.length === right.length && unique(left) && left.every((item) => right.includes(item));
function parse(schema, value, name) {
  const result = schema.safeParse(value);
  if (!result.success) throw new BenchmarkInputError("INVALID_SCHEMA", `${name}: ${result.error.message}`);
  return result.data;
}
export function validateBenchmark(input) {
  const benchmark = parse(BenchmarkSchema, input, "benchmark");
  requireInput(sameSet(benchmark.domains, DOMAINS), "DOMAIN_SET", "Expected all ten search domains");
  requireInput(unique(benchmark.items.map((item) => item.id)), "DUPLICATE_CASE", "Question IDs must be unique");
  requireInput(unique(benchmark.items.map((item) => normalized(item.question))), "DUPLICATE_QUESTION", "Questions must be distinct");
  for (const domain of DOMAINS) requireInput(benchmark.items.filter((item) => item.domain === domain).length === 5, "DOMAIN_IMBALANCE", domain);
  for (const item of benchmark.items) {
    requireInput(item.question_sha256 === sha256(item.question), "QUESTION_HASH", item.id);
    requireInput(unique(item.rubric.map((rule) => rule.id)), "DUPLICATE_CRITERION", item.id);
  }
  return benchmark;
}
function flattenStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(flattenStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(flattenStrings);
  return [];
}
function artifactText(bytes) {
  const text = bytes.toString("utf8");
  try { return flattenStrings(JSON.parse(text)).join("\n"); }
  catch (error) { if (error instanceof SyntaxError) return text; throw error; }
}
async function readArtifact(artifact, root) {
  const path = resolve(root, artifact.path);
  const fromRoot = relative(root, path);
  requireInput(!isAbsolute(artifact.path) && fromRoot !== ".." && !fromRoot.startsWith("..\\") && !fromRoot.startsWith("../"), "ARTIFACT_PATH", artifact.path);
  let bytes;
  try { bytes = await readFile(path); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new BenchmarkInputError("MISSING_ARTIFACT", artifact.path); throw error; }
  requireInput(bytes.length > 0 && sha256(bytes) === artifact.sha256, "ARTIFACT_HASH", artifact.path);
  return artifactText(bytes);
}
async function verifyReferences(benchmark, root) {
  const parsed = new Map();
  for (const item of benchmark.items) for (const pointer of item.expected_evidence) {
    const key = pointer.artifact_path + ":" + pointer.artifact_sha256;
    if (!parsed.has(key)) {
      await readArtifact({ path: pointer.artifact_path, sha256: pointer.artifact_sha256 }, root);
      parsed.set(key, JSON.parse(await readFile(resolve(root, pointer.artifact_path), "utf8")));
    }
    let value = parsed.get(key);
    requireInput(pointer.json_pointer.startsWith("/"), "REFERENCE_POINTER", item.id);
    for (const token of pointer.json_pointer.slice(1).split("/")) {
      const name = token.replace(/~1/g, "/").replace(/~0/g, "~");
      requireInput(value !== null && typeof value === "object" && Object.hasOwn(value, name), "REFERENCE_POINTER", item.id + "/" + token);
      value = value[name];
    }
  }
}
export async function evaluateActualAnswers(benchmarkInput, answerInput, evidenceRoot) {
  const benchmark = validateBenchmark(benchmarkInput);
  const records = parse(z.array(AnswerSchema).length(50), answerInput, "answers");
  requireInput(sameSet(records.map((row) => row.case_id), benchmark.items.map((item) => item.id)), "ANSWER_CASE_SET", "Missing, duplicated or unexpected case IDs");
  requireInput(unique(records.map((row) => row.conversation_url + "#" + row.turn_id + ":" + sha256(row.answer_text))), "DUPLICATE_TURN", "One captured answer segment cannot grade multiple questions");
  const root = resolve(evidenceRoot);
  await verifyReferences(benchmark, root);
  const results = [];
  for (const item of benchmark.items) {
    const row = records.find((record) => record.case_id === item.id);
    requireInput(row?.benchmark_id === benchmark.benchmark_id && row.domain === item.domain && row.question_sha256 === item.question_sha256, "ANSWER_BINDING", item.id);
    requireInput(row.model_label.includes(benchmark.target_model.label), "MODEL_MISMATCH", item.id);
    const capture = await readArtifact(row.capture, root);
    requireInput([item.question, row.answer_text, row.model_label, row.conversation_url].every((value) => capture.includes(value)), "CAPTURE_CONTENT", item.id);
    requireInput(sameSet(row.review.criteria.map((rule) => rule.id), item.rubric.map((rule) => rule.id)), "REVIEW_COVERAGE", item.id);
    requireInput(unique(row.source_evidence.map((source) => source.id)), "DUPLICATE_SOURCE", item.id);
    for (const source of row.source_evidence) {
      const sourceText = await readArtifact(source.artifact, root);
      requireInput(sourceText.includes(source.source_quote), "SOURCE_QUOTE", `${item.id}/${source.id}`);
    }
    for (const criterion of row.review.criteria) {
      requireInput(row.answer_text.includes(criterion.answer_quote), "ANSWER_QUOTE", `${item.id}/${criterion.id}`);
      requireInput(unique(criterion.source_evidence_ids) && criterion.source_evidence_ids.every((id) => row.source_evidence.some((source) => source.id === id)), "REVIEW_SOURCE", `${item.id}/${criterion.id}`);
    }
    if (row.tool_usage_visibility === "OBSERVED") {
      requireInput(row.tool_capture !== undefined, "TOOL_CAPTURE_REQUIRED", item.id);
      const trace = await readArtifact(row.tool_capture, root);
      requireInput(trace.includes(item.domain), "TOOL_CAPTURE_CONTENT", item.id);
    }
    const failed = row.review.criteria.filter((criterion) => criterion.verdict === "FAIL");
    const unresolved = row.review.criteria.filter((criterion) => criterion.verdict === "SOURCE_UNRESOLVED");
    results.push({ case_id: item.id, domain: item.domain, verdict: failed.length ? "INCORRECT" : unresolved.length ? "SOURCE_UNRESOLVED" : "CORRECT", reviewer: row.review.reviewer, conversation_url: row.conversation_url, capture: row.capture, tool_usage_visibility: row.tool_usage_visibility });
  }
  const domains = DOMAINS.map((domain) => {
    const rows = results.filter((row) => row.domain === domain);
    const correct = rows.filter((row) => row.verdict === "CORRECT").length;
    return { domain, tested: rows.length, correct, incorrect: rows.filter((row) => row.verdict === "INCORRECT").length, unresolved: rows.filter((row) => row.verdict === "SOURCE_UNRESOLVED").length, actual_answer_accuracy_percent: correct / rows.length * 100 };
  });
  const macro = domains.reduce((sum, row) => sum + row.actual_answer_accuracy_percent, 0) / domains.length;
  return { evaluation: "BALANCED_ACTUAL_CHATGPT_ANSWER_REVIEW", benchmark_id: benchmark.benchmark_id, review_basis: "MANUAL_REVIEW_REPORTED", retrieval_contract_accuracy: "NOT_EVALUATED", total: 50,
    actual_answer_accuracy: { correct: results.filter((row) => row.verdict === "CORRECT").length, denominator: 50, macro_percent: macro, threshold_percent: 95, gate_passed: macro >= 95 && domains.every((row) => row.actual_answer_accuracy_percent >= 95) },
    tool_usage_unobserved: results.filter((row) => row.tool_usage_visibility === "NOT_VISIBLE").length,
    limitations: ["Scores reflect recorded manual source review, not automated truth verification.", "Five questions per domain require five correct answers to meet the 95% domain gate.", "New prompts share source topics with previous evaluations; this is not a source-disjoint benchmark.", "Missing evidence is rejected; incorrect and unresolved answers remain in the denominator."], domains, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [questionsPath, recordsPath, outputPath, evidenceRoot] = process.argv.slice(2);
  try {
    requireInput(Boolean(questionsPath && recordsPath && outputPath && evidenceRoot), "USAGE", "node evaluate-actual-answers.mjs QUESTIONS_JSON ANSWERS_JSON OUTPUT_JSON EVIDENCE_ROOT");
    const summary = await evaluateActualAnswers(JSON.parse(await readFile(questionsPath, "utf8")), JSON.parse(await readFile(recordsPath, "utf8")), evidenceRoot);
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    await writeFile(outputPath, JSON.stringify(summary, null, 2) + "\n");
    console.log(JSON.stringify(summary.actual_answer_accuracy));
    process.exitCode = summary.actual_answer_accuracy.gate_passed ? 0 : 1;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const failure = { evaluation: "INVALID_ACTUAL_ANSWER_EVIDENCE", actual_answer_accuracy: "NOT_EVALUATED", gate_passed: false, error: { code: error instanceof BenchmarkInputError ? error.code : "IO_OR_JSON_ERROR", message: error.message } };
    if (outputPath) { await mkdir(dirname(resolve(outputPath)), { recursive: true }); await writeFile(outputPath, JSON.stringify(failure, null, 2) + "\n"); }
    console.error(JSON.stringify(failure));
    process.exitCode = 2;
  }
}
