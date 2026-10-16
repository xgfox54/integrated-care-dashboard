import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { matchesSearch, parseSearch, searchableText } from './search-terms.ts';
import { parseWelfareSearch, welfareSearchExpansions, welfareSearchScore } from './welfare100/search.ts';
import { manualReferenceEvidence, originalEvidenceNote, originalLocatorStatus, summarizeManualReferences } from './welfare100/evidence-status.ts';
import { provisionReviewFor, recipientProvisionOf } from './welfare100/provision-review.ts';
import { selectionFieldStatus } from './welfare100/field-status.ts';
import { WelfareCatalog } from './mcp/welfare-catalog.ts';
import { refineWelfareQuery } from './mcp/query-refiner.ts';

const read = (name) => readFile(new URL('../' + name, import.meta.url), 'utf8');
const json = async (name) => JSON.parse(await read(name));
const assets = { async fetch(request) {
  const path = new URL(request.url).pathname;
  assert.match(path, /^\/data\/welfare100\/(index-lite\.json|items\/[A-Za-z0-9_-]+\.json)$/);
  try { return new Response(await read('public' + path), { headers: { 'content-type': 'application/json' } }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return new Response('', { status: 404 }); }
} };
const catalog = new WelfareCatalog(assets);
const plan = (query, ancestors = true) => ({ ...refineWelfareQuery(query, { currentYear: 2026 }), region_id: 'region:제주특별자치도|서귀포시', include_ancestor_scope: ancestors });
const ref = (patch = {}) => ({ key: '11', title: '종합안내서', line: 10, match: '관련 언급', count: 1, excerpt: '저장 발췌', ...patch });
const original = { file: 'example.pdf', format: 'PDF', page: 2, pages: 10, basis: 'line', quote: '원문 후보', ocr: false };

for (const word of ['식사', '급식', '도시락']) {
  test('밥 검색은 ' + word + ' 관련 설명을 찾는다', () => {
    const text = searchableText([word + ' 제공']);
    assert.equal(matchesSearch(text, parseSearch('밥')), false);
    assert.equal(matchesSearch(text, parseWelfareSearch('밥')), true);
  });
}

test('검색 연산자의 부정·명시 OR·와일드카드를 확장하지 않는다', () => {
  for (const query of ['-밥', '!밥', '밥|식사', '밥*지원']) {
    assert.deepEqual(parseWelfareSearch(query), parseSearch(query), query);
  }
  assert.equal(matchesSearch(searchableText(['식사 도시락']), parseWelfareSearch('밥 -식사')), false);
  assert.equal(matchesSearch(searchableText(['도시락']), parseWelfareSearch('밥 -식사')), true);
});

test('사전에 없는 검색어와 지역어의 기존 의미를 보존한다', () => {
  for (const query of ['', '기초연금', '서귀포시', '없는제도XYZ123', '제주 기초연금']) {
    assert.deepEqual(parseWelfareSearch(query), parseSearch(query), query);
  }
});

test('생활용어 확장 사실을 노출하며 검색어 원문을 바꾸지 않는다', () => {
  assert.deepEqual(welfareSearchExpansions('밥'), [{ input: '밥', related: ['식사', '급식', '도시락'] }]);
  assert.equal(parseWelfareSearch('밥').terms[0].text, '밥');
  assert.equal(welfareSearchExpansions('-밥').length, 0);
});

test('실제 입력과 일치한 결과가 관련어만 일치한 결과보다 우선한다', () => {
  const literal = { name: '직장인 점심밥', searchText: searchableText(['직장인 점심밥']) };
  const related = { name: '식사 지원', searchText: searchableText(['식사 지원']) };
  assert.ok(welfareSearchScore(literal, '밥') > welfareSearchScore(related, '밥'));
});

test('편집근거 표시만으로 후보를 확정하거나 인용문을 검증 완료로 바꾸지 않는다', () => {
  const candidate = manualReferenceEvidence(ref({ curatedSource: true, original }), '기초연금');
  assert.equal(candidate.link_confirmed, false);
  assert.equal(candidate.original_quote_verified, false);
  assert.equal(candidate.original_locator_status, 'PAGE_QUOTE');
  assert.equal(candidate.effective_period_verified, false);
});

test('전용 매뉴얼 연결과 개별 인용 검증은 다르다', () => {
  const result = manualReferenceEvidence(ref({ title: '기초연금 사업안내', match: '제도명 일치', original: { ...original, basis: 'document', quote: null } }), '기초연금');
  assert.equal(result.link_type, 'A');
  assert.equal(result.link_confirmed, true);
  assert.equal(result.original_quote_verified, false);
  assert.equal(result.original_locator_status, 'DOCUMENT');
});

for (const page of [0, -1, 11, 1.5]) {
  test('잘못된 원본 쪽 위치를 미확인 처리한다: ' + page, () => {
    assert.equal(originalLocatorStatus({ ...original, page }), 'UNRESOLVED');
  });
}

test('추정 위치·미수록·OCR 발췌는 검증으로 표현하지 않는다', () => {
  assert.equal(originalLocatorStatus({ ...original, basis: 'context' }), 'APPROXIMATE');
  assert.equal(originalLocatorStatus(undefined), 'UNRESOLVED');
  assert.match(originalEvidenceNote({ ...original, ocr: true }), /OCR/);
  assert.doesNotMatch(originalEvidenceNote(original), /그대로 옮겼습니다/);
});

test('연결 요약은 구간 단위로 확정·후보·인용 검증을 구분한다', () => {
  const result = summarizeManualReferences([ref(), ref({ title: '기초연금 사업안내', match: '제도명 일치' })], '기초연금');
  assert.equal(result.total_reference_count, 2);
  assert.equal(result.confirmed_reference_count, 1);
  assert.equal(result.candidate_reference_count, 1);
  assert.equal(result.quote_verified_reference_count, 0);
});

test('수혜자의 현물·서비스와 제공기관 정산을 구분하고 원천 분류를 보존한다', () => {
  const source = ['현금지급'];
  assert.deepEqual(recipientProvisionOf('seogwipo-warm-store', source), ['현물지급', '프로그램/서비스']);
  assert.deepEqual(recipientProvisionOf('memorial-cemetery', source), ['프로그램/서비스']);
  assert.deepEqual(source, ['현금지급']);
  assert.deepEqual(recipientProvisionOf('basic-pension', source), source);
  assert.equal(provisionReviewFor('seogwipo-warm-store').effectivePeriodVerified, false);
  assert.equal(provisionReviewFor('__proto__'), null);
});

test('선정기준의 빈 필드를 자격조건 없음으로 해석하지 않는다', () => {
  assert.equal(selectionFieldStatus(null).status, 'SEPARATE_FIELD_NOT_STORED');
  assert.match(selectionFieldStatus('').note, /조건이 없다는 뜻은 아닙니다/);
  assert.equal(selectionFieldStatus('별도 기준').status, 'STORED_TEXT');
});

test('법령 오류는 편집 원본과 생성된 상세에 함께 수정되어 있다', async () => {
  const data = await json('public/data/welfare100/items/basic-pension.json');
  const canonical = await json('data/welfare100/records-01.json');
  const rec = (Array.isArray(canonical) ? canonical : Object.values(canonical)).find(row => row.s === 'basic-pension');
  assert.deepEqual(data.record.laws, rec.laws);
  assert.ok(rec.laws.some(([name, article, kind]) => name === '기초연금법 시행규칙' && article === '제2조(소득평가액 산정방식)' && kind === '부령'));
  assert.ok(!rec.laws.some(([name, article]) => name === '기초연금법 시행령' && article.includes('소득평가액')));
});

test('대장 5304건·중앙 482건·지자체 4822건 및 고유 ID를 보존한다', async () => {
  const index = await json('public/data/welfare100/index.json');
  assert.equal(index.items.length, 5304);
  assert.equal(new Set(index.items.map(row => row.s)).size, 5304);
  assert.equal(index.items.filter(row => row.g === 0).length, 482);
  assert.equal(index.items.filter(row => row.g === 1).length, 4822);
});

test('MCP 지역 조회는 40건과 공통 포함 571건을 구분한다', async () => {
  const local = await catalog.search(plan('', false), 'https://example.test', 0, 50);
  const combined = await catalog.search(plan(''), 'https://example.test', 0, 50);
  assert.equal(local.total_count, 40);
  assert.equal(combined.total_count, 571);
  assert.deepEqual(combined.scope_counts, { central: 482, provincial: 49, municipal: 40 });
});

test('MCP 한 글자 밥 검색도 목록 전체로 확대되지 않고 관련 식사 제도를 반환한다', async () => {
  const result = await catalog.search(plan('밥'), 'https://example.test', 0, 50);
  assert.ok(result.total_count > 0 && result.total_count < 571, JSON.stringify(result.scope_counts));
  for (const slug of ['jeju-value-care', 'seogwipo-warm-store']) {
    assert.ok(result.items.some(item => item.id === 'welfare100_service:' + slug), slug);
  }
  assert.ok(result.search_expansions.some(item => item.input === '밥'));
});

test('모르는 MCP 검색어는 빈 결과로 남는다', async () => {
  const result = await catalog.search(plan('없는제도XYZ123'), 'https://example.test', 0, 50);
  assert.equal(result.total_count, 0);
});

test('MCP와 웹은 동일한 연결 판정·요약 및 제공유형 함수를 사용한다', async () => {
  const data = await json('public/data/welfare100/items/basic-pension.json');
  const result = await catalog.detail('welfare100_service:basic-pension', 'https://example.test');
  assert.deepEqual(result.manual_link_summary, summarizeManualReferences(data.extra.talkRefs, data.meta.name));
  for (const [i, item] of result.manual_references.entries()) {
    const expected = manualReferenceEvidence(data.extra.talkRefs[i], data.meta.name);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(item[key], value);
  }
  const warm = await catalog.detail('welfare100_service:seogwipo-warm-store', 'https://example.test');
  assert.deepEqual(warm.recipient_provision, recipientProvisionOf('seogwipo-warm-store', warm.source_provision));
  assert.equal(warm.personal_determination, false);
});

test('상세 화면은 업무구조도를 먼저 표시하고 확신도 숫자·후보 숨김을 제거한다', async () => {
  const detail = await read('components/welfare100/InstitutionDetailView.tsx');
  assert.ok(detail.indexOf('<section id="process"') < detail.indexOf('<OnePageCanvas institution='));
  assert.ok(detail.includes('manualReferenceEvidence(ref, institution.name)'));
  assert.ok(!detail.includes('ref.curatedSource ? "편집 근거 매뉴얼"'));
  assert.ok(detail.includes('편집자 해설'));
  for (const file of ['ProcessExplorer.tsx', 'SwimlaneBoard.tsx']) assert.ok(!(await read('components/welfare100/' + file)).includes('확신도'));
  const status = await read('components/data-status-strip.tsx');
  assert.ok(status.includes('최신성 검증을 뜻하지 않습니다'));
});
