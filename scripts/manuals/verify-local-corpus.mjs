#!/usr/bin/env node
// Verify the checked-in manifest/assets against the real runtime importer and searcher.
// This script uses an in-memory SQLite database and never contacts operational services.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { backup } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { manualDatabase } from "../../lib/manuals-test-support.mjs";
import { advanceManualCorpus, readManualCorpusState } from "../../lib/manuals/store.ts";
import { searchManualSections, getManualSection } from "../../lib/manuals/search.ts";

const { values } = parseArgs({ options: {
  "repo-root": { type: "string" }, "output-dir": { type: "string" },
  "save-db": { type: "boolean", default: false }, help: { type: "boolean", default: false },
} });
if (values.help) {
  console.log("Usage: node --experimental-strip-types scripts/manuals/verify-local-corpus.mjs [--repo-root PATH] [--output-dir PATH] [--save-db]\n\nDefaults: assets/manifest from this checkout; evidence in a fresh OS temporary directory.\nThe upstream source database or SOURCE_ROOT is not needed because the checked-in corpus pack is the input.\n--save-db additionally retains the local verification database; it is never needed for deployment.");
  process.exit(0);
}
const repo = values["repo-root"] ? resolve(values["repo-root"]) : resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = values["output-dir"] ? resolve(values["output-dir"]) : mkdtempSync(join(tmpdir(), "welfare-manual-local-"));
mkdirSync(output, { recursive: true });
const manifest = JSON.parse(readFileSync(join(repo, "data/manual-corpus/manifest.json"), "utf8"));
const db = manualDatabase();
const started = performance.now();
const batches = [];
let active = false;
for (let index = 0; index <= manifest.batches.length; index++) {
  const begin = performance.now();
  const result = await advanceManualCorpus(db, async (path) => new Uint8Array(readFileSync(join(repo, "data/manual-corpus/assets", path))), manifest, { maxMillis: 15000 });
  batches.push({ index, millis: Math.round(performance.now() - begin), ...result });
  assert.ok(["ADVANCED", "ACTIVE"].includes(result.status), JSON.stringify(result));
  if (result.status === "ACTIVE") { active = true; break; }
  if (index % 20 === 0) console.log(JSON.stringify({ stage: "local_import", batch: index + 1, total: manifest.batches.length, millis: batches.at(-1).millis }));
}
assert.equal(active, true);
const importMillis = Math.round(performance.now() - started);
const quickCheck = db.sqlite.prepare("PRAGMA quick_check").get().quick_check;
assert.equal(quickCheck, "ok");
assert.deepEqual(db.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
db.sqlite.exec("INSERT INTO manual_section_fts(manual_section_fts, rank) VALUES('integrity-check', 1)");
const sourceChecks = db.sqlite.prepare(`SELECT COUNT(*) sections,
  SUM(original_name <> upstream_original_name) corrected_original_names,
  SUM(original_name_basis = 'mixed_original_files') mixed_original_files,
  SUM(source_year = '2025' AND original_name_basis = 'explicit_original_file_marker') explicit_2025_sections,
  SUM(source_year IS NULL) unknown_source_years FROM manual_section`).get();
// Representative retrieval probes, not the FAQ benchmark or an answer-correctness test.
const queries = [
  "생계급여 의료급여를 함께 받는데 45일 입원했을 때 생계급여 공제 기준",
  "기초연금 배우자 소득인정액",
  "2025년 긴급복지 Q&A 생계지원",
  "장애인 활동지원 본인부담금",
  "자활 근로소득 공제",
  "주거급여 자동차 재산 산정",
  "서귀포 제주가치돌봄 식사 지원 신청",
  "사회복지시설 연락처",
  "존재하지않는가상사업xyz987",
];
const observations = [];
for (const query of queries) {
  const begin = performance.now();
  const hits = await searchManualSections(db, query, { revision: manifest.revision, limit: 5 });
  const millis = Math.round(performance.now() - begin);
  const top = hits[0] ? await getManualSection(db, hits[0].id, { revision: manifest.revision }) : null;
  observations.push({ query, millis, count: hits.length,
    results: hits.map((hit) => ({ id: hit.id, title: hit.title, score: hit.score, excerpt: hit.excerpt, sources: hit.sources })),
    first_fetch: top ? { returned_chars: top.returned_chars, total_chars: top.total_chars, next_offset: top.next_offset, content_sha256: top.sources[0].content_sha256, contains_table_markup: /<table>|\|[^\n]+\|/.test(top.text), applicable_year: top.sources[0].applicable_year } : null,
  });
  console.log(JSON.stringify({ stage: "local_search", query, millis, count: hits.length, titles: hits.map((hit) => hit.title) }));
}
assert.equal(observations.at(-1).count, 0);
const largest = db.sqlite.prepare("SELECT section_id, length(content) chars, content_hash FROM manual_section ORDER BY length(content) DESC LIMIT 1").get();
let offset = 0, chars = 0, parts = 0;
do {
  const excerpt = await getManualSection(db, `manual:${manifest.revision}:${largest.section_id}`, { revision: manifest.revision, offset });
  assert.ok(excerpt.returned_chars <= 8000);
  chars += excerpt.returned_chars;
  offset = excerpt.next_offset;
  parts++;
} while (offset !== null);
assert.equal(chars, largest.chars);
const audit = {
  scope: "local SQLite only; no operational writes or MCP calls", created_at: new Date().toISOString(),
  revision: manifest.revision, source_commit: manifest.source_commit, state: await readManualCorpusState(db),
  batch_count: manifest.batches.length, imported_asset_bytes: manifest.batches.reduce((sum, row) => sum + row.bytes, 0),
  import_millis: importMillis, max_batch_millis: Math.max(...batches.map((row) => row.millis)),
  max_bound_parameters: Math.max(...db.boundCounts), sqlite_quick_check: quickCheck, foreign_key_issues: 0,
  fts_external_content_integrity: "PASS", source_checks: sourceChecks,
  pagination_largest_section: { ...largest, returned_chars: chars, parts, max_chars_per_call: 8000 },
  queries: observations, batches,
};
const auditPath = join(output, "runtime-local-audit.json");
writeFileSync(auditPath, JSON.stringify(audit, null, 2) + "\n");
if (values["save-db"]) await backup(db.sqlite, join(output, "manual-runtime-local.db"));
db.sqlite.close();
console.log(JSON.stringify({ status: "PASS", importMillis, maxBatchMillis: audit.max_batch_millis, maxQueryMillis: Math.max(...observations.map((row) => row.millis)), counts: sourceChecks, output: auditPath }));
