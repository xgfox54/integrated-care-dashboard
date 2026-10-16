import assert from 'node:assert/strict';
import test from 'node:test';
import { database, NOW } from './press-test-support.mjs';
import { getFaq129, searchFaq129 } from './mcp/faq129.ts';
import { refineWelfareQuery } from './mcp/query-refiner.ts';
import { faq129Text } from './mcp/faq129-text.ts';

test('장기요양 본인확인 보충출처의 게시일과 기능 제공일을 구분한다', async () => {
 const db = database();
 try {
  const original = db.sqlite.prepare('SELECT answer,written_date,content_sha256 FROM faq_129 WHERE faq_id=?').get('18040');
  const detail = await getFaq129(db,'faq129:18040',NOW*1000);
  assert.equal(detail.answer,original.answer);
  assert.equal(detail.written_date,original.written_date);
  assert.equal(detail.content_sha256,original.content_sha256);
  assert.ok(detail.authoritative_clarification);
  const source = detail.authoritative_clarification.sources.find(row=>row.url.includes('articleNo=43057'));
  assert.equal(source.source_dates.posted_at,'2024-08-06');
  assert.equal(source.source_dates.effective_at,null);
  assert.ok(source.verified_snapshot.excerpt.includes('2024-08-06'));
  const text = faq129Text(detail);
  for (const term of ['2024-07-31','2025-06-09','2024-08-06','민감정보']) assert.ok(text.includes(term),term);
  assert.ok(detail.answer_criteria.supplemental_guidance.some(row=>row.includes('검색')));
 } finally { db.sqlite.close(); }
});

test('장기요양 검색에서 날짜 근거를 제공하고 원문 변경 시 해제한다', async () => {
 const db = database();
 try {
  const original = db.sqlite.prepare('SELECT question FROM faq_129 WHERE faq_id=?').get('18040');
  const result = await searchFaq129(db,refineWelfareQuery(original.question,{currentYear:2026}),{nowMs:NOW*1000});
  assert.ok(result.hits.find(row=>row.id==='faq129:18040').authoritative_clarification);
  db.sqlite.prepare('UPDATE faq_129 SET content_sha256=? WHERE faq_id=?').run('changed','18040');
  assert.equal((await getFaq129(db,'faq129:18040',NOW*1000)).authoritative_clarification,null);
 } finally { db.sqlite.close(); }
});
