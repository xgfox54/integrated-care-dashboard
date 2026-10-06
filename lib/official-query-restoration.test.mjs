import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { computeBuildVersions } from "../scripts/data-versions.mjs";
import { registerHooks } from "node:module";
import test, { after } from "node:test";
import { businessDatabase, restorationFixture } from "./business-data-test-support.mjs";
import { insertServicesStatement } from "./official-sync-writes.ts";

const db = businessDatabase();
globalThis.businessQueryFixtureDb = db;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/server") return { url: "data:text/javascript,export function after() {}", shortCircuit: true };
    if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env = { DB: globalThis.businessQueryFixtureDb };", shortCircuit: true };
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const url = new URL(specifier + ".ts", context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const { searchOfficialServices, exportOfficialServices, searchRegionTargets } = await import("./official-query.ts");
for (const statement of insertServicesStatement(db, "fixture", restorationFixture.map(({ live }) => live), 0, 1791182652)) await statement.run();
after(() => {
  hooks.deregister();
  db.sqlite.close();
  delete globalThis.businessQueryFixtureDb;
});
const empty = { sido: "", sigungu: "", category: "", subcategory: "", type: "", keyword: "", sort: "region" };
const byId = (rows) => rows.map((row) => row.serviceId).sort();

test("saved SQL rows: restored classification filters, total counts and exports match all 30 verified IDs", async () => {
  for (const { live, expected } of restorationFixture) {
    const filters = { ...empty, sido: live.sido, sigungu: live.sigungu, subcategory: expected.subcategory, type: expected.type };
    const wanted = restorationFixture.filter((entry) => entry.live.sido === live.sido && entry.live.sigungu === live.sigungu && entry.expected.subcategory === expected.subcategory && entry.expected.type === expected.type).map(({ live }) => live);
    const result = await searchOfficialServices(filters, 1, 100);
    assert.deepEqual(byId(result.rows), byId(wanted), live.serviceId);
    assert.equal(result.totalCount, wanted.length, live.serviceId);
    assert.deepEqual(byId(await exportOfficialServices(filters)), byId(wanted), live.serviceId);
    for (const row of result.rows) {
      assert.equal(row.subcategory, filters.subcategory);
      assert.equal(row.type, filters.type);
    }
  }
});

test("restored keywords and region type totals agree with displayed rows including Pyeongtaek and Eumseong", async () => {
  const p = await searchOfficialServices({ ...empty, sido: "경기도", sigungu: "평택시", keyword: "방문간호", subcategory: "방문간호" }, 1);
  assert.deepEqual(byId(p.rows), ["0085:1489596:1:2:2"]);
  const filters = { ...empty, sido: "충청북도", sigungu: "음성군", keyword: "공통_연계", type: "공통_연계" };
  const result = await searchOfficialServices(filters, 1);
  assert.equal(result.totalCount, 6);
  assert.ok(result.rows.some((row) => row.serviceId === "0086:1489643:1:3:11"));
  assert.deepEqual(result.regionSummary.typeCounts, { "공통_연계": 6, "지역특화": 6 });
  const [bundle] = await searchRegionTargets("sigungu", [{ sido: "충청북도", sigungu: "음성군" }], "", 100);
  assert.deepEqual(bundle.regionSummary.typeCounts, result.regionSummary.typeCounts);
  assert.equal(bundle.totalCount, 12);
  assert.equal((await searchOfficialServices({ ...filters, type: "미분류", keyword: "" }, 1)).totalCount, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM official_service_snapshot WHERE type = '미분류'").get().n, 12, "reading must not rewrite stored rows");
});

test("SQL restoration leaves unlisted IDs and later source revisions unchanged", async () => {
  const live = restorationFixture.find(({ live }) => live.serviceId === "0085:1489596:1:2:2").live;
  const controls = [
    { ...live, serviceId: "unlisted:source", name: "범위검증" },
    { ...live, updatedDate: "2026-04", name: "범위검증" },
  ];
  for (const statement of insertServicesStatement(db, "fixture", controls, 100, 1791182652)) await statement.run();
  const result = await exportOfficialServices({ ...empty, keyword: "범위검증" });
  assert.equal(result.length, 2);
  assert.ok(result.every((row) => row.subcategory === "방문요양"));
});


test("source restoration changes build fingerprint and bypasses old summary and bundle caches without deleting them", async (t) => {
  const root = mkdtempSync(resolve(tmpdir(), "dataset-version-"));
  t.after(() => { rmSync(root, { recursive: true, force: true }); delete globalThis.__DATASET_CACHE_VERSION__; });
  mkdirSync(resolve(root, "lib"));
  const path = resolve(root, "lib/official-source-restoration.ts");
  const source = readFileSync(new URL("./official-source-restoration.ts", import.meta.url), "utf8");
  writeFileSync(path, source);
  const oldVersion = computeBuildVersions(root).datasetCache;
  writeFileSync(path, source + String.fromCharCode(10));
  const newVersion = computeBuildVersions(root).datasetCache;
  assert.notEqual(newVersion, oldVersion, "the new structural module must participate in the build hash");
  globalThis.__DATASET_CACHE_VERSION__ = newVersion;
  const oldPrefix = "v1:" + oldVersion + ":";
  const { cachedDatasetJson, DATASET_CACHE_PREFIX, listFreshKeys } = await import("./dataset-cache.ts");
  assert.equal(DATASET_CACHE_PREFIX, "v1:" + newVersion + ":");
  for (const key of ["summary", "bundle:sigungu:fixture"]) {
    db.sqlite.prepare("INSERT INTO dataset_response_cache (cache_key, run_id, edits_version, body, created_at) VALUES (?, 'fixture', '0:0:0', ?, 1791182652)").run(oldPrefix + key, "old-classifications");
    let computed = 0;
    const fresh = await cachedDatasetJson(key, async () => { computed++; return "restored-classifications"; });
    assert.deepEqual(fresh, { body: "restored-classifications", stored: false });
    assert.equal(computed, 1);
    db.sqlite.prepare("INSERT INTO dataset_response_cache (cache_key, run_id, edits_version, body, created_at) VALUES (?, 'fixture', '0:0:0', ?, 1791182652)").run(DATASET_CACHE_PREFIX + key, fresh.body);
    assert.deepEqual(await cachedDatasetJson(key, async () => { throw new Error("current cache should hit"); }), { body: fresh.body, stored: true });
  }
  assert.deepEqual([...await listFreshKeys("fixture", "0:0:0")].sort(), ["bundle:sigungu:fixture", "summary"]);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM dataset_response_cache WHERE cache_key LIKE ?").get(oldPrefix + "%").n, 2);
});
