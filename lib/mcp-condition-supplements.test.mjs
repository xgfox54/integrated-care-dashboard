import assert from 'node:assert/strict';
import test from 'node:test';
import { database, NOW } from './press-test-support.mjs';
import { getFaq129, searchFaq129 } from './mcp/faq129.ts';
import { refineWelfareQuery } from './mcp/query-refiner.ts';

const cases = [
  { id: '15259', url: 'https://www.law.go.kr/LSW/flDownload.do?flSeq=149443583', effective: null },
  { id: '9715', url: 'https://law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lspttninfSeq=79752', effective: '2026-08-14' },
  { id: '9718', url: 'https://law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lspttninfSeq=79752', effective: '2026-08-14' },
  { id: '1003', url: 'https://www.socialservice.or.kr:444/upload/etc/2026_GH01.pdf', effective: null },
  { id: '9692', url: 'https://www.law.go.kr/LSW/flDownload.do?gubun=&flSeq=167218505&bylClsCd=110201', effective: '2026-08-14' },
  { id: '9710', url: 'https://www.law.go.kr/LSW/flDownload.do?gubun=&flSeq=167218505&bylClsCd=110201', effective: '2026-08-14' },
  { id: '18363', url: 'https://www.1661-2129.or.kr/download/2026%EB%85%84%20%EB%85%B8%EC%9D%B8%EB%A7%9E%EC%B6%A4%EB%8F%8C%EB%B4%84%EC%84%9C%EB%B9%84%EC%8A%A4%20%EC%82%AC%EC%97%85%EC%95%88%EB%82%B4.pdf', effective: null },
];

for (const entry of cases) {
  test(`reviewed condition supplement reaches detail when ${entry.id} source is unchanged`, async () => {
    const db = database();
    try {
      const original = db.sqlite.prepare('SELECT answer, written_date, content_sha256 FROM faq_129 WHERE faq_id = ?').get(entry.id);
      const detail = await getFaq129(db, 'faq129:' + entry.id, NOW * 1000);
      assert.ok(detail.authoritative_clarification);
      assert.equal(detail.answer, original.answer);
      assert.equal(detail.written_date, original.written_date);
      assert.equal(detail.content_sha256, original.content_sha256);
      const source = detail.authoritative_clarification.sources.find(row => row.url === entry.url);
      assert.ok(source);
      assert.equal(source.source_dates.published_at, null);
      assert.equal(source.source_dates.effective_at, entry.effective);
    } finally { db.sqlite.close(); }
  });

  test(`reviewed supplement reaches search when querying ${entry.id}`, async () => {
    const db = database();
    try {
      const original = db.sqlite.prepare('SELECT question FROM faq_129 WHERE faq_id = ?').get(entry.id);
      const result = await searchFaq129(db, refineWelfareQuery(original.question, { currentYear: 2026 }), { nowMs: NOW * 1000 });
      const hit = result.hits.find(row => row.id === 'faq129:' + entry.id);
      assert.ok(hit);
      assert.ok(hit.authoritative_clarification?.sources.some(row => row.url === entry.url));
    } finally { db.sqlite.close(); }
  });

  test(`reviewed supplement is invalidated when ${entry.id} original hash changes`, async () => {
    const db = database();
    try {
      db.sqlite.prepare('UPDATE faq_129 SET content_sha256 = ? WHERE faq_id = ?').run('changed', entry.id);
      const detail = await getFaq129(db, 'faq129:' + entry.id, NOW * 1000);
      assert.equal(detail.authoritative_clarification, null);
    } finally { db.sqlite.close(); }
  });
}
