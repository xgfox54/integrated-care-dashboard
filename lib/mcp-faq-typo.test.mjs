import assert from 'node:assert/strict';
import test from 'node:test';
import { database } from './press-test-support.mjs';
import { searchFaq129 } from './mcp/faq129.ts';
import { refineWelfareQuery } from './mcp/query-refiner.ts';

for (const spelling of ['긴급셍계지원', '긴급생계지원']) test(`source title typo remains searchable with ${spelling}`, async () => {
  // Given
  const db = database();
  const original = db.sqlite.prepare("SELECT question FROM faq_129 WHERE faq_id='16740'").get();
  const query = original.question.replace('긴급셍계지원', spelling);
  try {
    // When
    const result = await searchFaq129(db, refineWelfareQuery(query), { limit: 5 });
    // Then
    assert.equal(result.hits[0]?.id, 'faq129:16740');
    assert.equal(result.hits[0]?.question, original.question);
  } finally { db.sqlite.close(); }
});

test('corrected source typo still respects explicit conflicting program scope', async () => {
  // Given
  const db = database();
  const original = db.sqlite.prepare("SELECT question FROM faq_129 WHERE faq_id='16740'").get();
  const plan = refineWelfareQuery(original.question.replace('긴급셍계지원', '긴급생계지원'));
  try {
    // When
    const result = await searchFaq129(db, { ...plan, programs: ['기초연금'], program_scope: ['기초연금'], program_scope_source: 'explicit' }, { limit: 50 });
    // Then
    assert.ok(!result.hits.some(hit => hit.id === 'faq129:16740'));
  } finally { db.sqlite.close(); }
});

test('all 788 original FAQ questions retrieve their source in the first five candidates', async () => {
  // Given
  const db = database();
  const sources = db.sqlite.prepare('SELECT faq_id, question FROM faq_129 ORDER BY faq_id').all();
  const missing = [];
  try {
    // When
    for (const source of sources) {
      const result = await searchFaq129(db, refineWelfareQuery(source.question, { currentYear: 2026 }), { limit: 5 });
      if (!result.hits.some(hit => hit.id === 'faq129:' + source.faq_id)) missing.push({ id: source.faq_id, question: source.question, candidates: result.hits.map(hit => hit.id) });
    }
    // Then
    assert.equal(sources.length, 788);
    assert.deepEqual(missing, []);
  } finally { db.sqlite.close(); }
});
