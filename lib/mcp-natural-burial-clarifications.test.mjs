import assert from 'node:assert/strict';
import test from 'node:test';
import { database, NOW } from './press-test-support.mjs';
import { getFaq129, searchFaq129 } from './mcp/faq129.ts';
import { refineWelfareQuery } from './mcp/query-refiner.ts';
import { faq129Text } from './mcp/faq129-text.ts';

test('산분 원문을 보존하며 자연장지 변경신고와 공동이용 예외를 전달한다', async () => {
 const db = database();
 try {
  const original = db.sqlite.prepare('SELECT answer,written_date,content_sha256 FROM faq_129 WHERE faq_id=?').get('18021');
  const detail = await getFaq129(db,'faq129:18021',NOW*1000);
  assert.equal(detail.answer,original.answer);
  assert.equal(detail.written_date,original.written_date);
  assert.equal(detail.content_sha256,original.content_sha256);
  assert.ok(detail.authoritative_clarification);
  const text = faq129Text(detail);
  for(const term of ['개인 자연장지','변경도면','변경계획','동의하지','토지등기부등본','지적도','30일','2025-07-31']) assert.ok(text.includes(term),term);
  assert.ok(detail.answer_criteria.supplemental_guidance.some(row=>row.includes('원문')));
  assert.equal(detail.authoritative_clarification.sources[0].source_dates.updated_at,'2025-07-31');
 } finally { db.sqlite.close(); }
});

test('산분 검색에서도 보강을 전달하고 원문 변경 시 이전 근거를 해제한다', async () => {
 const db = database();
 try {
  const original = db.sqlite.prepare('SELECT question FROM faq_129 WHERE faq_id=?').get('18021');
  const result = await searchFaq129(db,refineWelfareQuery(original.question,{currentYear:2026}),{nowMs:NOW*1000});
  assert.ok(result.hits.find(row=>row.id==='faq129:18021').authoritative_clarification);
  db.sqlite.prepare('UPDATE faq_129 SET content_sha256=? WHERE faq_id=?').run('changed','18021');
  assert.equal((await getFaq129(db,'faq129:18021',NOW*1000)).authoritative_clarification,null);
 } finally { db.sqlite.close(); }
});
