import assert from 'node:assert/strict';
import test from 'node:test';
import { database, NOW } from './press-test-support.mjs';
import { getFaq129, searchFaq129 } from './mcp/faq129.ts';
import { refineWelfareQuery } from './mcp/query-refiner.ts';

const ids = ['12023', '921', '12339', '16860', '14234', '15339', '8131', '14303', '14003'];

test('official clarifications travel with FAQ detail and search without replacing dated source', async () => {
  const db = database();
  for (const id of ids) {
    const original = db.sqlite.prepare('SELECT answer, written_date, content_sha256, question FROM faq_129 WHERE faq_id = ?').get(id);
    const detail = await getFaq129(db, 'faq129:' + id, NOW * 1000);
    assert.ok(detail.authoritative_clarification, 'Missing official clarification for ' + id);
    assert.equal(detail.answer, original.answer);
    assert.equal(detail.written_date, original.written_date);
    assert.equal(detail.content_sha256, original.content_sha256);
    assert.ok(detail.authoritative_clarification.sources.length);
    assert.equal(detail.authoritative_clarification.reviewed_at, '2026-10-13');
    for (const source of detail.authoritative_clarification.sources) {
      assert.ok(source.url.startsWith('https://'));
      assert.ok(source.publisher && source.location);
    }
    const hits = await searchFaq129(db, refineWelfareQuery(original.question, { currentYear: 2026 }), { nowMs: NOW * 1000 });
    assert.deepEqual(hits.hits[0].authoritative_clarification, detail.authoritative_clarification);
  }
});

test('official supplements preserve source modification date and invalidate on each revised source hash', async () => {
  const db = database();
  try {
    const infant = await getFaq129(db, 'faq129:14303', NOW * 1000);
    assert.equal(infant.authoritative_clarification.sources[0].source_dates.updated_at, '2026-09-21');
    assert.equal(infant.authoritative_clarification.sources[0].source_dates.published_at, null);
    for (const id of ['8131', '14303', '14003']) {
      db.sqlite.prepare('UPDATE faq_129 SET content_sha256 = ? WHERE faq_id = ?').run('changed', id);
      assert.equal((await getFaq129(db, 'faq129:' + id, NOW * 1000)).authoritative_clarification, null);
    }
  } finally { db.sqlite.close(); }
});

test('a changed FAQ source cannot silently inherit a reviewed clarification', async () => {
  const db = database();
  db.sqlite.prepare("UPDATE faq_129 SET answer = '변경된 원문', content_sha256 = ? WHERE faq_id = '14234'").run('f'.repeat(64));
  const changed = await getFaq129(db, 'faq129:14234', NOW * 1000);
  assert.equal(changed.authoritative_clarification, null);
  assert.equal(changed.answer, '변경된 원문');
});

test('conflicting official boundaries remain explicit rather than becoming a fabricated decision', async () => {
  const db = database();
  const funeral = (await getFaq129(db, 'faq129:12339', NOW * 1000)).authoritative_clarification;
  assert.equal(funeral.status, 'PARTIALLY_RESOLVED');
  assert.ok(funeral.remaining_uncertainties.length);
  const voucher = (await getFaq129(db, 'faq129:12023', NOW * 1000)).authoritative_clarification;
  assert.ok(voucher.derived_calculations.length);
  assert.match(voucher.remaining_uncertainties.join(' '), /표|행/);
});
