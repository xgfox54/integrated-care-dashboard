import assert from 'node:assert/strict';
import test from 'node:test';
import { database, NOW } from './press-test-support.mjs';
import { getFaq129, searchFaq129 } from './mcp/faq129.ts';
import { refineWelfareQuery } from './mcp/query-refiner.ts';
import { faq129Text } from './mcp/faq129-text.ts';

const cases = [
  { id: '1590', url: 'https://basicpension.mohw.go.kr/menu.es?mid=a10102010000', effective: null, guidance: '2026년 선정기준액' },
  { id: '1601', url: 'https://basicpension.mohw.go.kr/menu.es?mid=a10102010000', effective: null, guidance: '2026년 선정기준액' },
  { id: '13958', url: 'https://basicpension.mohw.go.kr/menu.es?mid=a10102010000', effective: null, guidance: '2026년 선정기준액' },
  { id: '10235', url: 'https://basicpension.mohw.go.kr/menu.es?mid=a10103010000', effective: null, guidance: '표의 설명·접근성 제목' },
  { id: '16320', url: 'https://www.nhis.or.kr/renewal_popup/poster/20260701_poster_longdesc_1.html', effective: '2026-07-01', guidance: '진료건 적용일' },
];

test('general pension eligibility supplements preserve complete occupational pension exceptions', async () => {
  const db = database();
  try {
    const detail = await getFaq129(db, 'faq129:13958', NOW * 1000);
    const supplement = detail.authoritative_clarification;
    assert.equal(supplement.revision, 'official-clarifications-20261014-v11');
    assert.ok(supplement.sources.some(source => source.url.includes('017ed301-1937-4722-8396-bcebd422fca4')));
    const guidance = supplement.guidance.join('\n');
    for (const condition of ['중증장애인 AND', '1996년 6월 30일 이전 출생 AND', '65세 도달 당시', '65세까지 유지', '1949년 6월 30일 이전 출생 AND', '5년 경과', '갈음하여 선택']) {
      assert.ok(guidance.includes(condition), condition);
    }
    assert.ok(faq129Text(detail).includes('65세까지 유지'));
  } finally { db.sqlite.close(); }
});

for (const entry of cases) {
  test(`source date clarification preserves original FAQ ${entry.id}`, async () => {
    const db = database();
    try {
      const original = db.sqlite.prepare('SELECT answer, written_date, content_sha256 FROM faq_129 WHERE faq_id = ?').get(entry.id);
      const detail = await getFaq129(db, 'faq129:' + entry.id, NOW * 1000);
      assert.equal(detail.answer, original.answer);
      assert.equal(detail.written_date, original.written_date);
      assert.equal(detail.content_sha256, original.content_sha256);
      const supplement = detail.authoritative_clarification;
      assert.ok(supplement);
      assert.ok(supplement.guidance.some(text => text.includes(entry.guidance)));
      const source = supplement.sources.find(row => row.url === entry.url);
      assert.ok(source);
      assert.equal(source.source_dates.published_at, null);
      assert.equal(source.source_dates.posted_at, null);
      assert.equal(source.source_dates.updated_at, null);
      assert.equal(source.source_dates.effective_at, entry.effective);
      if (entry.id !== '16320') {
        const snapshot = source.verified_snapshot;
        assert.equal(snapshot.retrieval_method, 'direct_public_page_body');
        assert.equal(snapshot.verification_scope, 'listed_excerpt_only');
        assert.equal(snapshot.checked_at, '2026-10-14');
        assert.match(snapshot.source_snapshot_sha256, /^[a-f0-9]{64}$/);
        assert.match(snapshot.excerpt, /2026/);
        assert.ok(faq129Text(detail).includes(JSON.stringify(snapshot)));
      }
    } finally { db.sqlite.close(); }
  });

  test(`source date clarification reaches search result ${entry.id}`, async () => {
    const db = database();
    try {
      const original = db.sqlite.prepare('SELECT question FROM faq_129 WHERE faq_id = ?').get(entry.id);
      const result = await searchFaq129(db, refineWelfareQuery(original.question, { currentYear: 2026 }), { nowMs: NOW * 1000 });
      const hit = result.hits.find(row => row.id === 'faq129:' + entry.id);
      assert.ok(hit?.authoritative_clarification?.sources.some(row => row.url === entry.url));
    } finally { db.sqlite.close(); }
  });

  test(`source date clarification expires when original FAQ ${entry.id} changes`, async () => {
    const db = database();
    try {
      db.sqlite.prepare('UPDATE faq_129 SET content_sha256 = ? WHERE faq_id = ?').run('changed', entry.id);
      const detail = await getFaq129(db, 'faq129:' + entry.id, NOW * 1000);
      assert.equal(detail.authoritative_clarification, null);
    } finally { db.sqlite.close(); }
  });
}
