import assert from 'node:assert/strict';
import test from 'node:test';
import { enforceApiRateLimit, mcpToolCallWeight } from './api-rate-limit.ts';
import { mcpRequestError } from './mcp/request-guard.ts';

function countingDb() {
  const counts = new Map();
  return { counts, prepare: () => ({ bind: (key, add) => ({ first: async () => {
    const count = (counts.get(key) ?? 0) + add;
    counts.set(key, count);
    return { request_count: count };
  } }) }) };
}
const post = (path = '/chatgpt/mcp', ip = '203.0.113.1', method = 'initialize') => new Request('https://fixture.test' + path, {
  method: 'POST', headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {} }),
});
const ingress = { transport: true, reserveCalls: 5 };

test('initialization and listing share an HTTP ceiling across MCP paths and aliases', async () => {
  const db = countingDb();
  const paths = ['/chatgpt/mcp', '/claude/mcp', '/chatgpt//mcp', '/claude/mcp.rsc'];
  for (let i = 0; i < 600; i++) {
    const request = post(paths[i % paths.length], undefined, i % 2 ? 'tools/list' : 'initialize');
    assert.equal(await enforceApiRateLimit(request, db, 60, ingress), null);
    assert.equal(await mcpToolCallWeight(request), 0);
  }
  const rejected = await enforceApiRateLimit(post(), db, 60, ingress);
  assert.equal(rejected.status, 429);
  assert.equal(rejected.headers.get('retry-after'), '60');
  assert.equal(rejected.headers.get('cache-control'), 'no-store');
  assert([...db.counts.keys()].every(k => k.startsWith('mcp-transport:')));
  assert.equal(await enforceApiRateLimit(post(), db, 120, ingress), null);
});

test('transport global ceiling spans clients and missing storage fails closed', async () => {
  const db = countingDb();
  for (let ip = 1; ip <= 3; ip++) {
    for (let i = 0; i < 600; i++) assert.equal(await enforceApiRateLimit(post('/chatgpt/mcp', '203.0.113.' + ip), db, 60, ingress), null);
  }
  assert.equal((await enforceApiRateLimit(post('/claude/mcp', '203.0.113.4'), db, 60, ingress)).status, 429);
  assert.equal((await enforceApiRateLimit(post(), undefined, 60, ingress)).status, 503);
});

test('ordinary handshake and tool sequences retain independent weighted tool quotas', async () => {
  const db = countingDb();
  for (const method of ['initialize', 'notifications/initialized', 'tools/list']) {
    const request = post(undefined, undefined, method);
    assert.equal(mcpRequestError(request), null);
    assert.equal(await enforceApiRateLimit(request, db, 60, ingress), null);
    assert.equal(await enforceApiRateLimit(request, db, 60, { weight: await mcpToolCallWeight(request) }), null);
  }
  assert([...db.counts.keys()].every(k => k.startsWith('mcp-transport:')));
  for (let i = 0; i < 120; i++) {
    const request = post(undefined, undefined, 'tools/call');
    assert.equal(await enforceApiRateLimit(request, db, 60, ingress), null);
    assert.equal(await enforceApiRateLimit(request, db, 60, { weight: await mcpToolCallWeight(request), reserveCalls: 5 }), null);
  }
  assert.equal((await enforceApiRateLimit(post(), db, 60, { weight: 1, reserveCalls: 5 })).status, 429);
});

test('rejected MCP headers leave hostile body streams unread', () => {
  for (const headers of [{ origin: 'https://foreign.invalid', 'content-type': 'application/json' }, { 'content-type': 'text/plain' }]) {
    let reads = 0;
    const body = new ReadableStream({ pull() { reads++; } }, { highWaterMark: 0 });
    const request = new Request('https://fixture.test/chatgpt/mcp', { method: 'POST', headers, body, duplex: 'half' });
    assert([403, 415].includes(mcpRequestError(request).status));
    assert.equal(reads, 0);
    assert.equal(request.bodyUsed, false);
  }
});
