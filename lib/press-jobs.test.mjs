import assert from 'node:assert/strict';
import test from 'node:test';
import { collectionFixture, response, feedXml, url, SOURCE_ID, NOW } from './press-test-support.mjs';
import { ensurePressSlots, readPressSlotStatus } from './press/jobs.ts';
import { previousCollectionSlot, nextCollectionSlot } from './press/schedule.ts';
import { collectPressSource } from './press/collect.ts';
import { startPressAttempt } from './press/jobs.ts';
import { claimCrawlLease, claimHostLease } from './press/store.ts';
import { fencePressWrites } from './press/jobs-fence.ts';

const feed = [{ title: '통합돌봄 안내', link: url(917) }];

test('collector persists start-slot attribution across a schedule boundary', async () => {
  const { db, ctx, run } = await collectionFixture(feed);
  const boundary = nextCollectionSlot(NOW);
  ctx.clock.now = boundary - 1;
  ctx.next = () => { ctx.clock.now = boundary + 1; return response(200, feedXml(feed)); };
  await run();
  const attempts = db.sqlite.prepare('SELECT slot_at, status FROM press_job_attempt').all();
  assert.deepEqual(attempts.map(row => ({...row})), [{ slot_at: previousCollectionSlot(boundary - 1), status: 'succeeded' }]);
  assert.equal(db.sqlite.prepare('SELECT next_due_at FROM press_crawl_state WHERE source_id = ?').get(SOURCE_ID).next_due_at, boundary);
});

test('expired worker cannot publish articles or a successful run', async () => {
  const { db, ctx, run } = await collectionFixture(feed);
  ctx.next = () => { ctx.clock.now += 121; return response(200, feedXml(feed)); };
  const result = await run();
  assert.equal(result.errorCode, 'LEASE_EXPIRED');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM press_item').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM press_collection_run').get().n, 0);
});

test('duplicate scheduled trigger does not execute a completed slot again', async () => {
  const { db, ctx, source, calls } = await collectionFixture(feed);
  await collectPressSource(db, { source, trigger: 'scheduled' }, ctx.deps);
  ctx.clock.now += 10;
  await collectPressSource(db, { source, trigger: 'scheduled' }, ctx.deps);
  assert.equal(calls.length, 1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM press_job_attempt').get().n, 1);
});

test('slot targets remain frozen after approval changes and repeated capture', async () => {
  const { db } = await collectionFixture(feed);
  await ensurePressSlots(db, NOW);
  db.sqlite.prepare('UPDATE press_source SET enabled = 0 WHERE source_id = ?').run(SOURCE_ID);
  await ensurePressSlots(db, NOW + 1);
  const status = await readPressSlotStatus(db, previousCollectionSlot(NOW), NOW + 1);
  assert.equal(status.combined.sources, 1);
  assert.equal(status.combined.held, 1);
  assert.equal(status.combined.completion, 'ERRORS_REMAIN');
});

test('crashed attempt is recovered after lease expiry and retried in the same slot', async () => {
  const { db, ctx, source, run } = await collectionFixture(feed);
  await ensurePressSlots(db, NOW);
  const host = new URL(source.endpointUrl).hostname;
  await claimCrawlLease(db, SOURCE_ID, 'crashed-token', NOW);
  await claimHostLease(db, host, 'crashed-token', NOW);
  const lease = { sourceId: SOURCE_ID, host, token: 'crashed-token', now: ctx.deps.now };
  await startPressAttempt(fencePressWrites(db, lease), lease, 'crashed-run');
  ctx.clock.now += 121;
  await run();
  const attempts = db.sqlite.prepare('SELECT status, slot_at FROM press_job_attempt ORDER BY started_at').all();
  assert.deepEqual(attempts.map(row => ({...row})), [
    { status: 'abandoned', slot_at: previousCollectionSlot(NOW) },
    { status: 'succeeded', slot_at: previousCollectionSlot(NOW) },
  ]);
});

test('replaced lease prevents old worker changing replacement state or articles', async () => {
  const { db, ctx, run } = await collectionFixture(feed);
  ctx.next = () => {
    db.sqlite.prepare("UPDATE press_crawl_state SET lease_token = 'replacement', safe_error = 'NEW_WORKER', consecutive_failures = 7 WHERE source_id = ?").run(SOURCE_ID);
    return response(200, feedXml(feed));
  };
  const result = await run();
  assert.equal(result.errorCode, 'LEASE_EXPIRED');
  assert.deepEqual({...db.sqlite.prepare('SELECT lease_token, safe_error, consecutive_failures FROM press_crawl_state WHERE source_id = ?').get(SOURCE_ID)}, { lease_token: 'replacement', safe_error: 'NEW_WORKER', consecutive_failures: 7 });
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM press_item').get().n, 0);
});

test('catch-up has a persistent bound and resumes without dropping slots', async () => {
  const { db } = await collectionFixture(feed);
  db.sqlite.exec('PRAGMA foreign_keys = ON');
  await ensurePressSlots(db, NOW);
  const later = NOW + 10 * 86400;
  await ensurePressSlots(db, later);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM press_slot').get().n, 33);
  await ensurePressSlots(db, later);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM press_slot').get().n, 41);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM press_slot_job').get().n, 41);
  assert.equal((await readPressSlotStatus(db, previousCollectionSlot(later), later)).combined.succeeded, 0);
});
