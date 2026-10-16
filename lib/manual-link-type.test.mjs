import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { assessManualLink } from './manual-link-type.ts';
import { assessManualProvenance } from './manual-link-provenance.ts';
import { WelfareCatalog } from './mcp/welfare-catalog.ts';

const ref = { key: '12', title: '종합 복지안내', heading: '3. 기초연금', match: '제도명 일치' };
const original = { file: '기초연금.pdf', format: 'PDF', page: 3, pages: 10, basis: 'line', ocr: false, quote: '기초연금 대상자 안내' };

test('partial titles, sibling program headings and contact headings remain candidates', () => {
  assert.equal(assessManualLink({ ...ref, title: '2026년 재가의료급여사업 안내', heading: '문의' }, '의료급여').type, 'CANDIDATE');
  for (const heading of ['기초연금 문의', '기초연금 관련사업', '기초연금 및 장애인연금', '장애인연금 > 기초연금 문의', '기초연금 지원사업']) {
    assert.equal(assessManualLink({ ...ref, heading }, '기초연금').confirmed, false, heading);
  }
});

test('only exact program identity gets dedicated or section confirmation', () => {
  assert.equal(assessManualLink({ ...ref, title: '[매뉴얼-공적급여] 2026년 기초연금 사업안내(개정)' }, '기초연금').type, 'A');
  assert.equal(assessManualLink(ref, '기초연금').type, 'C');
  assert.equal(assessManualLink({ ...ref, key: '18', title: '기초연금, 장애인연금 안내(합본)' }, '기초연금').type, 'B');
  assert.equal(assessManualLink({ ...ref, title: '기초연금, 장애인연금 안내(합본)', heading: '문의' }, '기초연금').type, 'CANDIDATE');
  assert.equal(assessManualLink({ ...ref, match: '관련 언급' }, '기초연금').confirmed, false);
});

test('a candidate with a plausible original page and quote is never promoted by provenance alone', () => {
  const result = assessManualLink({ ...ref, heading: '관련사업', original }, '기초연금');
  assert.equal(result.confirmed, false);
  assert.equal(result.provenance.status, 'PAGE_QUOTE');
  assert.equal(result.provenance.quoteVerified, false);
});

test('page metadata rejects zero, fractional, reversed and out of bounds positions', () => {
  for (const override of [{ page: 0 }, { page: 1.5 }, { page: 11 }, { pages: 0 }, { pages: 1.5 }, { pageEnd: 2 }, { pageEnd: 11 }, { file: '' }, { format: 'HTML' }, { basis: 'unknown' }, { quote: 123 }, { ocr: undefined }]) {
    const result = assessManualLink({ ...ref, original: { ...original, ...override } }, '기초연금');
    assert.equal(result.confirmed, false, JSON.stringify(override));
    assert.equal(result.provenance.status, 'INVALID');
    assert.ok(result.provenance.issues.length);
  }
});

test('document-only, context, OCR and empty quotes do not confirm a section', () => {
  for (const override of [{ basis: 'document' }, { basis: 'context' }, { ocr: true }, { quote: null }, { quote: '  ' }]) {
    assert.equal(assessManualLink({ ...ref, original: { ...original, ...override } }, '기초연금').confirmed, false);
  }
  assert.equal(assessManualLink({ ...ref, original }, '기초연금').type, 'C');
  assert.equal(assessManualProvenance().status, 'MISSING');
  assert.equal(assessManualProvenance({ ...original, format: 'HWPX', pageEnd: 4 }).status, 'PAGE_QUOTE');
});

test('dedicated document identity is separate from page quotation verification and year applicability', () => {
  const result = assessManualLink({ ...ref, title: '2025년 기초연금 사업안내', original: { ...original, basis: 'document', quote: null } }, '기초연금', 2026);
  assert.equal(result.type, 'A');
  assert.equal(result.provenance.status, 'DOCUMENT');
  assert.equal(result.provenance.quoteVerified, false);
  assert.match(result.yearNote, /연도 불일치/);
});

