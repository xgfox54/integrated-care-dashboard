import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { enforceApiRateLimit } from './api-rate-limit.ts';

function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec('CREATE TABLE api_rate_limit (bucket_key TEXT PRIMARY KEY, request_count INTEGER, expires_at INTEGER)');
  let writes = 0;
  const connection = () => ({ prepare(sql) { return { bind(...values) { return { async first() {
    writes += 1;
    return sqlite.prepare(sql).get(...values);
  } }; } }; } });
  return { connection, writes: () => writes };
}
const request = (path = '/api/budget', ip = '203.0.113.42') => new Request('https://example.test' + path, {
  headers: { 'cf-connecting-ip': ip, 'x-reserve-calls': '1000' },
});

test('budget reservations admit at most 120 concurrent calls across independent database bindings', async t => {
  // Given: three instance-local reservations sharing the same atomic SQL counters.
  const fixture = database(t);
  const connections = Array.from({ length: 3 }, fixture.connection);
  // When: each instance receives 50 calls in the same window.
  const responses = await Promise.all(Array.from({ length: 150 }, (_, i) =>
    enforceApiRateLimit(request(), connections[i % 3], 600, { reserveCalls: 5 })));
  // Then: 120 permits are admitted with 24 successful and three rejected writes.
  assert.equal(responses.filter(value => value === null).length, 120);
  assert.equal(responses.filter(value => value?.status === 429).length, 30);
  assert.equal(fixture.writes(), 27);
});

test('budget reservations expire at the next window and remain scoped to their database', async t => {
  // Given: exhausted capacity in one database and an independent database.
  const fixture = database(t), independent = database(t);
  const db = fixture.connection();
  await Promise.all(Array.from({ length: 125 }, () => enforceApiRateLimit(request(), db, 600, { reserveCalls: 5 })));
  // When: requests enter another database or the next window.
  const results = await Promise.all([
    enforceApiRateLimit(request(), independent.connection(), 600, { reserveCalls: 5 }),
    enforceApiRateLimit(request(), db, 660, { reserveCalls: 5 }),
  ]);
  // Then: neither request inherits an exhausted reservation.
  assert.deepEqual(results, [null, null]);
});

test('budget reservation failures admit no unreserved requests and can retry', async t => {
  // Given: a database which fails its first reservation.
  const fixture = database(t), working = fixture.connection();
  let failing = true;
  const db = { prepare(sql) { if (failing) throw new Error('DB_DOWN'); return working.prepare(sql); } };
  // When: admission is attempted before and after recovery.
  const failed = await enforceApiRateLimit(request(), db, 600, { reserveCalls: 5 });
  failing = false;
  const recovered = await enforceApiRateLimit(request(), db, 600, { reserveCalls: 5 });
  // Then: failure is closed and recovery requires an atomic reservation.
  assert.equal(failed.status, 503);
  assert.equal(recovered, null);
  assert.equal(fixture.writes(), 1);
});

test('budget request headers cannot enable reservations and non-budget policies retain per-call counting', async t => {
  // Given: caller-controlled headers and a different API policy.
  const fixture = database(t), db = fixture.connection();
  // When: calls omit server reservation options or target another policy.
  await Promise.all(Array.from({ length: 5 }, () => enforceApiRateLimit(request(), db, 600)));
  await Promise.all(Array.from({ length: 5 }, () => enforceApiRateLimit(request('/api/dataset'), db, 600, { reserveCalls: 5 })));
  // Then: each call still reaches the authoritative counter.
  assert.equal(fixture.writes(), 10);
});
