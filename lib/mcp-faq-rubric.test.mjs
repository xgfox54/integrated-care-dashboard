import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './press-test-support.mjs';
import { faq129Rubric } from './mcp/faq129-rubric.ts';
import { getFaq129 } from './mcp/faq129.ts';
import { faq129Conditions } from './mcp/faq129-conditions.ts';

test('all 788 rubrics retain every source paragraph and bind citation date and hash', () => {
  const db = database();
  try {
    const rows = db.sqlite.prepare('SELECT * FROM faq_129').all();
    assert.equal(rows.length, 788);
    for (const source of rows) {
      const rubric = faq129Rubric(source);
      assert.deepEqual(rubric.requirements.map(block => block.source_quote), source.answer.split(/\r?\n[\t ]*\r?\n+/).filter(text => text.trim()));
      assert.equal(rubric.basis.content_sha256, source.content_sha256);
      assert.equal(rubric.citation_required, true);
      assert.equal(rubric.written_date_required, true);
      assert.equal(rubric.citation_footer.source_url, source.source_url);
      assert.equal(rubric.citation_footer.written_date, source.written_date);
      assert.equal(rubric.citation_footer.content_sha256, source.content_sha256);
      assert.ok(rubric.citation_footer.text.includes(source.source_url));
      assert.ok(rubric.citation_footer.text.includes(source.written_date));
      assert.equal(rubric.current_policy_verified, false);
      const conditions = faq129Conditions(source.faq_id, source.content_sha256, source.answer);
      assert.deepEqual(rubric.scope_constraints, conditions.scope_constraints);
      assert.deepEqual(rubric.warning_markers, conditions.warning_markers);
    }
  } finally { db.sqlite.close(); }
});

test('reviewed exceptions and unclear merged-table calculations remain separate', async () => {
  const db = database();
  try {
    const source = db.sqlite.prepare("SELECT * FROM faq_129 WHERE faq_id='7170'").get();
    const rubric = faq129Rubric(source);
    assert.ok(rubric.reviewed_relationships.some(rule => rule.operator === 'EXCEPTION' && rule.applies_to === 'ivf-period'));
    const unclear = faq129Rubric(db.sqlite.prepare("SELECT * FROM faq_129 WHERE faq_id='12023'").get());
    assert.ok(unclear.unresolved.length);
    assert.ok(unclear.derived_calculations.length);
    assert.ok(unclear.risk_flags.includes('TABLE_LAYOUT_REVIEW_REQUIRED'));
    assert.deepEqual((await getFaq129(db, 'faq129:7170')).answer_criteria.basis, rubric.basis);
  } finally { db.sqlite.close(); }
});
