import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { FAQ_PROFILE, questionSha256, validateGolden } from "./evaluate-golden-qa.mjs";
import { applyManualReview } from "./manual-faq-review.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function manualItem(item, datasetId) {
  const reference = item.reference;
  if (!item.raw_question?.trim() || !item.reference_answer?.trim() || !reference?.source_name
    || !/^[a-f0-9]{64}$/.test(reference.sha256 ?? "")
    || reference.excerpt_sha256 !== sha256(reference.excerpt ?? "")
    || !Number.isInteger(reference.start_line) || !Number.isInteger(reference.end_line)
    || !Number.isInteger(reference.answer_start_line)
    || reference.start_line < 1 || reference.answer_start_line < reference.start_line
    || reference.answer_start_line > reference.end_line
    || item.review_status !== "source_verified_pair_semantic_review_pending") {
    throw new Error("매뉴얼 FAQ의 원문 근거·검수 상태가 잘못되었습니다: " + item.id);
  }
  return {
    ...item,
    evaluation_profile: FAQ_PROFILE,
    benchmark_group: datasetId,
    source: { title: reference.source_name, confirmation_level: "파싱본문해시확인", current_rules_recheck_required: "필요" },
    provenance: { question_sha256: questionSha256(item.question), original_id: item.id },
    answer_correctness: "NOT_EVALUATED",
    human_review: "PENDING",
  };
}

function faq129Item(item, datasetId) {
  if (!/^\d+$/.test(item.faq_id ?? "") || !item.question?.trim() || !item.answer?.trim()) {
    throw new Error("129 FAQ 질문·답변이 없습니다: " + item.faq_id);
  }
  return {
    id: "FAQ129-" + item.faq_id,
    question: item.question,
    raw_question: item.question,
    category: item.category,
    evaluation_profile: FAQ_PROFILE,
    benchmark_group: datasetId,
    reference_answer: item.answer,
    reference: { faq_id: item.faq_id, url: item.url, written_date: item.written_date },
    source: { site: "보건복지상담센터 129", title: item.question, url: item.url, written_at: item.written_date,
      confirmation_level: "저장원문", current_rules_recheck_required: "필요" },
    provenance: { question_sha256: questionSha256(item.question), original_id: item.faq_id },
    review_status: "stored_official_answer_semantic_review_pending",
    answer_correctness: "NOT_EVALUATED",
    human_review: "PENDING",
  };
}

function originalFaqQuery(item) {
  return { ...item, reference_contextual_question: item.question, question: item.raw_question,
    provenance: { ...item.provenance, contextual_question_sha256: questionSha256(item.question),
      question_sha256: questionSha256(item.raw_question), query_mode: "original_faq_question" } };
}

export async function loadFaqTestSuite(filename) {
  const manifest = JSON.parse(await readFile(filename, "utf8"));
  if (manifest.schema_version !== "faq-test-suite-1" || !manifest.dataset_id
    || !manifest.version || !Number.isInteger(manifest.count) || manifest.count < 1
    || !Array.isArray(manifest.datasets) || !manifest.datasets.length
    || manifest.datasets.some((entry) => !entry.dataset_id || !entry.path || !Number.isInteger(entry.count) || entry.count < 1)) {
    throw new Error("FAQ 테스트 세트 manifest 형식이 잘못되었습니다.");
  }
  const loaded = await Promise.all(manifest.datasets.map(async (entry) => {
    const bytes = await readFile(path.resolve(path.dirname(filename), entry.path));
    if (sha256(bytes) !== entry.sha256) throw new Error("FAQ 원본 파일 SHA가 다릅니다: " + entry.path);
    const source = JSON.parse(bytes.toString("utf8"));
    if (!Array.isArray(source.items) || source.items.length !== entry.count) throw new Error("FAQ 원본 문항 수가 다릅니다: " + entry.path);
    switch (entry.format) {
      case "manual_faq": {
        const items = source.items.map((item) => manualItem(item, entry.dataset_id));
        if (!entry.review) return items.map(originalFaqQuery);
        const reviewBytes = await readFile(path.resolve(path.dirname(filename), entry.review.path));
        if (sha256(reviewBytes) !== entry.review.sha256) throw new Error("매뉴얼 검수 파일 SHA가 다릅니다.");
        const review = JSON.parse(reviewBytes.toString("utf8"));
        if (review.schema_version !== "manual-faq-review-1" || review.source_sha256 !== entry.sha256
          || !Array.isArray(review.items) || review.items.length !== items.length
          || new Set(review.items.map((row) => row.id)).size !== items.length) throw new Error("매뉴얼 검수 대상 개수·해시가 다릅니다.");
        const byId = new Map(review.items.map((row) => [row.id, row]));
        return items.map((item) => {
          const row = byId.get(item.id);
          if (!row) throw new Error("매뉴얼 검수 문항이 없습니다: " + item.id);
          const reviewed = applyManualReview(item, row);
          return originalFaqQuery(reviewed);
        });
      }
      case "faq129": return source.items.map((item) => faq129Item(item, entry.dataset_id));
      default: throw new Error("지원하지 않는 FAQ 형식: " + entry.format);
    }
  }));
  let items = loaded.flat();
  if (manifest.supplements) {
    const bytes = await readFile(path.resolve(path.dirname(filename), manifest.supplements.path));
    if (sha256(bytes) !== manifest.supplements.sha256) throw new Error("FAQ 보강 근거 파일 SHA가 다릅니다.");
    const supplement = JSON.parse(bytes.toString("utf8"));
    if (supplement.schema_version !== "faq-reference-supplements-1" || !Array.isArray(supplement.items)
      || supplement.items.length !== supplement.count || new Set(supplement.items.map(row => row.id)).size !== supplement.count) {
      throw new Error("FAQ 보강 근거 개수·문항이 다릅니다.");
    }
    const registry = await readFile(path.resolve(path.dirname(filename), supplement.runtime_registry.path));
    if (sha256(registry) !== supplement.runtime_registry.sha256) throw new Error("FAQ 운영 보강 안내 SHA가 다릅니다.");
    const byId = new Map(items.map(item => [item.id, item]));
    for (const row of supplement.items) {
      const item = byId.get(row.id);
      if (!item || row.original_question_sha256 !== sha256(item.question)
        || row.original_answer_sha256 !== sha256(item.reference_answer)
        || row.official_clarification?.original_content_sha256 !== sha256(item.question + "\n" + item.reference_answer)
        || !["REFERENCE_GUIDANCE", "EXCLUDED_BY_USER", "LOCAL_AUTHORITY_CONFIRMATION"].includes(row.disposition)) {
        throw new Error("FAQ 보강 대상 원문·처리 기준이 다릅니다: " + row.id);
      }
      if (row.disposition === "REFERENCE_GUIDANCE" && (row.source_observation?.http_status !== 200
        || !/^[a-f0-9]{64}$/.test(row.source_observation?.observed_pdf_sha256 ?? row.source_observation?.observed_html_sha256 ?? "")
        || !row.official_clarification.sources.some(source => source.url === row.source_observation.url))) {
        throw new Error("FAQ 보강 출처 본문 확인이 없습니다: " + row.id);
      }
    }
    const reviews = new Map(supplement.items.map(row => [row.id, row]));
    items = items.map(item => reviews.has(item.id) ? { ...item, reference_supplement: reviews.get(item.id) } : item);
  }
  return validateGolden({
    dataset_id: manifest.dataset_id, version: manifest.version, count: manifest.count,
    evaluation_profile: FAQ_PROFILE,
    source_suite: manifest,
    items,
  });
}
