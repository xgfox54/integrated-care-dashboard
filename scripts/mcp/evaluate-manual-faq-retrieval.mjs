import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";
import { loadFaqTestSuite } from "./faq-test-suite.mjs";
import { searchManualSections, getManualSection } from "../../lib/manuals/search.ts";
import { manualDatabase } from "../../lib/manuals-test-support.mjs";
import { advanceManualCorpus } from "../../lib/manuals/store.ts";
import { reviewHash } from "./manual-faq-review.mjs";

export function observeAnswer(item, hits, fetched, k) {
  const normalize = (text) => text.replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  const expected = normalize(item.reference_answer);
  const candidates = hits.slice(0, k).map((hit) => {
    const body = fetched.get(hit.id);
    const matchingSource = body?.sources?.some((source) => source.document_sha256 === item.reference.sha256
      && source.location?.start_line <= item.reference.end_line
      && source.location?.end_line >= item.reference.answer_start_line);
    return { hit, body, matchingSource };
  });
  return {
    answer_span_hit: candidates.some((row) => row.matchingSource),
    complete_answer_text_in_one_fetch: Boolean(expected) && candidates.some((row) => row.matchingSource && normalize(row.body.text).includes(expected)),
  };
}

function readOnlyDatabase(filename) {
  const sqlite = new DatabaseSync(filename, { readOnly: true });
  sqlite.exec("PRAGMA query_only=ON");
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.values) }; }
  }
  return { sqlite, prepare: (sql) => new Statement(sql) };
}

async function restoreDeploymentCorpus() {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const manifest = JSON.parse(await readFile(path.join(repo, "data/manual-corpus/manifest.json"), "utf8"));
  const db = manualDatabase();
  for (let index = 0; index <= manifest.batches.length; index++) {
    const result = await advanceManualCorpus(db, async (name) => new Uint8Array(await readFile(path.join(repo, "data/manual-corpus/assets", name))), manifest, { maxMillis: 15000 });
    if (result.status === "ACTIVE") {
      db.sqlite.exec("PRAGMA query_only=ON");
      return db;
    }
    if (result.status !== "ADVANCED") { db.sqlite.close(); throw new Error("배포 corpus 로컬 복원 실패: " + result.status); }
  }
  db.sqlite.close();
  throw new Error("배포 corpus 활성화가 완료되지 않았습니다.");
}

async function main() {
  const { values } = parseArgs({ options: {
    db: { type: "string" }, suite: { type: "string", default: "quality/faq-test-suite.json" },
    output: { type: "string", default: "outputs/manual-faq-review-20261013/retrieval" },
    limit: { type: "string" },
  } });
  const limit = values.limit === undefined ? Infinity : Number(values.limit);
  if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) throw new Error("limit는 양의 정수여야 합니다.");
  const suite = await loadFaqTestSuite(path.resolve(values.suite));
  const all = suite.items.filter((item) => item.benchmark_group === "manual_faq_1173");
  const eligible = all.filter((item) => item.retrieval_probe_eligible);
  const selected = eligible.slice(0, limit);
  console.log(JSON.stringify({ stage: "suite_loaded", eligible: eligible.length, selected: selected.length }));
  const db = values.db ? readOnlyDatabase(path.resolve(values.db)) : await restoreDeploymentCorpus();
  try {
    const revision = db.sqlite.prepare("SELECT revision FROM manual_active WHERE id=1").get()?.revision;
    if (!revision) throw new Error("활성화된 실제 매뉴얼 corpus가 없습니다.");
    const documents = new Map(db.sqlite.prepare("SELECT source_name,sha256 FROM manual_document WHERE corpus_revision=?").all(revision).map((row) => [row.source_name, row.sha256]));
    for (const item of selected) if (documents.get(item.reference.source_name) !== item.reference.sha256) throw new Error("검색 corpus와 FAQ 원문 해시가 다릅니다: " + item.id);
    const records = [];
    for (const [index, item] of selected.entries()) {
      for (const mode of ["raw", "contextual"]) {
        const query = mode === "raw" ? item.raw_question : item.reference_contextual_question ?? item.question;
        const started = performance.now();
        const hits = (await searchManualSections(db, query, { revision, limit: 5 })).slice(0, 5);
        const fetched = new Map();
        for (const hit of hits) fetched.set(hit.id, await getManualSection(db, hit.id, { revision }));
        records.push({ id: item.id, mode, query, query_sha256: reviewHash(query),
          millis: Math.round(performance.now() - started),
          at: Object.fromEntries([1, 3, 5].map((k) => [k, observeAnswer(item, hits, fetched, k)])),
          candidates: hits.map((hit) => ({ id: hit.id, title: hit.title,
            sources: fetched.get(hit.id)?.sources, returned_chars: fetched.get(hit.id)?.returned_chars,
            truncated: fetched.get(hit.id)?.truncated, next_offset: fetched.get(hit.id)?.next_offset })),
        });
      }
      if ((index + 1) % 100 === 0) console.log(JSON.stringify({ completed: index + 1, selected: selected.length }));
    }
    const modes = {};
    for (const mode of ["raw", "contextual"]) {
      const rows = records.filter((row) => row.mode === mode);
      modes[mode] = { count: rows.length, at: Object.fromEntries([1, 3, 5].map((k) => {
        const span = rows.filter((row) => row.at[k].answer_span_hit).length;
        const body = rows.filter((row) => row.at[k].complete_answer_text_in_one_fetch).length;
        return [k, { answer_span_hits: span, answer_span_rate: rows.length ? span / rows.length : null,
          complete_answer_text_hits: body, complete_answer_text_rate: rows.length ? body / rows.length : null }];
      })) };
    }
    const summary = { scope: "OFFLINE_MANUAL_COMPONENT_ONLY", revision, suite_version: suite.version,
      suite_sha256: reviewHash(JSON.stringify(suite)), total_manual_questions: all.length,
      quarantined: all.length - eligible.length, eligible: eligible.length, tested: selected.length,
      full_eligible_run: selected.length === eligible.length, modes,
      answer_correctness: "NOT_EVALUATED", gpt_calls: 0, network_calls: 0,
      database_mode: values.db ? "saved_sqlite_read_only" : "deployment_assets_in_memory_read_only",
      limitations: ["구조 위험 없는 후보도 의미 검수 대기", "조회한 첫 본문 구간에서 정규화된 정답 후보 전체 문자열 일치만 관찰", "전체 MCP 통합 검색·답변 정답률과 구분"] };
    await mkdir(values.output, { recursive: true });
    await writeFile(path.join(values.output, "records.json"), JSON.stringify(records, null, 2) + "\n");
    await writeFile(path.join(values.output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    console.log(JSON.stringify(summary));
  } finally { db.sqlite.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
