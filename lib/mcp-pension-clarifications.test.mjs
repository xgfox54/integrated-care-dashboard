import assert from 'node:assert/strict';
import test from 'node:test';
import { database, NOW } from './press-test-support.mjs';
import { getFaq129, searchFaq129 } from './mcp/faq129.ts';
import { faq129Text } from './mcp/faq129-text.ts';
import { refineWelfareQuery } from './mcp/query-refiner.ts';
import { faqReviewMetadata } from './mcp/source-review.ts';

const proxyIds = ['15081', '10557', '11394', '18624', '1518', '1520', '1579'];

test('pension proxy exceptions reach search, detail and fetch without changing original answers', async () => {
  const db = database();
  try {
    for (const id of proxyIds) {
      const original = db.sqlite.prepare('SELECT answer, question, written_date, content_sha256 FROM faq_129 WHERE faq_id = ?').get(id);
      const detail = await getFaq129(db, 'faq129:' + id, NOW * 1000);
      assert.equal(detail.answer, original.answer);
      assert.equal(detail.written_date, original.written_date);
      assert.equal(detail.content_sha256, original.content_sha256);
      const supplement = detail.authoritative_clarification;
      assert.ok(supplement, id);
      assert.equal(supplement.reviewed_at, '2026-10-14');
      assert.equal(supplement.verification_scope, 'listed_guidance_only');
      const text = faq129Text(detail);
      assert.match(text, /배우자.*위임장을 제출하지 않아도/);
      assert.match(text, /공법상 법률행위의 대리권/);
      assert.match(text, /수급희망자의 동의/);
      assert.match(text, /사실혼 인정 또는 확인조사/);
      assert.match(text, /미지급 연금 청구.*자동 적용하지/);
      assert.match(text, /인쇄 19~20쪽 \/ PDF 37~38쪽/);
      assert.equal(supplement.sources[0].published_at, null);
      const hits = await searchFaq129(db, refineWelfareQuery(original.question, { currentYear: 2026 }), { nowMs: NOW * 1000 });
      const hit = hits.hits.find(row => row.id === detail.id);
      assert.ok(hit, id);
      assert.deepEqual(hit.authoritative_clarification, supplement);
      db.sqlite.prepare('UPDATE faq_129 SET content_sha256 = ? WHERE faq_id = ?').run('changed', id);
      assert.equal((await getFaq129(db, detail.id, NOW * 1000)).authoritative_clarification, null);
      assert.equal((await faqReviewMetadata(db, id, 'changed', '2026-10-14')).status, 'ORIGINAL_CHANGED');
    }
  } finally { db.sqlite.close(); }
});

test('foreign-spouse application exception remains distinct from payment and ambiguous two-year boundary', async () => {
  const db = database();
  try {
    const detail = await getFaq129(db, 'faq129:15099', NOW * 1000);
    const supplement = detail.authoritative_clarification;
    assert.equal(supplement.status, 'PARTIALLY_RESOLVED');
    assert.match(supplement.guidance.join(' '), /2년 미경과.*신청 가능/);
    assert.match(supplement.guidance.join(' '), /신청 가능 표시는 최종 수급·자동 지급 보장이 아니다/);
    assert.match(supplement.remaining_uncertainties.join(' '), /정확히 2년/);
    assert.equal((await faqReviewMetadata(db, '15099', detail.content_sha256, '2026-10-14')).current_policy_verified, false);
  } finally { db.sqlite.close(); }
});

test('added pension exceptions preserve statutory footnote scope and all special-recipient conditions', async () => {
  const db = database();
  try {
    for (const id of ['13959', '1520']) {
      const detail = await getFaq129(db, 'faq129:' + id, NOW * 1000);
      const text = faq129Text(detail);
      assert.match(text, /퇴직유족일시금의 경우 순직유족연금.*위험직무순직유족연금을 갈음하여 선택한 경우에 한정/);
      assert.match(text, /모든 퇴직·유족 일시금이 5년 후 예외라는 뜻이 아니다/);
      assert.match(text, /중증장애인 AND 1996년 6월 30일 이전 출생 AND 65세 도달 당시/);
      assert.match(text, /특례요건을 65세까지 유지/);
    }
    for (const id of ['4712', '7053']) {
      const detail = await getFaq129(db, 'faq129:' + id, NOW * 1000);
      assert.ok(detail, id);
      assert.equal(detail.authoritative_clarification, null);
    }
  } finally { db.sqlite.close(); }
});
