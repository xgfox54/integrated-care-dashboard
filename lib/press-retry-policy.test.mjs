import assert from 'node:assert/strict';
import test from 'node:test';
import { collectionFixture, response } from './press-test-support.mjs';
import { retryAfterSeconds, retryDelaySeconds } from './press/retry-policy.ts';

test('503 Retry-After를 정수와 HTTP-date 모두 다음 시도 하한으로 보존한다', async () => {
  for (const kind of ['seconds', 'date']) {
    // Given: upstream requests a 12-hour pause, beyond the local backoff cap.
    const { db, ctx, calls, run } = await collectionFixture([]);
    const wait = 12 * 3600;
    const header = kind === 'seconds' ? String(wait) : new Date((ctx.clock.now + wait) * 1000).toUTCString();
    ctx.next = () => response(503, '', { 'retry-after': header });
    // When: one logical collection attempt receives that response.
    const result = await run();
    // Then: no immediate retry or early next attempt is permitted.
    assert.equal(result.errorCode, 'SERVER_ERROR');
    assert.equal(calls.length, 1, 'Retry-After 동안 같은 호출에서 재요청하면 안 된다');
    const state = db.sqlite.prepare('SELECT next_due_at FROM press_crawl_state').get();
    assert.ok(state.next_due_at >= ctx.clock.now + wait);
  }
});

test('재시도는 지수 간격과 지터를 적용하고 자체 상한과 원천 대기 시간을 구별한다', () => {
  const policy = { nowSeconds: 1_000, retryAfterSeconds: 0, random: () => 0 };
  assert.equal(retryDelaySeconds({ ...policy, failures: 1 }), 1800);
  assert.equal(retryDelaySeconds({ ...policy, failures: 2 }), 3600);
  assert.equal(retryDelaySeconds({ ...policy, failures: 10 }), 21600);
  assert.equal(retryDelaySeconds({ ...policy, failures: 1, random: () => 0.5 }), 1980);
  assert.equal(retryDelaySeconds({ ...policy, failures: 2, retryAfterSeconds: 43200 }), 43200);
  assert.equal(retryAfterSeconds('-2', policy.nowSeconds), 0);
  assert.equal(retryAfterSeconds('invalid', policy.nowSeconds), 0);
  assert.equal(retryAfterSeconds('0', policy.nowSeconds), 0);
});
