import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { database } from './press-test-support.mjs';
import { McpData } from './mcp/data.ts';
import { handleMcpRequest } from './mcp/server.ts';
import { PUBLIC_MCP_TOOL_NAMES } from './mcp/contract.ts';

const assets = { async fetch(request) {
  const path = new URL(request.url).pathname;
  assert.match(path, /^\/data\/welfare100\/(index-lite\.json|items\/[A-Za-z0-9_-]+\.json)$/);
  try { return new Response(await readFile(new URL('../public' + path, import.meta.url))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return new Response('', { status: 404 }); }
} };

async function rpc(db, method, params, options = {}) {
  const response = await handleMcpRequest(new Request('https://dashboard.example/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }), new McpData(db, async () => new Map()), error => { throw error; }, { welfareAssets: assets, ...options });
  assert.equal(response.status, 200);
  return (await response.json()).result;
}
const call = (db, name, args, options) => rpc(db, 'tools/call', { name, arguments: args }, options);

test('response parity and trace parity include the same resolved FAQ identity', async t => {
  const db = database();
  t.after(() => db.sqlite.close());
  const row = db.sqlite.prepare('SELECT faq_id, question FROM faq_129 ORDER BY faq_id LIMIT 1').get();
  const observations = [];
  const result = await call(db, 'fetch', { id: 'faq129:' + row.faq_id }, { observeTool: observation => observations.push(observation) });
  const payload = result.structuredContent;
  assert.deepEqual(JSON.parse(result.content[0].text), payload);
  assert.deepEqual(JSON.parse(JSON.stringify(observations[0].response)), payload);
  assert.equal(payload.source_identity.canonical_id, 'faq129:' + row.faq_id);
  assert.equal(payload.source_identity.revision, payload.metadata.faq_revision);
  assert.equal(payload.title, row.question);
});

test('old FAQ IDs roundtrip across search, get_faq and fetch with conditions intact', async t => {
  const db = database();
  t.after(() => db.sqlite.close());
  const source = db.sqlite.prepare('SELECT faq_id, question, answer, written_date FROM faq_129 ORDER BY faq_id LIMIT 1').get();
  const found = (await call(db, 'search_faq', { query: source.question, limit: 5 })).structuredContent.results;
  const id = 'faq129:' + source.faq_id;
  assert.equal(found[0].id, id);
  assert.equal(found[0].source_identity.canonical_id, id);
  const detail = (await call(db, 'get_faq', { id })).structuredContent;
  const fetched = (await call(db, 'fetch', { id })).structuredContent;
  assert.equal(detail.answer, source.answer);
  assert.equal(detail.written_date, source.written_date);
  assert.equal(fetched.source_identity.canonical_id, detail.source_identity.canonical_id);
  assert.deepEqual(fetched.metadata.structured_conditions, detail.structured_conditions);
  assert.deepEqual(fetched.metadata.condition_checklist, detail.condition_checklist);
});

test('source families preserve regional welfare locators and website evidence', async t => {
  const db = database();
  t.after(() => db.sqlite.close());
  const id = 'welfare100_service:seogwipo-warm-store';
  const result = (await call(db, 'search', { query: '서귀포시 서귀포 온정가게' })).structuredContent.results[0];
  const detail = (await call(db, 'fetch', { id })).structuredContent;
  const entity = (await call(db, 'get_entity', { entity_id: id })).structuredContent.data;
  assert.equal(result.id, id);
  assert.equal(detail.id, id);
  assert.equal(entity.id, id);
  assert.equal(detail.source_identity.canonical_id, id);
  assert.equal(entity.source_identity.revision, entity.revision);
  assert.equal(result.region_id, 'region:제주특별자치도|서귀포시');
  assert.equal(detail.url, entity.url);
});

test('statistics separation keeps catalog links distinct and unavailable datasets null', async t => {
  const db = database();
  t.after(() => db.sqlite.close());
  const payload = (await call(db, 'search_statistics', { kind: 'portal', limit: 100 })).structuredContent.data;
  assert.ok(payload.items.length);
  for (const row of payload.items) {
    assert.equal(row.source_identity.canonical_id, row.id);
    assert.equal(row.source_identity.catalog_id, row.id);
    assert.equal(row.source_identity.dataset_id, row.dataset_id);
    assert.equal(row.data_available, false);
  }
});

test('gated tools and errors retain existing read boundaries', async t => {
  const db = database();
  t.after(() => db.sqlite.close());
  const listed = (await rpc(db, 'tools/list', {})).tools;
  assert.deepEqual(listed.map(row => row.name).sort(), [...PUBLIC_MCP_TOOL_NAMES].sort());
  assert.equal(listed.some(row => row.name === 'legal_analysis'), false);
  for (const row of listed) {
    assert.equal(row.annotations.readOnlyHint, true);
    assert.equal(row.annotations.destructiveHint, false);
    assert.equal('rankingMode' in row.inputSchema.properties, false);
  }
  const error = await call(db, 'fetch', { id: 'https://example.com' });
  assert.equal(error.isError, true);
  assert.equal(error.structuredContent.error.code, 'ID_IS_URL');
  assert.equal('source_identity' in error.structuredContent, false);
});

test('dataset policies disclose baseline ranking and unmeasured generated answers', async t => {
  const db = database();
  t.after(() => db.sqlite.close());
  const payload = (await call(db, 'get_dataset_status', {})).structuredContent.data;
  assert.equal(payload.identity_policy.unknown_revision, null);
  assert.equal(payload.search_policy.production_ranking, 'baseline');
  assert.equal(payload.search_policy.public_override, false);
  assert.equal(payload.quality_policy.generated_answer_accuracy, 'NOT_EVALUATED');
});
