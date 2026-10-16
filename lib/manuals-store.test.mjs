import assert from "node:assert/strict";
import test from "node:test";
import { advanceManualCorpus, manualCorpusComponent, manualSourceYear, readManualCorpusState, readableManualRevision } from "./manuals/store.ts";
import { getManualSection, searchManualSections } from "./manuals/search.ts";
import { activate, document, manualDatabase, NOW, pack, section } from "./manuals-test-support.mjs";

test("schema is empty; bounded batches remain invisible until complete atomic activation", async () => {
  const db = manualDatabase();
  const fixture = pack();
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM manual_corpus").get().n, 0);
  assert.equal((await manualCorpusComponent(db)).status, "UNAVAILABLE");
  let loaded = 0;
  const load = async (path) => { loaded++; return fixture.load(path); };
  for (let index = 0; index < fixture.manifest.batches.length; index++) {
    assert.equal((await advanceManualCorpus(db, load, fixture.manifest, { now: () => NOW })).status, "ADVANCED");
    assert.equal(await readableManualRevision(db, fixture.manifest.revision), null);
    assert.deepEqual(await searchManualSections(db, "기초연금"), []);
  }
  assert.equal((await advanceManualCorpus(db, load, fixture.manifest, { now: () => NOW })).status, "ACTIVE");
  const calls = loaded;
  assert.equal((await advanceManualCorpus(db, load, fixture.manifest, { now: () => NOW })).status, "ACTIVE");
  assert.equal(loaded, calls);
  assert.equal((await readableManualRevision(db)).section_count, 1);
  assert.equal((await manualCorpusComponent(db)).status, "PARTIAL");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM manual_section_fts WHERE manual_section_fts MATCH ?").get('"기초연금"').n, 1);
  db.sqlite.close();
});

test("asset corruption is rejected before staging, retries back off, and the prior active corpus is retained", async () => {
  const db = manualDatabase();
  const old = pack();
  await activate(db, old);
  const next = pack({ revision: "fixture-v2", createdAt: "2026-10-10T05:00:00Z" });
  const result = await advanceManualCorpus(db, async (path) => {
    const bytes = (await next.load(path)).slice(); bytes[20] ^= 1; return bytes;
  }, next.manifest, { now: () => NOW });
  assert.equal(result.status, "FAILED");
  assert.equal(result.error_code, "MANUAL_ASSET_HASH_MISMATCH");
  assert.equal(result.next_batch, 0);
  assert.equal((await readableManualRevision(db)).revision, old.manifest.revision);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM manual_document WHERE corpus_revision=?").get(next.manifest.revision).n, 0);
  assert.equal((await advanceManualCorpus(db, next.load, next.manifest, { now: () => NOW })).status, "RETRY_LATER");
  await activate(db, next, () => NOW + 6);
  assert.equal((await readableManualRevision(db)).revision, next.manifest.revision);
  assert.equal((await readManualCorpusState(db, old.manifest.revision)).active_revision, old.manifest.revision);
  assert.equal((await readManualCorpusState(db, "")).active_revision, null);
  db.sqlite.close();
});

test("duplicate section ordinals roll back every row, its FTS entries and the batch cursor", async () => {
  const db = manualDatabase();
  const fixture = pack({ documents: [document({ section_count: 2 })], sections: [section(), section({ section_id: "second", content: "기초연금 고유롤백텍스트" })] });
  await advanceManualCorpus(db, fixture.load, fixture.manifest, { now: () => NOW });
  const result = await advanceManualCorpus(db, fixture.load, fixture.manifest, { now: () => NOW });
  assert.equal(result.status, "FAILED");
  assert.equal(result.next_batch, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM manual_section").get().n, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM manual_section_fts WHERE manual_section_fts MATCH ?").get('"고유롤백텍스트"').n, 0);
  assert.equal(await readableManualRevision(db), null);
  db.sqlite.close();
});

test("expired leases cannot insert after a new worker wins the same cursor", async () => {
  const db = manualDatabase();
  const fixture = pack();
  let release, entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  let clock = NOW;
  const first = advanceManualCorpus(db, async (path) => { entered(); await pending; return fixture.load(path); }, fixture.manifest, { now: () => clock, leaseSeconds: 10 });
  await started;
  assert.equal((await advanceManualCorpus(db, fixture.load, fixture.manifest, { now: () => clock })).status, "BUSY");
  clock += 11;
  assert.equal((await advanceManualCorpus(db, fixture.load, fixture.manifest, { now: () => clock })).status, "ADVANCED");
  release();
  await first;
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM manual_document").get().n, 1);
  assert.equal(db.sqlite.prepare("SELECT next_batch FROM manual_corpus").get().next_batch, 1);
  await activate(db, fixture, () => clock);
  db.sqlite.close();
});

