import { createHash } from "node:crypto";

export const reviewHash = (value) => createHash("sha256").update(value).digest("hex");

export function boundaryRisks(item) {
  const risks = [];
  if (/\|/.test(item.raw_question)) risks.push("TABLE_COLUMNS_MIXED_IN_QUESTION");
  if (/(?:^|[\s|])\d+-\d+(?:-\d+)?(?=[\s|])/m.test(item.reference_answer)) risks.push("OTHER_FAQ_NUMBER_IN_ANSWER");
  if (/\?\s*$/m.test(item.reference_answer)) risks.push("QUESTION_TEXT_IN_ANSWER");
  if (/\bChapter\s+[ⅣⅠⅤⅥⅦⅧⅨⅩIVX]+/i.test(item.reference_answer)) risks.push("CHAPTER_TEXT_IN_ANSWER");
  if (/인쇄일\s*:|발행처\s*:/.test(item.reference_answer)) risks.push("COLOPHON_IN_ANSWER");
  if (item.reference_answer.length > 3000) risks.push("LONG_ANSWER_BOUNDARY_REVIEW");
  if (item.reference_answer.length < 120 && /(?:p\.?\s*\d+|\d+[~～]\d+\s*p)/i.test(item.reference_answer)
    && /참고|참조|확인/.test(item.reference_answer)) risks.push("CROSS_REFERENCE_NEEDS_BODY");
  return risks;
}

function sourceLines(item, range) {
  const ref = item.reference;
  if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger)
    || range[0] < ref.start_line || range[1] > ref.end_line || range[0] > range[1]) {
    throw new Error("원문 발췌 밖의 복원 범위: " + item.id);
  }
  return ref.excerpt.split("\n").slice(range[0] - ref.start_line, range[1] - ref.start_line + 1);
}

function cleanLines(lines, marker) {
  return lines.map((line) => line.replace(/^\s*#{1,6}\s*/, "").trim())
    .filter(Boolean).map((line, index) => index === 0 ? line.replace(marker, "") : line).join("\n").trim();
}

export function applyBoundaryCorrection(item, correction) {
  if (!correction?.note?.trim() || correction.source_excerpt_sha256 !== item.reference.excerpt_sha256
    || correction.question_lines?.[1] >= correction.answer_lines?.[0]) {
    throw new Error("복원 근거 또는 질문·답변 범위가 잘못되었습니다: " + item.id);
  }
  const raw = cleanLines(sourceLines(item, correction.question_lines), /^(?:Q\s*[.)]?\s*|\d+-\d+(?:-\d+)?\s+)/).replace(/\s+/g, " ");
  const answer = cleanLines(sourceLines(item, correction.answer_lines), /^A[.)]?\s+/);
  if (!raw || !answer || !item.question.endsWith(item.raw_question)) throw new Error("복원할 질문·답변이 없습니다: " + item.id);
  const ref = item.reference;
  const excerpt = sourceLines(item, [ref.start_line, correction.answer_lines[1]]).join("\n");
  return { ...item,
    question: item.question.slice(0, -item.raw_question.length) + raw, raw_question: raw, reference_answer: answer,
    reference: { ...ref, end_line: correction.answer_lines[1], answer_start_line: correction.answer_lines[0],
      excerpt, excerpt_sha256: reviewHash(excerpt) },
  };
}

export function auditManualItem(item, correction = null, sourceVerified = false) {
  const corrected = correction ? applyBoundaryCorrection(item, correction) : item;
  const risks = boundaryRisks(corrected);
  if (!sourceVerified) risks.push("SOURCE_LINES_NOT_VERIFIED");
  for (const reason of correction?.retain_risks ?? []) if (!risks.includes(reason)) risks.push(reason);
  return { id: item.id, original_question_sha256: reviewHash(item.question),
    source_sha256: item.reference.sha256, source_excerpt_sha256: item.reference.excerpt_sha256,
    source_lines_verified: sourceVerified, correction, risks,
    review_status: risks.length ? "quarantined_source_review_required"
      : correction ? "boundary_repaired_semantic_review_pending" : item.review_status,
    retrieval_probe_eligible: risks.length === 0,
    reference_answer_usable: false,
    semantic_correctness: "NOT_EVALUATED", current_rules_correctness: "NOT_EVALUATED",
  };
}

export function applyManualReview(item, review) {
  if (review.original_question_sha256 !== reviewHash(item.question)
    || review.source_sha256 !== item.reference.sha256
    || review.source_excerpt_sha256 !== item.reference.excerpt_sha256) throw new Error("검수 대상 원문이 바뀌었습니다: " + item.id);
  const expected = auditManualItem(item, review.correction, review.source_lines_verified);
  if (JSON.stringify(expected) !== JSON.stringify(review)) throw new Error("매뉴얼 검수 상태와 위험 신호가 다릅니다: " + item.id);
  const result = review.correction ? applyBoundaryCorrection(item, review.correction) : item;
  return { ...result, review_status: review.review_status, reference_answer_usable: false,
    retrieval_probe_eligible: review.retrieval_probe_eligible,
    reference_review: { risks: review.risks, correction: review.correction, original_question_sha256: review.original_question_sha256,
      original_excerpt_sha256: review.source_excerpt_sha256, semantic_correctness: "NOT_EVALUATED" },
  };
}
