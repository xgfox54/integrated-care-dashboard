import assert from 'node:assert/strict';
import test from 'node:test';
import { database, NOW } from './press-test-support.mjs';
import { getFaq129, searchFaq129 } from './mcp/faq129.ts';
import { faq129Text } from './mcp/faq129-text.ts';
import { refineWelfareQuery } from './mcp/query-refiner.ts';
import { faqReviewMetadata } from './mcp/source-review.ts';

test('fertility pharmacy limits and conditional late claim reach search and fetch without changing the original', async () => {
  const db = database();
  try {
    const original = db.sqlite.prepare('SELECT question, answer, written_date, content_sha256 FROM faq_129 WHERE faq_id = ?').get('6850');
    const detail = await getFaq129(db, 'faq129:6850', NOW * 1000);
    assert.equal(detail.answer, original.answer);
    assert.equal(detail.written_date, original.written_date);
    assert.equal(detail.content_sha256, original.content_sha256);
    const supplement = detail.authoritative_clarification;
    assert.equal(supplement.verification_scope, 'listed_guidance_only');
    assert.equal(supplement.revision, 'official-clarifications-20261014-v7');
    assert.equal(supplement.sources[0].url, 'https://www.easylaw.go.kr/CSP/FlDownload.laf?flSeq=1769406083842');
    assert.equal(supplement.sources[0].published_at, null);
    const text = faq129Text(detail);
    assert.match(text, /프로게스테론/);
    assert.match(text, /모든 급여 원외약.*적용하지/);
    assert.match(text, /지연 사유.*AND.*보건소장.*6개월/);
    assert.match(text, /종로구.*소염제.*항생제/);
    assert.match(text, /단순 카드전표/);
    assert.match(text, /다른 지역.*관할 보건소/);
    assert.equal(supplement.sources[1].source_dates.updated_at, "2026-08-04");
    assert.equal(supplement.sources[1].published_at, null);
    const search = await searchFaq129(db, refineWelfareQuery(original.question, { currentYear: 2026 }), { nowMs: NOW * 1000 });
    assert.deepEqual(search.hits.find(hit => hit.id === detail.id).authoritative_clarification, supplement);
    assert.equal((await faqReviewMetadata(db, '6850', original.content_sha256, '2026-10-14')).current_policy_verified, false);
    db.sqlite.prepare('UPDATE faq_129 SET content_sha256 = ? WHERE faq_id = ?').run('changed', '6850');
    assert.equal((await getFaq129(db, 'faq129:6850', NOW * 1000)).authoritative_clarification, null);
    assert.equal((await faqReviewMetadata(db, '6850', 'changed', '2026-10-14')).status, 'ORIGINAL_CHANGED');
  } finally { db.sqlite.close(); }
});
