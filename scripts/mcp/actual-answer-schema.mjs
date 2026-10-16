import { z } from "zod";

export const DOMAINS = ["search", "search_welfare_services", "find_programs", "search_manuals", "search_faq", "search_news", "search_statistics", "find_budget_projects", "search_budget_lines", "find_care_institutions"];
const text = z.string().trim().min(1);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const artifact = z.object({ path: text, sha256: sha }).strict();
const sourcePointer = z.object({ artifact_path: text, artifact_sha256: sha, json_pointer: text, source_ids: z.array(text), source_urls: z.array(z.string().url()), inspection_status: z.enum(["STORED_SOURCE_READ", "RECORDED_RETRIEVAL_READ"]), limitations: text }).strict();
export const BenchmarkSchema = z.object({
  schema_version: z.literal("actual-answer-benchmark-1"), benchmark_id: text,
  holdout_scope: z.literal("NEW_PROMPTS_NOT_SOURCE_DISJOINT"), separate_from: z.array(text),
  target_model: z.object({ label: text, reasoning_effort: z.literal("medium") }).strict(),
  threshold_percent: z.literal(95), questions_per_domain: z.literal(5), domains: z.array(text).length(10),
  review_protocol: z.literal("MANUAL_SOURCE_REVIEW_REQUIRED"), status: z.literal("QUESTIONS_READY_ANSWERS_NOT_EVALUATED"), instructions: text,
  items: z.array(z.object({ id: text, domain: text, question: text, question_sha256: sha,
    expected_evidence: z.array(sourcePointer).min(1), rubric: z.array(z.object({ id: text, requirement: text }).strict()).min(1),
  }).strict()).length(50),
}).strict();
export const AnswerSchema = z.object({
  observation_type: z.literal("actual_chatgpt_answer"), benchmark_id: text, case_id: text, domain: text, question_sha256: sha,
  answer_text: text, conversation_url: z.string().regex(/^https:\/\/chatgpt\.com\/c\/[a-zA-Z0-9-]+$/),
  turn_id: text, model_label: text, reasoning_effort: z.literal("medium"), captured_at: z.string().datetime({ offset: true }),
  capture: artifact, tool_usage_visibility: z.enum(["OBSERVED", "NOT_VISIBLE"]), tool_capture: artifact.optional(),
  source_evidence: z.array(z.object({ id: text, artifact, source_url: z.string().url(), locator: text, source_quote: text,
    kind: z.enum(["OFFICIAL_SOURCE", "STORED_SOURCE", "RETRIEVAL_STATE"]), checked_at: z.string().datetime({ offset: true }),
  }).strict()).min(1),
  review: z.object({ reviewer: text, reviewed_at: z.string().datetime({ offset: true }), method: z.literal("MANUAL_SOURCE_COMPARISON"),
    criteria: z.array(z.object({ id: text, verdict: z.enum(["PASS", "FAIL", "SOURCE_UNRESOLVED"]), explanation: z.string().trim().min(20), answer_quote: text, source_evidence_ids: z.array(text).min(1) }).strict()).min(1),
  }).strict(),
}).strict();
