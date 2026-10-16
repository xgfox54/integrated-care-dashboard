import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { database } from './press-test-support.mjs';
import { McpData } from './mcp/data.ts';
import { WelfareCatalog } from './mcp/welfare-catalog.ts';
import { refineWelfareQuery } from './mcp/query-refiner.ts';
import { handleMcpRequest } from './mcp/server.ts';

const assets = { async fetch(request) {
  const path = new URL(request.url).pathname;
  assert.match(path, /^\/data\/welfare100\/(index-lite\.json|items\/[A-Za-z0-9_-]+\.json)$/);
  try { return new Response(await readFile(new URL('../public' + path, import.meta.url)), { headers: { 'content-type': 'application/json' } }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return new Response('', { status: 404 }); }
} };
const index = JSON.parse(await readFile(new URL('../public/data/welfare100/index-lite.json', import.meta.url), 'utf8'));
const catalog = index.items.map(values => Object.fromEntries(index.fields.map((field, i) => [field, values[i]])));
const local = catalog.filter(row => row.sd === '제주특별자치도' && row.sg === '서귀포시');

test('public MCP keeps 밥 as a search term and retrieves meal programs through both tools', async (t) => {
  // Given: the real stored catalog and public JSON-RPC handler.
  const db = database();
  t.after(() => db.sqlite.close());
  assert.deepEqual(refineWelfareQuery('밥').search_tokens, ['밥']);
  // When: the public integrated search receives the one-character query.
  const result = await call(db, 'search', { query: '밥' });
  // Then: catalog meal programs survive the public routing and fusion path.
  assert.notEqual(result.retrieval_status, 'NO_USABLE_SEARCH_TERMS');
  assert.ok(result.results.some(row => row.entity_type === 'welfare100_service'));
});

test('public catalog meal retrieval preserves exclusions, OR, wildcard and pagination', async (t) => {
  // Given: a region with 571 entries including ancestors.
  const db = database();
  t.after(() => db.sqlite.close());
  const scope = { region_id: 'region:제주특별자치도|서귀포시', include_ancestor_scope: true, limit: 50 };
  // When: related words and explicit operators reach the catalog tool.
  const meal = await call(db, 'search_welfare_services', { ...scope, query: '밥' });
  const excluded = await call(db, 'search_welfare_services', { ...scope, query: '밥 -도시락' });
  const either = await call(db, 'search_welfare_services', { ...scope, query: '식사|급식' });
  const wildcard = await call(db, 'search_welfare_services', { ...scope, query: '식사*지원' });
  const page = await call(db, 'search_welfare_services', { ...scope, query: '밥', offset: 1, limit: 1 });
  // Then: retrieval is bounded, operators constrain it, and paging is stable.
  assert.ok(meal.total_count > 0 && meal.total_count < 571);
  assert.ok(meal.items.some(row => row.id === 'welfare100_service:seogwipo-warm-store'));
  assert.ok(excluded.total_count < meal.total_count);
  assert.ok(either.total_count > 0);
  assert.ok(wildcard.total_count > 0);
  assert.equal(page.total_count, meal.total_count);
  assert.equal(page.items[0].id, meal.items[1].id);
});

async function call(db, name, args) {
  const response = await handleMcpRequest(new Request('https://dashboard.example/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }), new McpData(db, async () => new Map()), error => { throw error; }, { welfareAssets: assets });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.result && !body.result.isError, JSON.stringify(body));
  return body.result.structuredContent;
}

test('서귀포시 지역만 또는 복지사업 목록을 요청하면 웹 대장의 지역 사업을 우선 반환한다', async () => {
  const db = database();
  for (const query of ['서귀포시', '서귀포시 복지사업', '서귀포시 복지제도', '서귀포시 복지사업 조회', '제주 서귀포시 복지사업 목록', '제주-서귀포시 복지 사업을 검색해줘']) {
    const result = await call(db, 'search', { query });
    assert.equal(result.query_plan.region_id, 'region:제주특별자치도|서귀포시');
    assert.equal(result.retrieval_status, 'CANDIDATES_FOUND', query);
    assert.equal(result.results[0].entity_type, 'welfare100_service', query);
    assert.equal(result.results[0].region_id, 'region:제주특별자치도|서귀포시', query);
    assert.equal(result.welfare_catalog.local_count, 40);
    assert.ok(result.results.every(row => row.region_id !== 'region:제주특별자치도|제주시'));
  }
  db.sqlite.close();
});

test('지역 전용 페이지 조회는 웹의 서귀포시 40건을 중복·누락 없이 반환하고 상위 지역 범위도 구분한다', async () => {
  const db = database();
  const ids = [];
  for (let offset = 0; offset < local.length; offset += 17) {
    const page = await call(db, 'search_welfare_services', { region_id: 'region:제주특별자치도|서귀포시', include_ancestor_scope: false, offset, limit: 17 });
    assert.equal(page.total_count, local.length);
    assert.equal(page.local_count, local.length);
    assert.equal(page.as_of, index.asOf);
    ids.push(...page.items.map(row => row.id));
  }
  assert.equal(new Set(ids).size, 40);
  assert.deepEqual(ids.sort(), local.map(row => 'welfare100_service:' + row.s).sort());
  const combined = await call(db, 'search_welfare_services', { region_id: 'region:제주특별자치도|서귀포시', include_ancestor_scope: true, limit: 50 });
  assert.equal(combined.total_count, 571);
  assert.ok(combined.items.slice(0, 40).every(row => row.region_id === 'region:제주특별자치도|서귀포시'));
  assert.equal(combined.next_offset, 50);
  db.sqlite.close();
});

test('특정 사업명과 모르는 검색어를 일반 지역 목록으로 넓히지 않는다', async () => {
  const db = database();
  const specific = await call(db, 'search', { query: '서귀포시 서귀포 온정가게' });
  assert.equal(specific.results[0].id, 'welfare100_service:seogwipo-warm-store');
  const unknown = await call(db, 'search', { query: '서귀포시 없는제도XYZ123' });
  assert.ok(!unknown.results.some(row => row.entity_type === 'welfare100_service'));
  const applicationStatus = await call(db, 'search', { query: '서귀포시 신청 결과 조회' });
  assert.equal(applicationStatus.retrieval_status, 'NO_USABLE_SEARCH_TERMS');
  db.sqlite.close();
});

test('편집형·복지로형 상세는 같은 웹 원필드와 출처를 반환하고 기준일을 적용연도로 단정하지 않는다', async () => {
  const db = database();
  for (const slug of ['seogwipo-warm-store', 'WLF00005350']) {
    const payload = JSON.parse(await readFile(new URL('../public/data/welfare100/items/' + slug + '.json', import.meta.url), 'utf8'));
    const id = 'welfare100_service:' + slug;
    const fetched = await call(db, 'fetch', { id });
    const expectedBenefit = payload.kind === 'auto' ? payload.raw.benefit : payload.record.benefit;
    assert.ok(fetched.text.includes(expectedBenefit));
    assert.equal(fetched.metadata.entity_type, 'welfare100_service');
    assert.equal(fetched.metadata.as_of, index.asOf);
    assert.equal(fetched.metadata.personal_determination, false);
    assert.match(fetched.text, /본문에 없는 조건은 미확인/);
    assert.match(fetched.text, /지급일을 신청마감일로/);
    const context = await call(db, 'get_welfare_context', { implementation_id: id, question: '2026년 서귀포시 지원 내용' });
    assert.equal(context.data.program.entity_type, 'welfare100_service');
    assert.equal(context.data.benefit, expectedBenefit);
    assert.equal(context.data.fiscal.status, 'UNLINKED');
    assert.ok(context.evidence.length);
    const entity = await call(db, 'get_entity', { entity_id: id });
    assert.equal(entity.data.benefit, expectedBenefit);
    const eligibility = await call(db, 'get_eligibility', { implementation_id: id });
    assert.equal(eligibility.data.application_conditions, payload.kind === 'auto' ? payload.raw.target : payload.record.target);
    assert.equal(eligibility.data.application_method, payload.kind === 'auto' ? payload.raw.applyText : payload.record.apply);
    const sources = await call(db, 'get_sources', { subject_type: 'welfare100_service', subject_id: id });
    assert.ok(sources.data.length);
  }
  db.sqlite.close();
});

test('정확한 지역 사업명은 일반 제도 별칭보다 우선하며 같은 이름의 군은 고유할 때만 추론한다', async (t) => {
  const db = database();
  t.after(() => db.sqlite.close());
  const query = '순창군 저소득층 건강보험료및 장기요양보험료 지원사업';
  const result = await call(db, 'search_welfare_services', { query, limit: 10 });
  assert.equal(result.items[0].name, query);
  assert.equal(result.items[0].region_id, 'region:전북특별자치도|순창군');
  assert.ok(result.items.every(row => row.region_id === 'region:전북특별자치도|순창군' || row.region_id === 'region:전국'));
  const explicit = await call(db, 'search_welfare_services', { query, region_id: 'region:제주특별자치도|서귀포시', include_ancestor_scope: false });
  assert.ok(explicit.items.every(row => row.region_id === 'region:제주특별자치도|서귀포시'));
});

test('동명 시군은 광역이 없으면 한 지역으로 결정하지 않고 명시한 제외 제도를 유지한다', async () => {
  const source = new WelfareCatalog(assets);
  const ambiguous = await source.search(refineWelfareQuery('고성군 복지사업'), 'https://dashboard.example');
  assert.equal(ambiguous.resolved_region_id, null);
  const excluded = await source.search(refineWelfareQuery('기초연금 제외하고 지원사업'), 'https://dashboard.example', 0, 50);
  assert.ok(excluded.items.every(row => row.name !== '기초연금'));
});
