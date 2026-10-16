import assert from 'node:assert/strict';
import test from 'node:test';
import { database, NOW } from './press-test-support.mjs';
import { getFaq129, searchFaq129 } from './mcp/faq129.ts';
import { refineWelfareQuery } from './mcp/query-refiner.ts';
import { faq129Text } from './mcp/faq129-text.ts';

const ids = ['18082', '18083', '18085'];

test('pancreas transplant paperwork retains severity-specific exception without rewriting FAQ', async () => {
  const db = database();
  try {
    for (const id of ids) {
      const original = db.sqlite.prepare('SELECT answer, written_date, content_sha256 FROM faq_129 WHERE faq_id = ?').get(id);
      const detail = await getFaq129(db, 'faq129:' + id, NOW * 1000);
      assert.equal(detail.answer, original.answer);
      assert.equal(detail.written_date, original.written_date);
      assert.equal(detail.content_sha256, original.content_sha256);
      const clarification = detail.authoritative_clarification;
      assert.ok(clarification, id);
      const guidance = clarification.guidance.join('\n');
      for (const condition of ['심하지 않은 장애', '심한 장애', '검사결과지·진료기록지를 추가', '3개월 이상', '진단일 전6개월 이상', '2026-06-29']) assert.ok(guidance.includes(condition), condition);
      assert.ok(faq129Text(detail).includes('검사결과지·진료기록지를 추가'));
      const source = clarification.sources[0];
      assert.equal(source.source_dates.effective_at, '2026-07-01');
      assert.equal(source.source_dates.published_at, null);
      assert.ok(source.location.includes('인쇄3쪽'));
      assert.ok(detail.answer_criteria.supplemental_guidance.some(line => line.includes('검사결과지·진료기록지를 추가')));
    }
  } finally { db.sqlite.close(); }
});

test('pancreas paperwork conditions reach search and expire when the original changes', async () => {
  const db = database();
  try {
    const source = db.sqlite.prepare('SELECT question FROM faq_129 WHERE faq_id = ?').get('18083');
    const result = await searchFaq129(db, refineWelfareQuery(source.question, { currentYear: 2026 }), { nowMs: NOW * 1000 });
    const hit = result.hits.find(row => row.id === 'faq129:18083');
    assert.ok(hit.authoritative_clarification.guidance.some(line => line.includes('검사결과지·진료기록지를 추가')));
    for (const id of ids) {
      db.sqlite.prepare('UPDATE faq_129 SET content_sha256 = ? WHERE faq_id = ?').run('changed', id);
      assert.equal((await getFaq129(db, 'faq129:' + id, NOW * 1000)).authoritative_clarification, null);
    }
  } finally { db.sqlite.close(); }
});
