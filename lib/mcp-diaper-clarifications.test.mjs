import assert from 'node:assert/strict';
import test from 'node:test';
import { database, NOW } from './press-test-support.mjs';
import { getFaq129, searchFaq129 } from './mcp/faq129.ts';
import { faq129Text } from './mcp/faq129-text.ts';
import { refineWelfareQuery } from './mcp/query-refiner.ts';
import { faqReviewMetadata } from './mcp/source-review.ts';

test('diaper eligibility source reaches search and full answer with a dated July change and intact original', async () => {
  const db = database();
  try {
    const original = db.sqlite.prepare('SELECT question, answer, written_date, content_sha256 FROM faq_129 WHERE faq_id = ?').get('2889');
    const detail = await getFaq129(db, 'faq129:2889', NOW * 1000);
    assert.equal(detail.answer, original.answer);
    assert.equal(detail.written_date, original.written_date);
    assert.equal(detail.content_sha256, original.content_sha256);
    const supplement = detail.authoritative_clarification;
    assert.equal(supplement.verification_scope, 'listed_guidance_only');
    assert.equal(supplement.revision, 'official-clarifications-20261014-v6');
    assert.equal(supplement.sources[0].url, 'https://www.socialservice.or.kr:444/upload/etc/2026_GH01.pdf');
    assert.equal(supplement.sources[0].published_at, null);
    const text = faq129Text(detail);
    assert.match(text, /2026년 7월부터 80%에서 100%로/);
    assert.match(text, /7월 전 기간.*소급 적용하지/);
    assert.match(text, /별도 100% 요건을 추가하지/);
    assert.match(text, /모든 자녀가 만 2세 미만.*아니다/);
    const search = await searchFaq129(db, refineWelfareQuery(original.question, { currentYear: 2026 }), { nowMs: NOW * 1000 });
    assert.deepEqual(search.hits.find(hit => hit.id === detail.id).authoritative_clarification, supplement);
    assert.equal((await faqReviewMetadata(db, '2889', original.content_sha256, '2026-10-14')).current_policy_verified, false);
    db.sqlite.prepare('UPDATE faq_129 SET content_sha256 = ? WHERE faq_id = ?').run('changed', '2889');
    assert.equal((await getFaq129(db, 'faq129:2889', NOW * 1000)).authoritative_clarification, null);
    assert.equal((await faqReviewMetadata(db, '2889', 'changed', '2026-10-14')).status, 'ORIGINAL_CHANGED');
  } finally { db.sqlite.close(); }
});
