import assert from 'node:assert/strict';
import test from 'node:test';
import { conditionFields } from './mcp/condition-fields.ts';
import { faq129Conditions } from './mcp/faq129-conditions.ts';

test('six condition categories preserve complete source paragraphs and exception context', () => {
  const text = '지원대상은 만 65세 이상으로 소득과 재산 기준을 충족한 사람입니다.\n\n신청인 신분증과 대리인 신분증, 위임장이 필요합니다. 다만 온라인 대리신청은 불가합니다.\n\n신청일로부터 30일 이내 결정하며 다른 급여와 중복 지원은 제외합니다.\n\n표의 각주도 함께 읽어야 합니다.';
  const result = conditionFields(text);
  for (const field of ['eligibility', 'income_assets', 'documents', 'period', 'overlap_restrictions', 'exceptions']) assert.ok(result.fields[field].length);
  assert.equal(result.fields.documents[0].source_quote, text.split('\n\n')[1]);
  assert.equal(result.fields.exceptions[0].source_block, 2);
  assert.equal(result.unclassified_paragraphs[0].source_block, 4);
  assert.equal(faq129Conditions('unknown', 'hash', text).verification_status, 'UNREVIEWED');
});

test('absence of recognized conditions is never a claim of unconditional eligibility', () => {
  const result = conditionFields('다음 표를 참고하세요.');
  assert.equal(result.fields.eligibility.length, 0);
  assert.equal(result.unclassified_paragraphs.length, 1);
  assert.match(result.instructions, /조건이 없다는 뜻이 아닙니다/);
});
