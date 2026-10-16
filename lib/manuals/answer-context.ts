import { conditionFields } from '../mcp/condition-fields.ts';
import type { ManualSectionDetail } from './types.ts';

function windowOf(section: ManualSectionDetail) {
  return {
    section_id: section.id, source_content_sha256: section.sources[0].content_sha256,
    offset: section.offset, returned_chars: section.returned_chars, total_chars: section.total_chars,
    next_offset: section.next_offset,
    section_complete: section.offset === 0 && section.next_offset === null,
  };
}

export function manualAnswerContext(section: ManualSectionDetail, related: readonly ManualSectionDetail[]) {
  const window = windowOf(section);
  const relatedWindows = related.map(windowOf);
  return {
    source_content_sha256: window.source_content_sha256,
    source_scope: 'returned_excerpt' as const,
    source_block_basis: 'paragraphs_in_returned_excerpt' as const,
    condition_fields: conditionFields(section.text),
    excerpt_complete: window.section_complete,
    section_complete: window.section_complete,
    context_complete: false,
    policy_verification: 'NOT_INDEPENDENTLY_VERIFIED' as const,
    continuation: window,
    related_continuations: relatedWindows,
    warning_markers: [
      ...(!window.section_complete ? ['MANUAL_EXCERPT_INCOMPLETE'] : []),
      ...(relatedWindows.some(row => !row.section_complete) ? ['MANUAL_RELATED_EXCERPT_INCOMPLETE'] : []),
      'MANUAL_CONTEXT_UNVERIFIED',
    ],
  };
}

export function manualAnswerContextEvidence(context: ReturnType<typeof manualAnswerContext>) {
  const { condition_fields, ...metadata } = context;
  return {
    ...metadata,
    condition_fields: {
      extraction_status: condition_fields.extraction_status,
      policy_verification: condition_fields.policy_verification,
      source_blocks_by_field: Object.fromEntries(Object.entries(condition_fields.fields)
        .map(([field, paragraphs]) => [field, paragraphs.map(row => row.source_block)])),
      unclassified_source_blocks: condition_fields.unclassified_paragraphs.map(row => row.source_block),
    },
  };
}
