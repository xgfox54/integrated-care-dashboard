import assert from 'node:assert/strict';
import test from 'node:test';
import { manualAnswerContext } from './manuals/answer-context.ts';

const section = (overrides = {}) => ({
  id: 'manual:revision:section', text: '| 연도 | 대상 |\n| 2026 | 신청자 |\n\n단, 대리신청 서류는 별도 확인합니다.',
  offset: 0, returned_chars: 50, total_chars: 50, next_offset: null, truncated: false,
  sources: [{ content_sha256: 'source-hash' }], ...overrides,
});

test('manual final window remains incomplete and preserves table and exception evidence', () => {
  const input = section({ offset: 17, returned_chars: 33 });
  const context = manualAnswerContext(input, []);
  assert.equal(context.section_complete, false);
  assert.equal(context.context_complete, false);
  assert.equal(context.continuation.next_offset, null);
  assert.ok(context.warning_markers.includes('MANUAL_EXCERPT_INCOMPLETE'));
  assert.equal(context.condition_fields.fields.exceptions[0].source_quote, input.text.split('\n\n')[1]);
  assert.equal(context.condition_fields.fields.eligibility[0].source_quote, input.text.split('\n\n')[0]);
  assert.equal(context.source_block_basis, 'paragraphs_in_returned_excerpt');
});

test('whole manual section does not claim complete wider context and related windows retain their offsets', () => {
  const context = manualAnswerContext(section(), [section({ offset: 20, next_offset: 40, truncated: true })]);
  assert.equal(context.section_complete, true);
  assert.equal(context.context_complete, false);
  assert.equal(context.related_continuations[0].offset, 20);
  assert.ok(context.warning_markers.includes('MANUAL_RELATED_EXCERPT_INCOMPLETE'));
  assert.ok(!context.warning_markers.includes('MANUAL_EXCERPT_INCOMPLETE'));
});
