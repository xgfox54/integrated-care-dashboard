import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createFaqNativeCollector } from "./collect-faq-native.mjs";
import { initialState, reconcile, assembleRecords, writeArtifacts } from "./faq-native-journal.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const ok = (data) => ({ structuredContent: data, content: [{ type: "text", text: JSON.stringify(data) }] });
function fixture(count = 2) {
  const items = Array.from({ length: count }, (_, i) => {
    const question = `원문 질문 ${i + 1}\n줄바꿈 유지?`;
    return { id: `WFAQ-${String(i + 1).padStart(3, "0")}`, question, provenance: { question_sha256: hash(question) } };
  });
  const benchmark = { profile: "faq_source_observation", filename: "fixture.json", sha256: "fixture", golden: { dataset_id: "fixture_faq", version: "fixture", source_workbook: { sha256: "fixture-workbook" }, items } };
  const state = initialState(benchmark, "faq-test-run");
  state.ready = { confirmed_at: "2026-10-10T00:00:00Z", expected: { manual_revision: "r1", server_version: "1.4.0", document_count: 39, section_count: 21588 } };
  return state;
}
function harness(state, answer = () => ok({ results: [] })) {
  let clock = Date.parse("2026-10-10T00:00:00Z"), active = 0, maxActive = 0;
  const events = [], calls = [], waits = [];
  const collector = createFaqNativeCollector({ state, now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; },
    persist: async (event) => { events.push(structuredClone(event)); },
    call: async (tool, args) => {
      active++; maxActive = Math.max(maxActive, active);
      calls.push({ tool, args: structuredClone(args), at: clock });
      assert.ok(events.some((event) => event.kind === "call_started" && event.tool === tool && JSON.stringify(event.arguments) === JSON.stringify(args)), "dispatch intent is persisted first");
      await Promise.resolve();
      try {
        if (tool === "app_get_dataset_status") return ok({ components: { manuals: "manuals:r1" }, server_version: "1.4.0", data: { manuals: { revision: "r1", status: "PARTIAL", document_count: 39, section_count: 21588 } } });
        if (tool === "app_get_integration_status") return ok({ data: { datasets: [] } });
        return await answer(tool, args, calls);
      } finally { active--; }
    },
  });
  return { collector, state, events, calls, waits, maxActive: () => maxActive, advance: (ms) => { clock += ms; } };
}

test("READY is a hard local gate and metadata is verified before any FAQ search", async () => {
  const noReady = fixture(); noReady.ready = null;
  const h = harness(noReady);
  await assert.rejects(h.collector.runChunk({ phase: "start" }), /WAITING_FOR_READY/);
  assert.equal(h.calls.length, 0);
  const s = fixture(); s.ready.expected.manual_revision = "another-revision";
  const mismatch = harness(s);
  await mismatch.collector.runChunk({ phase: "start" });
  assert.equal((await mismatch.collector.runChunk()).reason, "UNEXPECTED_MANUAL_REVISION");
  assert.equal(mismatch.calls.filter((call) => call.tool === "app_search").length, 0);
});

test("original queries, raw top-five ranks, type exclusions and shared fetch IDs are preserved", async () => {
  const response = ok({ manual_revision: "r1", server_version: "1.4.0", results: [
    { id: "news:1", entity_type: "manual_section" }, { id: "gov24:g1" },
    { id: "manual:r1:s1", revision: "r1", sources: [{ location: { start_line: 2, end_line: 4, physical_page: null } }] },
    { id: "bl-1", entity_type: "manual_section" }, { id: "unknown:1" }, { id: "manual:r1:rank6" },
  ] });
  const h = harness(fixture(), (tool, args) => tool === "app_search" ? response : ok({ id: args.id, text: "본문\n보존", metadata: { server_version: "1.4.0", manual_revision: "r1", excerpt: { truncated: true }, sources: [{ applicable_year: null }] } }));
  await h.collector.runChunk({ phase: "start" });
  await h.collector.runChunk({ phase: "search" });
  await h.collector.runChunk({ phase: "fetch" });
  assert.deepEqual(h.calls.filter((call) => call.tool === "app_search").map((call) => call.args.query), h.state.items.map((item) => item.question));
  assert.deepEqual(h.calls.filter((call) => call.tool === "app_fetch").map((call) => call.args.id), ["gov24:g1", "manual:r1:s1"]);
  const assembled = assembleRecords(reconcile(fixture(), h.events));
  assert.deepEqual(assembled.records[0].fetched.map((entry) => entry.rank), [2, 3]);
  assert.deepEqual(assembled.records[1].fetched.map((entry) => entry.id), ["gov24:g1", "manual:r1:s1"]);
  assert.deepEqual(assembled.records[0].search.result, response);
  assert.equal(assembled.records[0].fetched[1].result.structuredContent.metadata.excerpt.truncated, true);
  assert.equal(assembled.audit.answer_correctness, "NOT_EVALUATED");
});

test("two concurrent tools and four-second batch intervals remain below sixty per minute", async () => {
  const h = harness(fixture(70));
  await h.collector.runChunk({ phase: "start" });
  while (h.collector.pendingForPhase("search").length) await h.collector.runChunk({ phase: "search", maxBatches: 8 });
  assert.equal(h.maxActive(), 2);
  const search = h.calls.filter((call) => call.tool === "app_search");
  for (let i = 2; i < search.length; i += 2) assert.ok(search[i].at - search[i - 2].at >= 4000);
  assert.ok(h.waits.every((ms) => ms <= 5000));
  const audit = assembleRecords(reconcile(fixture(70), h.events)).audit;
  assert.ok(audit.max_returned_calls_started_in_60_seconds <= 60);
  assert.equal(audit.original_question_sha_verified, 70);
});