test('public welfare catalog downgrades a real sibling mention while preserving original provenance', async () => {
  const catalog = new WelfareCatalog({ async fetch(request) {
    const path = new URL(request.url).pathname;
    assert.match(path, /^\/data\/welfare100\/(index-lite\.json|items\/[A-Za-z0-9_-]+\.json)$/);
    return new Response(await readFile(new URL('../public' + path, import.meta.url)));
  } });
  const excluded = await catalog.detail('welfare100_service:WLF00000024', 'https://dashboard.example');
  assert.ok(!excluded.manual_references.some(item => item.key === '14'), '원문 검수에서 나열 언급으로 확인한 연결은 빠진다');
  const result = await catalog.detail('welfare100_service:WLF00000344', 'https://dashboard.example');
  const mention = result.manual_references.find(item => item.key === '11');
  assert.ok(mention);
  assert.equal(mention.link_type, 'CANDIDATE');
  assert.equal(mention.link_confirmed, false);
  assert.equal(mention.original.page, 222);
  assert.match(mention.original.file, /나에게\+힘이\+되는\+복지서비스/);
  assert.ok(mention.original.quote.length > 0);
  const dedicated = await catalog.detail('welfare100_service:basic-pension', 'https://dashboard.example');
  const manual = dedicated.manual_references.find(item => item.key === '05');
  assert.equal(manual.link_type, 'A');
  assert.equal(manual.original.basis, 'document');
  assert.equal(manual.original.quote, null);
});

test('장·절 번호와 사업안내 끝말을 뗀 절 제목이 제도명과 같으면 본문 직접 설명으로 확정한다', () => {
  const sectionRef = { ...ref, key: '14', title: '[매뉴얼-장애] 장애인복지사업안내', original: { ...original, quote: '보조기기 교부 대상' } };
  for (const [heading, name] of [['6-3 장애인 보조기기 교부', '장애인 보조기기 교부'], ['제6장 치매공공후견 사업안내', '치매공공후견'], ['7.2. 치매치료관리비 지원', '치매치료관리비 지원'], ['6 -8 노인 건강진단', '노인건강진단'], ['12 긴급복지지원사업', '긴급복지지원사업']]) {
    assert.equal(assessManualLink({ ...sectionRef, heading }, name).type, 'B', heading);
  }
  for (const heading of ['01 지자체의 무연고 사망자 장례지원', '5. 난임부부 지원사업 심의위원회 구성･운영', '나. 거동불편 저소득 재가노인 식사배달']) {
    assert.equal(assessManualLink({ ...sectionRef, heading }, heading.includes('무연고') ? '무연고 사망자 장례지원' : heading.includes('난임') ? '난임부부지원사업' : '저소득재가노인 식사배달').confirmed, false, heading);
  }
});

test('reviewed links confirm only with page evidence, and list rows stay candidates', () => {
  const review = { decision: 'DIRECT', checkedAt: '2026-10-15', source: 'review' };
  assert.equal(assessManualLink({ ...ref, key: '16', title: '노인보건복지사업안내', heading: '6 -8 노인 건강진단', original, review }, '노인건강진단사업').type, 'B');
  assert.equal(assessManualLink({ ...ref, heading: '해당 절', original, review }, '기초연금').type, 'C');
  assert.equal(assessManualLink({ ...ref, key: '21', title: '돌봄 사업안내(합본)', original: { ...original, basis: 'document', quote: null }, review }, '일상돌봄 서비스').type, 'A');
  assert.equal(assessManualLink({ ...ref, key: '17', original: { ...original, basis: 'context' }, review }, '입양 지원').confirmed, false);
  assert.equal(assessManualLink({ ...ref, key: '21', original: { ...original, basis: 'document', quote: null } }, '일상돌봄 서비스').confirmed, false, '검수 없이 원본 파일 전체 연결만으로는 확정하지 않는다');
  const listed = assessManualLink({ ...ref, key: '29', heading: '', original, review: { ...review, decision: 'LIST_ENTRY', source: 'rule' } }, '제주형건강주치의 시범사업');
  assert.equal(listed.confirmed, false);
  assert.match(listed.basis, /사업 목록 표/);
});

test('a dedicated manual title may end with 사업 before its guide suffix', () => {
  assert.equal(assessManualLink({ ...ref, key: '06', title: '[매뉴얼-공적급여] 2026년 청년월세 지원사업 매뉴얼', heading: '' }, '청년월세 지원').type, 'A');
  assert.equal(assessManualLink({ ...ref, key: '03', title: '[매뉴얼-공적급여] 2026년 주거급여 사업안내', heading: '' }, '주거급여').type, 'A');
  assert.notEqual(assessManualLink({ ...ref, key: '04', title: '2026년 재가의료급여사업 안내', heading: '' }, '의료급여').type, 'A');
});


test('a review whose source line changed is shown as needing re-review', () => {
  const result = assessManualLink({ ...ref, original, review: { decision: 'RECHECK', checkedAt: '2026-10-15', source: 'review' } }, '기초연금');
  assert.equal(result.confirmed, false);
  assert.match(result.basis, /재검수/);
});

