import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

globalThis.visitLeaseEvidence = { starts: 0, errors: 0 };
const modules = {
  './api-rate-limit': 'export const mcpRecentlyActive=async()=>true;',
  './errors': 'export const logServerError=()=>{globalThis.visitLeaseEvidence.errors++};',
  './official-sync-status': 'export const advanceOfficialSyncInBackground=async()=>{};',
  './press/background': 'export const advancePressInBackground=async()=>{};',
  './platform/flags': 'export const flagEnabled=()=>false;',
  './press/link-corrections': 'export const applyVerifiedPressLinkCorrections=async()=>{globalThis.visitLeaseEvidence.starts++};',
  './press/title-exclusions': 'export const withdrawExcludedPressItems=async()=>{};',
  './classification-backfill': 'export const applyReviewedClassifications=async()=>{};',
  './reviewed-wiki-edits': 'export const applyReviewedWikiEdits=async()=>{};',
  './manuals/background': 'export const advanceBundledManuals=async()=>{};',
};
const hook = registerHooks({ resolve(specifier, context, next) {
  if (Object.hasOwn(modules, specifier)) return { url: 'data:text/javascript,' + encodeURIComponent(modules[specifier]), shortCircuit: true };
  return next(specifier, context);
} });
const { advanceVisitInBackground } = await import('./visit-background.ts');
after(() => { hook.deregister(); delete globalThis.visitLeaseEvidence; });
function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE app_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  t.after(() => sqlite.close());
  let writes = 0;
  return { writes: () => writes, connection: () => ({ prepare(sql) { return { bind(...args) { return { async first() {
    writes++;
    return sqlite.prepare(sql).get(...args) ?? null;
  } }; } }; } }) };
}

test('concurrent visits across bindings start only one global chain per minute', async t => {
  // Given: separate local binding identities sharing the real SQL table.
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  globalThis.visitLeaseEvidence.starts = 0;
  const fixture = database(t);
  const bindings = Array.from({ length: 10 }, fixture.connection);
  // When: each binding receives concurrent visits.
  await Promise.all(bindings.flatMap(DB => Array.from({ length: 10 }, () => advanceVisitInBackground({ DB }))));
  // Then: one chain runs and local suppression limits gate writes to ten.
  assert.equal(globalThis.visitLeaseEvidence.starts, 1);
  assert.equal(fixture.writes(), 10);
});

test('global visit throttle admits again at expiry but blocks new bindings before expiry', async t => {
  // Given: an already claimed minute.
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  globalThis.visitLeaseEvidence.starts = 0;
  const fixture = database(t);
  await advanceVisitInBackground({ DB: fixture.connection() });
  // When: new bindings visit immediately before and at expiry.
  t.mock.timers.tick(59_000);
  await advanceVisitInBackground({ DB: fixture.connection() });
  const beforeExpiry = globalThis.visitLeaseEvidence.starts;
  t.mock.timers.tick(1_000);
  await advanceVisitInBackground({ DB: fixture.connection() });
  // Then: only the expiry visit starts another chain.
  assert.equal(beforeExpiry, 1);
  assert.equal(globalThis.visitLeaseEvidence.starts, 2);
});

test('failed global admission starts no collectors and retries after local cooldown', async t => {
  // Given: D1 rejects the gate operation.
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  Object.assign(globalThis.visitLeaseEvidence, { starts: 0, errors: 0 });
  let calls = 0;
  const DB = { prepare() { calls++; throw new Error('D1_OVERLOADED'); } };
  // When: concurrent visits and one later visit attempt background admission.
  await Promise.all(Array.from({ length: 10 }, () => advanceVisitInBackground({ DB })));
  assert.equal(calls, 1);
  t.mock.timers.tick(60_000);
  await advanceVisitInBackground({ DB });
  // Then: no collector executes; one gate attempt and error per minute.
  assert.equal(calls, 2);
  assert.equal(globalThis.visitLeaseEvidence.starts, 0);
  assert.equal(globalThis.visitLeaseEvidence.errors, 2);
});