test("tool errors and exceptions are retained, backoff respects retry-after, attempts stop at three", async () => {
  let tries = 0;
  const h = harness(fixture(1), () => {
    tries++;
    if (tries === 1) return { isError: true, structuredContent: { error: { code: "OVERLOADED", retry_after_seconds: 40 } } };
    throw new Error("native tool overloaded again");
  });
  await h.collector.runChunk({ phase: "start" });
  await h.collector.runChunk({ phase: "search" });
  assert.equal(h.state.policy.batch_interval_ms, 8000);
  assert.equal((await h.collector.runChunk({ phase: "retry_search" })).reason, "RETRY_COOLDOWN");
  h.advance(41_001);
  await h.collector.runChunk({ phase: "retry_search", maxBatches: 1 });
  h.advance(60_001);
  await h.collector.runChunk({ phase: "retry_search", maxBatches: 1 });
  h.advance(180_000);
  assert.equal((await h.collector.runChunk({ phase: "retry_search" })).reason, "PHASE_COMPLETE");
  assert.equal(tries, 3);
  const assembled = assembleRecords(reconcile(fixture(1), h.events));
  assert.equal(assembled.records[0].attempts.length, 3);
  assert.equal(assembled.audit.native_exceptions.length, 2);
  assert.equal(assembled.records[0].attempts[0].result.structuredContent.error.code, "OVERLOADED");
  assert.equal(assembled.records[0].search.result.collector_generated_error, true);
});

test("an unmatched dispatch intent is recoverable, explicit, and consumes one bounded attempt", async () => {
  const h = harness(fixture(1));
  await h.collector.runChunk({ phase: "start" });
  await h.collector.runChunk({ phase: "search" });
  const partialEvents = h.events.filter((event) => !(event.target.type === "search" && event.kind === "call_completed"));
  const rebuilt = reconcile(fixture(1), partialEvents);
  const assembled = assembleRecords(rebuilt);
  assert.equal(assembled.audit.unresolved_dispatch_intents.length, 1);
  assert.equal(assembled.records[0].attempts[0].outcome, "NATIVE_RESULT_NOT_RECOVERED");
  assert.equal(assembled.records[0].attempts[0].response_observed, false);
  assert.equal(rebuilt.collector.pendingForPhase("search").length, 0);
  assert.equal(rebuilt.collector.pendingForPhase("retry_search").length, 1);
  assert.equal(rebuilt.state.next_sequence, 4);
});

test("recovery rejects modified input and does not infer missing fetch server metadata", async () => {
  const h = harness(fixture(1), (tool, args) => tool === "app_search" ? ok({ results: [{ id: "manual:r1:s1" }] }) : ok({ id: args.id, text: "source body", metadata: { manual_revision: "r1" } }));
  await h.collector.runChunk({ phase: "start" }); await h.collector.runChunk({ phase: "search" }); await h.collector.runChunk({ phase: "fetch" });
  const rebuilt = reconcile(fixture(1), h.events);
  assert.equal(rebuilt.state.targets["fetch:manual:r1:s1"].attempts[0].identity.server_version, null);
  const corrupt = structuredClone(h.events);
  corrupt.find((event) => event.target.type === "search").arguments.query += " 평가항목";
  assert.throws(() => reconcile(fixture(1), corrupt), /Original FAQ query changed/);
});

test("normal empty results and uncollected items remain separate from errors and answer grading", async () => {
  const h = harness(fixture(3));
  await h.collector.runChunk({ phase: "start" }); await h.collector.runChunk({ phase: "search", maxBatches: 1 });
  const { records, audit } = assembleRecords(reconcile(fixture(3), h.events));
  assert.equal(audit.progress.search_success, 2); assert.equal(audit.progress.search_empty, 2); assert.equal(audit.progress.search_errors, 0);
  assert.equal(records[2].status, "NOT_RUN"); assert.equal(records[0].fetched.length, 0);
  assert.equal(audit.semantic_relevance, "NOT_EVALUATED");
});

test("raw files and gzip archives round-trip byte-for-byte with complete event provenance", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "faq-native-journal-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const checkpoints = path.join(dir, "checkpoints"); await mkdir(checkpoints);
  const config = fixture(1), h = harness(structuredClone(config));
  await h.collector.runChunk({ phase: "start" }); await h.collector.runChunk({ phase: "search" }); await h.collector.runChunk({ phase: "end" });
  await writeFile(path.join(dir, "config.json"), JSON.stringify(config));
  for (const event of h.events) await writeFile(path.join(checkpoints, String(event.sequence).padStart(6, "0") + (event.kind === "call_started" ? ".started.json" : ".completed.json")), JSON.stringify(event) + "\n");
  const output = path.join(dir, "repo-output"), audit = await writeArtifacts(dir, output);
  for (const name of ["input-records.jsonl", "raw-call-journal.jsonl"]) {
    const raw = await readFile(path.join(dir, name));
    assert.deepEqual(gunzipSync(await readFile(path.join(output, name + ".gz"))), raw);
    assert.equal(audit.artifacts.find((artifact) => artifact.path === name).sha256, hash(raw));
  }
  const input = (await readFile(path.join(dir, "input-records.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(input.find((record) => record.kind === "record").question, config.items[0].question);
  assert.equal(audit.checkpoint_files.length, 10);
  assert.equal(audit.unresolved_dispatch_intents.length, 0);
});
