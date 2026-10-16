import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test, { after } from "node:test";
import { businessDatabase, restorationFixture } from "./business-data-test-support.mjs";
import { insertServicesStatement } from "./official-sync-writes.ts";

const db = businessDatabase();
db.batch = async statements => { const results = []; for (const statement of statements) results.push(await statement.run()); return results; };
globalThis.warmingFixtureDb = db;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "next/server") return { url: "data:text/javascript,export function after() {}", shortCircuit: true };
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env = { DB: globalThis.warmingFixtureDb };", shortCircuit: true };
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const url = new URL(specifier + ".ts", context.parentURL);
    if (existsSync(url)) return { url: url.href, shortCircuit: true };
  }
  return next(specifier, context);
} });
const { advanceDatasetCacheInBackground, warmDatasetCache } = await import("./dataset-responses.ts");
const { readOptionalIndexes } = await import("./optional-index.ts");
for (const statement of insertServicesStatement(db, "fixture", restorationFixture.map(({ live }) => live), 0, 1791182652)) await statement.run();
after(() => { hooks.deregister(); db.sqlite.close(); delete globalThis.warmingFixtureDb; });
const bundles = () => db.sqlite.prepare("SELECT cache_key FROM dataset_response_cache WHERE cache_key LIKE '%:bundle?%' ORDER BY cache_key").all();

test("bounded cache warming resumes stored bundles and publishes success only after the full plan", async () => {
  // Given: a real SQLite source and no cached region bundles.
  db.sqlite.exec("DELETE FROM dataset_response_cache; DELETE FROM optional_index_status");
  // When: one bundle is allowed in the first background step.
  await warmDatasetCache({ maxBundles: 1, budgetMs: 5000 });
  // Then: only one bundle is durable, with no premature FRESH status.
  assert.equal(bundles().length, 1);
  assert.equal((await readOptionalIndexes(db, "fixture"))[0].state, "STALE");
  assert.equal((await readOptionalIndexes(db, "fixture"))[0].last_success_at, null);

  // Given: the previous partial step and its durable bundle.
  const first = bundles()[0].cache_key;
  db.sqlite.exec(`CREATE TRIGGER protect_first_bundle BEFORE UPDATE ON dataset_response_cache WHEN OLD.cache_key = '${first}' BEGIN SELECT RAISE(FAIL, 'completed bundle rewritten'); END;`);
  // When: the next bounded step resumes the same revision.
  await warmDatasetCache({ maxBundles: 1, budgetMs: 5000 });
  // Then: the remaining bundle is stored, the first is reused, and status is FRESH.
  assert.equal(bundles().length, 2);
  assert.equal((await readOptionalIndexes(db, "fixture"))[0].state, "FRESH");
  db.sqlite.exec("DROP TRIGGER protect_first_bundle");
});

test("zero time budget cannot leave a missing bundle reported as FRESH", async () => {
  // Given: an existing success record whose cached bundle is now missing.
  db.sqlite.exec("DELETE FROM dataset_response_cache");
  // When: the background step has no remaining time.
  await warmDatasetCache({ maxBundles: 1, budgetMs: 0 });
  // Then: no bundle is computed and the index is explicitly incomplete.
  assert.equal(bundles().length, 0);
  assert.equal((await readOptionalIndexes(db, "fixture"))[0].state, "STALE");
});

test("concurrent background wakes share one bounded step and the one-minute throttle", async t => {
  // Given: no cache and a fixed clock for all duplicate wakes.
  db.sqlite.exec("DELETE FROM dataset_response_cache");
  t.mock.method(Date, "now", () => 1791800000000);
  // When: twenty requests attempt the same background work together.
  await Promise.all(Array.from({ length: 20 }, () => advanceDatasetCacheInBackground()));
  // Then: one bundle is written; an immediate later wake makes no writes.
  assert.equal(bundles().length, 1);
  const before = db.sqlite.prepare("SELECT total_changes() AS n").get().n;
  await advanceDatasetCacheInBackground();
  assert.equal(db.sqlite.prepare("SELECT total_changes() AS n").get().n, before);
});

test("scheduled callers without limits complete the remaining cache plan", async () => {
  // Given: the remaining bundles from the prior bounded step.
  // When: the existing scheduled/full caller uses no new options.
  await warmDatasetCache();
  // Then: all bundles are durable and the index is FRESH.
  assert.equal(bundles().length, 2);
  assert.equal((await readOptionalIndexes(db, "fixture"))[0].state, "FRESH");
});
