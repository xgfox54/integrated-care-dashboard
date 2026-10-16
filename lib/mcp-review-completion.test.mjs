import assert from 'node:assert/strict';
import test from 'node:test';
import { database } from './press-test-support.mjs';
import { faq129ClarificationCatalog } from './mcp/faq129-clarifications.ts';
import { checkOfficialSource, faqReviewMetadata } from './mcp/source-review.ts';
import { completeOfficialReview, reviewCompletions } from './mcp/review-completion.ts';

const catalog = faq129ClarificationCatalog();
const html = (body) => async () => new Response('<main>' + body + '</main>', { headers: { 'content-type': 'text/html' } });
function input(entry, check, result = 'GUIDANCE_UNCHANGED') {
  return { action: 'complete_review', faq_id: entry.faq_id, source_url: check.source_url, faq_content_sha256: entry.clarification.original_content_sha256,
    observed_sha256: check.observed_sha256, observed_content_sha256: check.observed_content_sha256, source_checked_at: check.checked_at, result,
    evidence_quote: '공식 지침의 해당 조건과 예외를 대조했습니다.', evidence_location: '표 및 각주', reason: '해당 FAQ 보강 안내 범위에서 기존 기준 유지 확인' };
}

test('completion is append only, source scoped and does not resolve unclear official guidance', async () => {
  const db = database();
  try {
    const entry = catalog.find(item => item.faq_id === '921');
    const url = entry.clarification.sources[0].url;
    await checkOfficialSource(db, url, html('before'));
    const check = await checkOfficialSource(db, url, html('after'), new Date('2026-10-12T10:00:00Z'));
    await completeOfficialReview(db, input(entry, check), new Date('2026-10-12T10:01:00Z'));
    assert.equal((await faqReviewMetadata(db, '921', entry.clarification.original_content_sha256, '2026-10-12')).status, 'PARTIAL');
    const shared = catalog.find(item => item.faq_id === '12023');
    assert.equal((await faqReviewMetadata(db, shared.faq_id, shared.clarification.original_content_sha256, '2026-10-12')).status, 'SOURCE_CHANGED');
    assert.throws(() => db.sqlite.exec("UPDATE official_review_completion SET reason='rewrite'"), /REVIEW_HISTORY_IMMUTABLE/);
    assert.throws(() => db.sqlite.exec('DELETE FROM official_review_completion'), /REVIEW_HISTORY_IMMUTABLE/);
    assert.equal((await reviewCompletions(db)).length, 1);
    const partiallyReviewed = await faqReviewMetadata(db, '921', entry.clarification.original_content_sha256, '2026-11-11');
    assert.equal(partiallyReviewed.status, 'PARTIAL');
    assert.equal(partiallyReviewed.review_due_at, entry.clarification.review_due_at);
    assert.equal((await faqReviewMetadata(db, '921', entry.clarification.original_content_sha256, entry.clarification.review_due_at)).status, 'RECHECK_DUE');
    await checkOfficialSource(db, url, html('third'));
    assert.equal((await faqReviewMetadata(db, '921', entry.clarification.original_content_sha256, '2026-10-12')).status, 'SOURCE_CHANGED');
  } finally { db.sqlite.close(); }
});

test('failed downloads, stale check tickets and modified FAQ hashes cannot be completed', async () => {
  const db = database();
  try {
    const entry = catalog.find(item => item.faq_id === '16860');
    const url = entry.clarification.sources[0].url;
    const check = await checkOfficialSource(db, url, html('baseline'), new Date('2026-10-12T10:00:00Z'));
    await checkOfficialSource(db, url, html('baseline'), new Date('2026-10-12T10:01:00Z'));
    await assert.rejects(completeOfficialReview(db, input(entry, check)), /SOURCE_OR_FAQ_CHANGED/);
    const failed = await checkOfficialSource(db, url, async () => new Response('', { status: 503 }));
    await assert.rejects(completeOfficialReview(db, input(entry, failed)), /SOURCE_OR_FAQ_CHANGED/);
    const latest = await checkOfficialSource(db, url, html('baseline'));
    db.sqlite.prepare("UPDATE faq_129 SET content_sha256=? WHERE faq_id=?").run('a'.repeat(64), entry.faq_id);
    await assert.rejects(completeOfficialReview(db, input(entry, latest)), /SOURCE_OR_FAQ_CHANGED/);
    assert.equal((await reviewCompletions(db)).length, 0);
  } finally { db.sqlite.close(); }
});

test('follow up remains open and timeout has a separate cause code', async () => {
  const db = database();
  try {
    const entry = catalog.find(item => item.faq_id === '16860');
    const url = entry.clarification.sources[0].url;
    const check = await checkOfficialSource(db, url, html('baseline'));
    await completeOfficialReview(db, input(entry, check, 'FOLLOW_UP_REQUIRED'));
    assert.equal((await faqReviewMetadata(db, entry.faq_id, entry.clarification.original_content_sha256, '2026-10-12')).status, 'PARTIAL');
    const failed = await checkOfficialSource(db, url, async () => { throw new DOMException('deadline', 'TimeoutError'); });
    assert.equal(failed.error_code, 'SOURCE_TIMEOUT');
    assert.equal((await faqReviewMetadata(db, entry.faq_id, entry.clarification.original_content_sha256, '2026-10-12')).status, 'RECHECK_FAILED');
  } finally { db.sqlite.close(); }
});
