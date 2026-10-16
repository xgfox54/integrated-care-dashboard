import type { Faq129Detail } from "./faq129.ts";
import { faq129ClarificationText } from "./faq129-clarifications.ts";

export const FAQ129_PUBLISHER = "보건복지상담센터(129)";
export const FAQ129_NOTICE = "보건복지상담센터(129) 자주하는 질문의 작성일 기준 공식 안내입니다. 금액·기준은 해마다 바뀔 수 있으니 작성일과 최신 사업안내·법령을 함께 확인하세요.";

export function faq129Text(detail: Faq129Detail): string {
  return [
    "질문: " + detail.question,
    "분야: " + [detail.group, detail.category].filter(Boolean).join(" > "),
    "작성일: " + detail.written_date + (detail.freshness.status === "CURRENT" ? "" : " (OUTDATED_OR_CONFLICTING_SOURCE: " + detail.freshness.reasons.join(", ") + ")"),
    "답변:",
    detail.answer,
    "FAQ_CONDITION_EVIDENCE: " + JSON.stringify({
      verification_status: detail.structured_conditions.verification_status,
      policy_verification: detail.structured_conditions.policy_verification,
      source_content_sha256: detail.structured_conditions.source_content_sha256,
      rules: detail.structured_conditions.rules.map(({ source_quote: _quote, ...rule }) => rule),
      scope_constraints: detail.structured_conditions.scope_constraints.map(({ source_quote: _quote, ...scope }) => scope),
      warning_markers: detail.structured_conditions.warning_markers,
    }),
    ...faq129ClarificationText(detail.authoritative_clarification),
    "출처: " + FAQ129_PUBLISHER + " " + detail.url,
    'ANSWER_SOURCE_CITATION: ' + JSON.stringify(detail.answer_criteria.citation_footer),
    "답변 작성 시 확인사항: " + detail.answer_composition_instructions,
    FAQ129_NOTICE,
  ].join("\n");
}
