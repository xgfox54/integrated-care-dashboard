import assert from 'node:assert/strict';
import test from 'node:test';
import { database } from './press-test-support.mjs';
import { faq129Clarification, faq129ClarificationCatalog } from './mcp/faq129-clarifications.ts';
import { checkOfficialSource, faqReviewMetadata, reviewStatus } from './mcp/source-review.ts';
import { readReviewQueue } from './mcp/review-queue.ts';

test('law effective date and webpage update date must not be presented as publication dates', () => {
  const entries = faq129ClarificationCatalog();
  const law = entries.find((entry) => entry.faq_id === '12339').clarification.sources[0];
  assert.equal(law.published_at, null);
  assert.equal(law.source_dates.effective_at, '2026-04-03');
  const busan = entries.find((entry) => entry.faq_id === '16860').clarification.sources[0];
  assert.equal(busan.source_dates.updated_at, '2026-06-18');
  assert.equal(busan.source_dates.published_at, null);
});

test('original change disables supplemental guidance and remains visible in review queue', async () => {
  const db = database();
  try {
    db.sqlite.prepare("UPDATE faq_129 SET content_sha256 = 'changed' WHERE faq_id = '14234'").run();
    assert.equal(faq129Clarification('14234', 'changed'), null);
    assert.equal((await faqReviewMetadata(db, '14234', 'changed', '2026-10-12')).status, 'ORIGINAL_CHANGED');
    const queue = await readReviewQueue(db, new Date('2026-10-12'));
    assert.equal(queue.items.find((item) => item.id === 'faq129:14234').status, 'ORIGINAL_CHANGED');
    const faqItems = queue.items.filter((item) => item.kind === 'FAQ').map((item) => item.id).sort();
    assert.deepEqual(faqItems, faq129ClarificationCatalog().map((entry) => 'faq129:' + entry.faq_id).sort());
    for (const id of ['11394', '15099', '13959']) assert.ok(queue.items.some(item => item.id === 'faq129:' + id));
    for (const id of ['8131', '14303', '14003']) assert.ok(queue.items.some(item => item.id === 'faq129:' + id));
  } finally { db.sqlite.close(); }
});

test('source download baseline is not policy approval and changed bytes stay flagged across retries', async () => {
  const db = database();
  try {
    const url = faq129ClarificationCatalog()[0].clarification.sources[0].url;
    const fetcher = (body) => async () => new Response(body, { headers: { 'content-type': 'text/html' } });
    assert.equal((await checkOfficialSource(db, url, fetcher('official version one'))).status, 'BASELINE_RECORDED');
    assert.equal((await checkOfficialSource(db, url, fetcher('official version one'))).status, 'UNCHANGED');
    assert.equal((await checkOfficialSource(db, url, fetcher('official version two'))).status, 'CHANGED');
    assert.equal((await checkOfficialSource(db, url, fetcher('official version two'))).status, 'CHANGED');
    const entry = faq129ClarificationCatalog().find((item) => item.clarification.sources.some((source) => source.url === url));
    assert.equal((await faqReviewMetadata(db, entry.faq_id, entry.clarification.original_content_sha256, '2026-10-12')).status, 'SOURCE_CHANGED');
  } finally { db.sqlite.close(); }
});

test('source fetch is exact allowlist, fails closed on HTTP errors and retains original baseline', async () => {
  const db = database();
  try {
    let called = false;
    await assert.rejects(checkOfficialSource(db, 'https://example.com', async () => { called = true; return new Response(''); }), /SOURCE_NOT_REGISTERED/);
    assert.equal(called, false);
    const url = faq129ClarificationCatalog()[0].clarification.sources[0].url;
    const first = await checkOfficialSource(db, url, async (_url, options) => { assert.equal(options.redirect, 'error'); return new Response('source', { headers: { 'content-type': 'application/pdf' } }); });
    const failed = await checkOfficialSource(db, url, async () => new Response('no source', { status: 404 }));
    assert.equal(failed.status, 'CHECK_FAILED');
    assert.equal(failed.baseline_sha256, first.baseline_sha256);
    assert.equal(failed.error_code, 'SOURCE_HTTP_404');
  } finally { db.sqlite.close(); }
});

test('recheck deadline and unresolved guidance are distinct from whole-policy verification', () => {
  assert.equal(reviewStatus(true, '2026-11-11', false, [], '2026-11-11'), 'RECHECK_DUE');
  assert.equal(reviewStatus(true, '2026-11-11', true, [], '2026-10-12'), 'PARTIAL');
  assert.equal(reviewStatus(true, '2026-11-11', false, [], '2026-10-12'), 'REVIEWED_GUIDANCE');
});

test('visible content comparison ignores scripts and navigation but preserves policy dates and amounts', async () => {
  const db = database();
  try {
    const url = faq129ClarificationCatalog()[0].clarification.sources[0].url;
    const page = (nonce, content) => async () => new Response('<html><body><nav>' + nonce + '</nav><main><script>' + nonce + '</script><p>' + content + '</p></main></body></html>', { headers: { 'content-type': 'text/html' } });
    const first = await checkOfficialSource(db, url, page('one', '2026년 10월 31일까지 100원'));
    const second = await checkOfficialSource(db, url, page('two', '2026년 10월 31일까지 100원'));
    assert.notEqual(first.observed_sha256, second.observed_sha256);
    assert.equal(second.status, 'UNCHANGED');
    assert.equal((await checkOfficialSource(db, url, page('three', '2026년 11월 30일까지 100원'))).status, 'CHANGED');
    assert.equal((await checkOfficialSource(db, url, page('four', '2026년 10월 31일까지 200원'))).status, 'CHANGED');
    const queue = await readReviewQueue(db);
    assert.ok(queue.items.some(item => item.gaps.some(gap => gap.includes('출처 변경 영향:'))));
  } finally { db.sqlite.close(); }
});

test('a changed pre-migration byte baseline cannot be silently accepted as the new content baseline', async () => {
  const db = database();
  try {
    const url = faq129ClarificationCatalog()[0].clarification.sources[0].url;
    db.sqlite.prepare("INSERT INTO official_source_review(source_url,baseline_sha256,observed_sha256,checked_at,status,error_code) VALUES(?,?,?,?,?,NULL)").run(url, 'old', 'changed', '2026-10-12', 'CHANGED');
    for (let attempt = 0; attempt < 2; attempt++) {
      const row = await checkOfficialSource(db, url, async () => new Response('changed', { headers: { 'content-type': 'application/pdf' } }));
      assert.equal(row.status, 'CHANGED');
      assert.equal(row.baseline_content_sha256, null);
    }
  } finally { db.sqlite.close(); }
});
