import assert from 'node:assert/strict';
import test from 'node:test';
import { database, NOW } from './press-test-support.mjs';
import { getFaq129, searchFaq129 } from './mcp/faq129.ts';
import { refineWelfareQuery } from './mcp/query-refiner.ts';
import { faq129Text } from './mcp/faq129-text.ts';

test('emergency care supplements retain consent, receipt confirmation and voucher order', async () => {
  const db = database();
  try {
    const original = db.sqlite.prepare('SELECT answer, written_date, content_sha256 FROM faq_129 WHERE faq_id = ?').get('14156');
    const detail = await getFaq129(db, 'faq129:14156', NOW * 1000);
    assert.equal(detail.answer, original.answer);
    assert.equal(detail.written_date, original.written_date);
    assert.equal(detail.content_sha256, original.content_sha256);
    const clarification = detail.authoritative_clarification;
    assert.ok(clarification);
    const guidance = clarification.guidance.join('\n');
    for (const condition of ['신청자의 동의', '우편·팩스', '제출 사실을 확인', '기존 바우처를 먼저', '최초 생성일부터90일', '발달장애인 긴급돌봄']) assert.ok(guidance.includes(condition), condition);
    assert.ok(faq129Text(detail).includes('신청자의 동의'));
    assert.ok(detail.answer_criteria.supplemental_guidance.some(line => line.includes('기존 바우처를 먼저')));
    assert.ok(clarification.sources.some(source => source.url === 'https://www.socialservice.or.kr:444/user/htmlEditor/view2.do?p_sn=83'));
    assert.equal(clarification.sources.find(source => source.publisher === '보건복지부').source_dates.updated_at, '2026-10-06');
  } finally { db.sqlite.close(); }
});

test('emergency care scope reaches search and does not cross to developmental disability care', async () => {
  const db = database();
  try {
    const source = db.sqlite.prepare('SELECT question FROM faq_129 WHERE faq_id = ?').get('14156');
    const result = await searchFaq129(db, refineWelfareQuery(source.question, { currentYear: 2026 }), { nowMs: NOW * 1000 });
    const hit = result.hits.find(row => row.id === 'faq129:14156');
    assert.ok(hit.authoritative_clarification.guidance.some(line => line.includes('신청자의 동의')));
    assert.equal((await getFaq129(db, 'faq129:15939', NOW * 1000)).authoritative_clarification, null);
    db.sqlite.prepare('UPDATE faq_129 SET content_sha256 = ? WHERE faq_id = ?').run('changed', '14156');
    assert.equal((await getFaq129(db, 'faq129:14156', NOW * 1000)).authoritative_clarification, null);
  } finally { db.sqlite.close(); }
});
