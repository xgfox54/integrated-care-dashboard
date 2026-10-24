import assert from 'node:assert/strict';
import test from 'node:test';
import { collectionFixture, response, SOURCE_ID, NOW } from './press-test-support.mjs';
import { closeDuePressJobs, ensurePressSlots, readPressSlotStatus } from './press/jobs.ts';
import { previousCollectionSlot, nextCollectionSlot } from './press/schedule.ts';

async function failedJob(count = 1) {
  const fixture = await collectionFixture([]);
  fixture.ctx.next = () => response(429);
  await fixture.run();
  for (let index = 1; index < count; index++) {
    fixture.db.sqlite.prepare("INSERT INTO press_job_attempt (run_id, source_id, slot_at, lease_token, host, started_at, finished_at, status, error_code) SELECT ?, source_id, slot_at, lease_token, host, started_at, finished_at, status, error_code FROM press_job_attempt LIMIT 1").run(`previous-${index}`);
  }
  fixture.ctx.clock.now = fixture.db.sqlite.prepare('SELECT next_due_at FROM press_crawl_state WHERE source_id = ?').get(SOURCE_ID).next_due_at;
  return fixture;
}

const job = (db) => ({...db.sqlite.prepare('SELECT status, retryable, closed_at, close_reason FROM press_slot_job ORDER BY slot_at LIMIT 1').get()});

test('eighth failed attempt closes only after retry due, preserving failure history', async () => {
  const { db, ctx } = await failedJob(8);
  await closeDuePressJobs(db, ctx.clock.now);
  assert.deepEqual(job(db), {status:'failed', retryable:0, closed_at:ctx.clock.now, close_reason:'ATTEMPT_LIMIT_REACHED'});
  const status = await readPressSlotStatus(db, previousCollectionSlot(NOW), ctx.clock.now);
  assert.equal(status.combined.failed, 1);
  assert.equal(status.combined.completion, 'ERRORS_REMAIN');
});

test('24-hour deadline closes attempted job and leaves never-attempted catch-up eligible', async () => {
  const { db } = await failedJob();
  await ensurePressSlots(db, NOW + 86400);
  assert.equal(job(db).close_reason, 'RETRY_DEADLINE_REACHED');
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM press_slot_job WHERE attempt_id IS NULL AND retryable = 1 AND closed_at IS NULL").get().n, 4);
});

test('Retry-After floor postpones closure beyond the deadline', async () => {
  const { db } = await failedJob(8);
  db.sqlite.prepare('UPDATE press_crawl_state SET next_due_at = ?').run(NOW + 172800);
  db.sqlite.prepare('UPDATE press_slot_job SET next_retry_at = ?').run(NOW + 172800);
  await closeDuePressJobs(db, NOW + 86400);
  assert.equal(job(db).closed_at, null);
  assert.equal(job(db).retryable, 1);
});

test('manual hold stays open until the operator clears it', async () => {
  const { db } = await failedJob(8);
  db.sqlite.prepare("UPDATE press_crawl_state SET collection_hold = 'MANUAL_REVIEW', hold_until = NULL").run();
  db.sqlite.prepare("UPDATE press_slot_job SET status = 'held'").run();
  await closeDuePressJobs(db, NOW + 86400);
  assert.equal(job(db).closed_at, null);
  assert.equal(job(db).status, 'held');
});

test('live source lease prevents closure even at the attempt limit', async () => {
  const { db, ctx } = await failedJob(8);
  db.sqlite.prepare("UPDATE press_crawl_state SET lease_token = 'live-worker', lease_expires_at = ?").run(ctx.clock.now + 120);
  await closeDuePressJobs(db, ctx.clock.now);
  assert.equal(job(db).closed_at, null);
});

test('closed oldest job does not block the source next slot attempt', async () => {
  const { db, ctx, run } = await failedJob(8);
  await closeDuePressJobs(db, ctx.clock.now);
  ctx.clock.now = nextCollectionSlot(NOW);
  ctx.next = () => response(304);
  await run();
  const rows = db.sqlite.prepare('SELECT slot_at, status, retryable FROM press_slot_job ORDER BY slot_at').all();
  assert.deepEqual(rows.map(row=>({...row})), [
    {slot_at:previousCollectionSlot(NOW),status:'failed',retryable:0},
    {slot_at:nextCollectionSlot(NOW),status:'succeeded',retryable:0},
  ]);
});
