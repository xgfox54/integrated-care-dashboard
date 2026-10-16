import { faq129Conditions } from './faq129-conditions.ts';
import { faq129Facts } from './faq129-facts.ts';
import { faq129Clarification } from './faq129-clarifications.ts';

type Source = { readonly faq_id: string; readonly question: string; readonly answer: string; readonly written_date: string; readonly source_url: string; readonly content_sha256: string; readonly revision: string };

export function faq129Rubric(source: Source) {
  const conditions = faq129Conditions(source.faq_id, source.content_sha256, source.answer);
  const clarification = faq129Clarification(source.faq_id, source.content_sha256);
  const paragraphs = source.answer.split(/\r?\n[\t ]*\r?\n+/).filter(text => text.trim());
  const requirements = paragraphs.map((source_quote, index) => ({
    id: source.faq_id + ':block:' + (index + 1), source_block: index + 1, source_quote,
    role: /^더 자세한 사항은 보건복지상담센터/.test(source_quote.trim()) ? 'CONTACT' as const : 'ANSWER_EVIDENCE' as const,
    fields: Object.entries(conditions.condition_fields.fields).filter(([, rows]) => rows.some(row => row.source_block === index + 1)).map(([field]) => field),
    facts: faq129Facts(source_quote),
    qualifiers: [...new Set(source_quote.match(/이상|이하|미만|초과|이내|이후|이전|익일|모두|또는|필수|필요시|필요 시|다만|단,|제외|우선|권고|최초\s*1회|매월/g) ?? [])],
  }));
  return {
    revision: 'faq129-answer-rubric-20261014-v2', source_revision: source.revision,
    basis: { faq_id: source.faq_id, content_sha256: source.content_sha256, written_date: source.written_date, source_url: source.source_url },
    verification_scope: 'SOURCE_DERIVED_ANSWER_REQUIREMENTS' as const,
    semantic_review: conditions.verification_status === 'SOURCE_REVIEWED' ? 'SELECTED_RELATIONSHIPS_REVIEWED' as const : 'NOT_INDEPENDENTLY_REVIEWED' as const,
    requirements, reviewed_relationships: conditions.rules,
    scope_constraints: conditions.scope_constraints, warning_markers: conditions.warning_markers,
    citation_required: true, written_date_required: true, current_policy_verified: false,
    citation_footer: {
      source_url: source.source_url, written_date: source.written_date, content_sha256: source.content_sha256,
      text: '원문 출처: [보건복지상담센터(129)](' + source.source_url + ') · 원문 작성일: ' + source.written_date,
    },
    unresolved: clarification?.remaining_uncertainties ?? [],
    supplemental_guidance: clarification?.guidance ?? [],
    derived_calculations: clarification?.derived_calculations ?? [],
    supplemental_sources: clarification?.sources ?? [],
    supplemental_citation_required: Boolean(clarification?.sources.length),
    risk_flags: [
      ...(/\|/.test(source.answer) ? ['TABLE_LAYOUT_REVIEW_REQUIRED'] : []),
      ...(clarification?.remaining_uncertainties.length ? ['UNRESOLVED_OFFICIAL_GUIDANCE'] : []),
      ...(clarification?.guidance.length ? ['SUPPLEMENTAL_GUIDANCE_RECONCILIATION_REQUIRED'] : []),
      ...(conditions.verification_status !== 'SOURCE_REVIEWED' && /모두|또는|다만|제외|필요시|필요 시/.test(source.answer) ? ['LOGICAL_RELATIONSHIP_REVIEW_REQUIRED'] : []),
    ],
    forbidden_inferences: ['MISSING_FIELD_MEANS_UNCONDITIONAL', 'OLD_DATE_MEANS_CURRENT_POLICY', 'OPTIONAL_MEANS_REQUIRED', 'EXCEPTION_OMITTED', 'DERIVED_CALCULATION_MEANS_SOURCE_TABLE', 'UNRESOLVED_MEANS_CONFIRMED'],
  };
}
