import assert from 'node:assert/strict';
import test from 'node:test';
import { database, NOW } from './press-test-support.mjs';
import { getFaq129, searchFaq129 } from './mcp/faq129.ts';
import { refineWelfareQuery } from './mcp/query-refiner.ts';
import { faq129Text } from './mcp/faq129-text.ts';

test('일상돌봄의 국적 및 직권신청 동의를 원문과 별도 전달한다', async () => {
 const db = database();
 try {
  const original = db.sqlite.prepare('SELECT answer,written_date,content_sha256 FROM faq_129 WHERE faq_id=?').get('15179');
  const detail = await getFaq129(db,'faq129:15179',NOW*1000);
  assert.equal(detail.answer,original.answer); assert.equal(detail.written_date,original.written_date); assert.equal(detail.content_sha256,original.content_sha256);
  assert.ok(detail.authoritative_clarification);
  const text = detail.authoritative_clarification.guidance.join('\n');
  for (const term of ['대한민국 국적','신청자의 동의','긴급돌봄','전화·우편·팩스']) assert.ok(text.includes(term),term);
  assert.ok(faq129Text(detail).includes('신청자의 동의'));
  assert.ok(detail.answer_criteria.supplemental_guidance.some(line=>line.includes('대한민국 국적')));
 } finally {db.sqlite.close();}
});
test('일상돌봄 검색에 보강을 전달하고 원문 변경 시 해제한다', async () => {
 const db=database();
 try {
  const source=db.sqlite.prepare('SELECT question FROM faq_129 WHERE faq_id=?').get('15179');
  const result=await searchFaq129(db,refineWelfareQuery(source.question,{currentYear:2026}),{nowMs:NOW*1000});
  assert.ok(result.hits.find(row=>row.id==='faq129:15179').authoritative_clarification);
  db.sqlite.prepare('UPDATE faq_129 SET content_sha256=? WHERE faq_id=?').run('changed','15179');
  assert.equal((await getFaq129(db,'faq129:15179',NOW*1000)).authoritative_clarification,null);
 } finally {db.sqlite.close();}
});
