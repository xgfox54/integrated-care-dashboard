#!/usr/bin/env node
// Local-only preparation, crash recovery, and lossless native response packaging.
// This file has no network adapter and cannot invoke MCP tools.
import { readFile, writeFile, mkdir, readdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createFaqNativeCollector } from "./collect-faq-native.mjs";
import { loadBenchmark } from "./run-golden-qa.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const line = (value) => JSON.stringify(value) + "\n";
const atomicJson = async (filename, value) => { await writeFile(filename + ".tmp", json(value)); await rename(filename + ".tmp", filename); };

export function initialState(benchmark, runId) {
  if (benchmark.profile !== "faq_source_observation") throw new Error("Native FAQ collection requires the FAQ profile");
  if (!/^[a-z0-9][a-z0-9-]{3,80}$/.test(runId)) throw new Error("Invalid run ID");
  return {
    schema_version: "faq-native-collection-1", run_id: runId, dataset_id: benchmark.golden.dataset_id,
    benchmark: { filename: benchmark.filename, sha256: benchmark.sha256, version: benchmark.golden.version, count: benchmark.golden.items.length, evaluation_profile: benchmark.profile, source_workbook_sha256: benchmark.golden.source_workbook?.sha256 ?? null, ...(benchmark.golden.source_suite ? { source_suite: benchmark.golden.source_suite } : {}) },
    items: benchmark.golden.items.map((item) => ({ id: item.id, question: item.question, question_sha256: item.provenance.question_sha256 })),
    ready: null, policy: { concurrency: 2, batch_interval_ms: 4000, max_attempts: 3, max_calls_per_minute: 60, fetch_selection: "RAW_SEARCH_RANK_1_TO_5_ADMISSIBLE_ONLY", fetch_extent: "FIRST_RETURNED_EXCERPT_ONLY", retry_policy: "UP_TO_3_ATTEMPTS_WITH_15_30_SECOND_BACKOFF_AND_RETRY_AFTER", incomplete_call_policy: "PRESERVE_DISPATCH_INTENT_AND_MARK_RESULT_NOT_RECOVERED" },
    next_sequence: 1, next_batch_at: 0, cooldown_until: 0, dispatch_times: [], targets: {},
  };
}

export async function readJournal(directory) {
  const names = (await readdir(path.join(directory, "checkpoints"))).filter((name) => /^\d{6}\.(?:started|completed)\.json$/.test(name)).sort();
  const events = [];
  const files = [];
  for (const name of names) {
    const raw = await readFile(path.join(directory, "checkpoints", name));
    const event = JSON.parse(raw);
    const expectedName = String(event.sequence).padStart(6, "0") + (event.kind === "call_started" ? ".started.json" : event.kind === "call_completed" ? ".completed.json" : ".INVALID");
    if (name !== expectedName) throw new Error("Journal filename/event mismatch: " + name);
    files.push({ path: "checkpoints/" + name, sha256: hash(raw), bytes: raw.length });
    events.push(event);
  }
  return { events, files };
}

export function reconcile(config, events, ready = config.ready) {
  const state = structuredClone(config);
  state.ready = ready;
  state.targets = {}; state.next_sequence = 1; state.dispatch_times = [];
  const collector = createFaqNativeCollector({ state });
  const starts = new Map(), completions = new Map();
  for (const event of events) {
    if (event.run_id !== state.run_id || event.dataset_id !== state.dataset_id) throw new Error("Foreign run/dataset in checkpoint");
    const map = event.kind === "call_started" ? starts : completions;
    if (map.has(event.call_id)) throw new Error("Duplicate journal event: " + event.call_id);
    if (event.target.type === "search") {
      const item = state.items.find((item) => item.id === event.target.id);
      if (!item || event.arguments?.query !== item.question || event.target.question !== item.question || event.target.question_sha256 !== item.question_sha256) throw new Error("Original FAQ query changed: " + event.target.id);
    }
    map.set(event.call_id, event);
    state.next_sequence = Math.max(state.next_sequence, event.sequence + 1);
  }
  for (const event of [...starts.values()].sort((a, b) => a.sequence - b.sequence)) {
    const end = completions.get(event.call_id);
    if (end) {
      if (end.sequence !== event.sequence || end.attempt !== event.attempt || end.target.type !== event.target.type || end.target.id !== event.target.id || JSON.stringify(end.arguments) !== JSON.stringify(event.arguments)) throw new Error("Completion differs from dispatch intent: " + event.call_id);
      collector.applyCompleted(end);
      state.dispatch_times.push(Date.parse(end.started_at));
      if (end.policy?.batch_interval_ms > state.policy.batch_interval_ms) state.policy.batch_interval_ms = end.policy.batch_interval_ms;
    } else {
      collector.recordUnresolved(event);
      state.dispatch_times.push(Date.parse(event.prepared_at));
    }
  }
  for (const end of completions.values()) if (!starts.has(end.call_id)) throw new Error("Completion has no dispatch intent: " + end.call_id);
  for (const target of Object.values(state.targets)) {
    for (let index = 0; index < target.attempts.length; index++) if (target.attempts[index].attempt !== index + 1) throw new Error("Nonconsecutive attempt sequence: " + target.id);
    const last = target.attempts.at(-1);
    if (!last.ok) {
      state.policy.batch_interval_ms = 8000;
      state.cooldown_until = Math.max(state.cooldown_until, last.retry_not_before);
    }
  }
  state.dispatch_times.sort((a, b) => a - b);
  state.next_batch_at = (state.dispatch_times.at(-1) ?? 0) + state.policy.batch_interval_ms;
  return { state, collector, starts, completions };
}