test("document counts and content hashes are sufficient conditions for activation, not advisory metadata", async () => {
  const db = manualDatabase();
  const mismatch = pack({ documents: [document({ section_count: 2 })] });
  await advanceManualCorpus(db, mismatch.load, mismatch.manifest, { now: () => NOW });
  await advanceManualCorpus(db, mismatch.load, mismatch.manifest, { now: () => NOW });
  const result = await advanceManualCorpus(db, mismatch.load, mismatch.manifest, { now: () => NOW });
  assert.equal(result.error_code, "MANUAL_FINAL_COUNTS_MISMATCH");
  assert.equal(await readableManualRevision(db), null);
  const bad = pack({ revision: "bad-hash", sections: [section({ content_hash: "0".repeat(64) })] });
  await advanceManualCorpus(db, bad.load, bad.manifest, { now: () => NOW });
  assert.equal((await advanceManualCorpus(db, bad.load, bad.manifest, { now: () => NOW })).error_code, "MANUAL_SECTION_HASH_MISMATCH");
  db.sqlite.close();
});

test("a stale deployment cannot replace a newer active pointer or mutate an existing manifest", async () => {
  const db = manualDatabase();
  const old = pack();
  await advanceManualCorpus(db, old.load, old.manifest, { now: () => NOW });
  await advanceManualCorpus(db, old.load, old.manifest, { now: () => NOW });
  const next = pack({ revision: "new", createdAt: "2026-10-10T05:00:00Z" });
  await activate(db, next);
  assert.equal((await advanceManualCorpus(db, old.load, old.manifest, { now: () => NOW })).status, "SUPERSEDED");
  assert.equal(await readableManualRevision(db, old.manifest.revision), null);
  assert.equal((await readableManualRevision(db)).revision, "new");
  await assert.rejects(advanceManualCorpus(db, next.load, { ...next.manifest, source_commit: "b".repeat(40) }), /MANUAL_MANIFEST_CONFLICT/);
  await assert.rejects(advanceManualCorpus(db, next.load, { ...next.manifest, batches: [{ ...next.manifest.batches[0], path: "/__manual_corpus/../other.json" }] }), /MANUAL_ASSET_PATH_INVALID/);
  db.sqlite.close();
});

test("180-row assets honor the actual D1 100-bind limit including source provenance and lease binds", async () => {
  const db = manualDatabase();
  const fixture = pack({ documents: [document({ section_count: 180 })], sections: Array.from({ length: 180 }, (_, ordinal) => section({ ordinal, section_id: "s-" + ordinal })) });
  await activate(db, fixture);
  assert.equal((await readableManualRevision(db)).section_count, 180);
  assert.ok(Math.max(...db.boundCounts) <= 100);
  assert.ok(Math.max(...db.boundCounts) > 80);
  db.sqlite.close();
});

test("corrected internal filenames retain upstream values and never promote inferred edition years to applicability", async () => {
  const db = manualDatabase();
  const original = section({ original_name: "2025 긴급복지 Q&A.pdf", upstream_original_name: "2026 긴급복지·재난적의료비 합본.md", original_name_line: 7, start_line: 300, end_line: 350 });
  const mixed = section({ section_id: "mixed", ordinal: 1, original_name: "2026 합본.md", original_name_basis: "mixed_original_files", original_name_line: null });
  const fixture = pack({ documents: [document({ section_count: 2 })], sections: [original, mixed] });
  await activate(db, fixture);
  const source = (await getManualSection(db, "manual:fixture-v1:section-one")).sources[0];
  assert.equal(source.source_year, "2025");
  assert.equal(source.document_year, "2026");
  assert.equal(source.source_year_basis, "filename_inferred");
  assert.equal(source.applicable_year, null);
  assert.equal(source.upstream_original_name, original.upstream_original_name);
  assert.equal(source.original_name_line, 7);
  assert.equal(source.authority_verified, false);
  assert.equal(source.location.physical_page, null);
  assert.equal(source.content_sha256, original.content_hash);
  assert.equal((await getManualSection(db, "manual:fixture-v1:mixed")).sources[0].source_year, null);
  assert.deepEqual(manualSourceYear("2025 및 2026 안내", "2026"), { year: null, origin: "unknown" });
  db.sqlite.close();
});
