import assert from 'node:assert/strict';
import test from 'node:test';
import { database, NOW } from './press-test-support.mjs';
import { getFaq129, searchFaq129 } from './mcp/faq129.ts';
import { refineWelfareQuery } from './mcp/query-refiner.ts';

for (const id of ['2881', '17701', '7770', '13976', '14054', '2399', '970', '1515', '12357']) {
  test(`reviewed clarification reaches detail and search only for unchanged FAQ ${id}`, async () => {
    const db = database();
    try {
      const original = db.sqlite.prepare('SELECT answer, question, written_date, content_sha256 FROM faq_129 WHERE faq_id = ?').get(id);
      const detail = await getFaq129(db, 'faq129:' + id, NOW * 1000);
      assert.deepEqual(
        [detail.answer, detail.written_date, detail.content_sha256],
        [original.answer, original.written_date, original.content_sha256],
      );
      assert.ok(detail.authoritative_clarification);
      assert.equal(detail.authoritative_clarification.original_content_sha256, original.content_sha256);
      const result = await searchFaq129(db, refineWelfareQuery(original.question, { currentYear: 2026 }), { nowMs: NOW * 1000 });
      const hit = result.hits.find(row => row.id === detail.id);
      assert.ok(hit);
      assert.deepEqual(hit.authoritative_clarification, detail.authoritative_clarification);
    } finally {
      db.sqlite.close();
    }
  });

  test(`changed FAQ ${id} does not reuse reviewed clarification`, async () => {
    const db = database();
    try {
      db.sqlite.prepare('UPDATE faq_129 SET content_sha256 = ? WHERE faq_id = ?').run('unreviewed-revision', id);
      const detail = await getFaq129(db, 'faq129:' + id, NOW * 1000);
      assert.equal(detail.authoritative_clarification, null);
    } finally {
      db.sqlite.close();
    }
  });
}