export function assembleRecords(rebuilt) {
  const { state, collector, starts, completions } = rebuilt;
  const targetAttempts = (type, id) => state.targets[`${type}:${id}`]?.attempts ?? [];
  const responseFor = (attempt) => {
    const end = completions.get(attempt.call_id);
    if (end && !end.exception) return end.response;
    return { error: attempt.error, collector_generated_error: true, native_response_observed: false };
  };
  const allAttempts = (type, id) => targetAttempts(type, id).map((attempt) => ({ ...attempt,
    arguments: starts.get(attempt.call_id)?.arguments,
    result: responseFor(attempt), exception: completions.get(attempt.call_id)?.exception ?? null,
  }));
  const status = (phase) => {
    const ds = targetAttempts("dataset_status", phase).at(-1);
    const integration = targetAttempts("integration_status", phase).at(-1);
    if (!ds && !integration) return null;
    return { kind: "status", phase, at: [ds?.completed_at ?? ds?.started_at, integration?.completed_at ?? integration?.started_at].filter(Boolean).sort().at(-1),
      transport: "native_connector", initialize: null,
      dataset_status: ds ? responseFor(ds) : { error: { code: "MISSING_STATUS_CALL" }, collector_generated_error: true },
      integration_status: integration ? responseFor(integration) : { error: { code: "MISSING_STATUS_CALL" }, collector_generated_error: true },
      attempts: { dataset_status: allAttempts("dataset_status", phase), integration_status: allAttempts("integration_status", phase) },
    };
  };
  const records = state.items.map((item) => {
    const attempts = targetAttempts("search", item.id), last = attempts.at(-1);
    const fetched = [];
    const ids = new Set();
    for (const hit of last?.selected ?? []) {
      if (!hit.admissible || !hit.id || ids.has(hit.id)) continue;
      ids.add(hit.id);
      const detailAttempts = targetAttempts("fetch", hit.id), detail = detailAttempts.at(-1);
      if (!detail) continue;
      fetched.push({ id: hit.id, rank: hit.rank, tool: "fetch", arguments: { id: hit.id }, result: responseFor(detail),
        from_shared_cache: true, call_id: detail.call_id, started_at: detailAttempts[0].started_at, completed_at: detail.completed_at,
        latency_ms: detail.latency_ms, attempts: allAttempts("fetch", hit.id) });
    }
    return { kind: "record", id: item.id, dataset_id: state.dataset_id, question: item.question, question_sha256: item.question_sha256,
      transport: "native_connector", ...(last ? {} : { status: "NOT_RUN" }),
      started_at: attempts[0]?.started_at ?? null, completed_at: last?.completed_at ?? null, latency_ms: last?.latency_ms ?? null, latency_scope: "FINAL_SEARCH_CALL",
      search: { tool: "search", arguments: { query: item.question }, ...(last ? { call_id: last.call_id, result: responseFor(last) } : { error: { code: "NOT_RUN" } }) },
      fetched, attempts: allAttempts("search", item.id), collection_policy: state.policy,
    };
  });
  const ended = [...completions.values()];
  const times = ended.map((event) => Date.parse(event.started_at)).sort((a, b) => a - b);
  let peak = 0, left = 0;
  for (let right = 0; right < times.length; right++) { while (times[right] - times[left] >= 60_000) left++; peak = Math.max(peak, right - left + 1); }
  const audit = {
    schema_version: "faq-native-audit-1", run_id: state.run_id, dataset_id: state.dataset_id, benchmark: state.benchmark, ready: state.ready,
    at: new Date().toISOString(), policy: state.policy, progress: collector.progress("assembled"),
    dispatch_intents: starts.size, completion_events: completions.size, native_responses: ended.filter((event) => !event.exception).length,
    native_exceptions: ended.filter((event) => event.exception).map((event) => ({ call_id: event.call_id, target: event.target, exception: event.exception })),
    unresolved_dispatch_intents: [...starts.values()].filter((event) => !completions.has(event.call_id)).map((event) => ({ call_id: event.call_id, target: event.target, prepared_at: event.prepared_at, dispatch_status: event.dispatch_status })),
    max_returned_calls_started_in_60_seconds: peak,
    call_count_note: "Unresolved dispatch intents are retained separately. They do not prove that a tool request was dispatched or returned.",
    search_attempts: [...starts.values()].filter((event) => event.target.type === "search").length,
    fetch_attempts: [...starts.values()].filter((event) => event.target.type === "fetch").length,
    status_attempts: [...starts.values()].filter((event) => ["dataset_status", "integration_status"].includes(event.target.type)).length,
    final_records: records.length, original_question_sha_verified: records.filter((record) => hash(record.question) === record.question_sha256 && record.search.arguments.query === record.question).length,
    fetch_selection: "Original raw ranks 1-5, then allowed welfare/document/manual types; later ranks never promoted.",
    answer_correctness: "NOT_EVALUATED", semantic_relevance: "NOT_EVALUATED", human_review: "PENDING",
  };
  return { start: status("start"), end: status("end"), records, audit };
}

export async function writeArtifacts(directory, gzipOutput) {
  const config = JSON.parse(await readFile(path.join(directory, "config.json"), "utf8"));
  let ready = config.ready;
  try { ready = JSON.parse(await readFile(path.join(directory, "READY.json"), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const journal = await readJournal(directory);
  const rebuilt = reconcile(config, journal.events, ready);
  const assembled = assembleRecords(rebuilt);
  const recordsText = [assembled.start, ...assembled.records, assembled.end].filter(Boolean).map(line).join("");
  const eventsText = journal.events.sort((a, b) => a.sequence - b.sequence || (a.kind === "call_started" ? -1 : 1)).map(line).join("");
  await atomicJson(path.join(directory, "resume-state.json"), rebuilt.state);
  await atomicJson(path.join(directory, "progress.json"), rebuilt.collector.progress("reconciled"));
  await writeFile(path.join(directory, "input-records.jsonl"), recordsText);
  await writeFile(path.join(directory, "raw-call-journal.jsonl"), eventsText);
  assembled.audit.checkpoint_files = journal.files;
  assembled.audit.artifacts = [];
  if (gzipOutput) await mkdir(gzipOutput, { recursive: true });
  for (const [name, text] of [["input-records.jsonl", recordsText], ["raw-call-journal.jsonl", eventsText]]) {
    const bytes = Buffer.from(text), compressed = gzipSync(bytes, { level: 9 });
    await writeFile(path.join(directory, name + ".gz"), compressed);
    if (gzipOutput) await writeFile(path.join(gzipOutput, name + ".gz"), compressed);
    assembled.audit.artifacts.push({ path: name, bytes: bytes.length, sha256: hash(bytes), gzip_path: name + ".gz", gzip_bytes: compressed.length, gzip_sha256: hash(compressed) });
  }
  await atomicJson(path.join(directory, "collection-audit.json"), assembled.audit);
  if (gzipOutput) await atomicJson(path.join(gzipOutput, "collection-audit.json"), assembled.audit);
  return assembled.audit;
}

async function cli(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!/^--(?:directory|run-id|golden|gzip-output)$/.test(rest[i]) || rest[i + 1] === undefined) throw new Error("Unknown or missing CLI option");
    options[rest[i].slice(2)] = rest[i + 1];
  }
  if (!options.directory) throw new Error("--directory is required");
  const directory = path.resolve(options.directory);
  if (command === "init") {
    try { await stat(path.join(directory, "config.json")); throw new Error("Existing collection config must not be overwritten"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    const benchmark = await loadBenchmark({ golden: options.golden ? path.resolve(options.golden) : null });
    const state = initialState(benchmark, options["run-id"] ?? "faq-native-20261010");
    await mkdir(path.join(directory, "checkpoints"), { recursive: true });
    await writeFile(path.join(directory, "config.json"), json(state), { flag: "wx" });
    console.log(JSON.stringify({ status: "PREPARED_WAITING_FOR_READY", directory, count: state.items.length, benchmark: state.benchmark }));
  } else if (command === "reconcile") {
    const audit = await writeArtifacts(directory, options["gzip-output"] ? path.resolve(options["gzip-output"]) : null);
    console.log(JSON.stringify({ directory, progress: audit.progress, artifacts: audit.artifacts }));
  } else throw new Error("Use init or reconcile; this CLI never calls MCP services");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli(process.argv.slice(2)).catch((error) => { console.error(String(error?.stack ?? error)); process.exitCode = 1; });
