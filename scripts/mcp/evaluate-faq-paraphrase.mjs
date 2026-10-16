#!/usr/bin/env node
// node --experimental-strip-types scripts/mcp/evaluate-faq-paraphrase.mjs [--sets dev,holdout,exact,test] [--detail dev] [--output FILE]
// Runs the production FAQ search (baseline ranking) over FAQ paraphrase sets. No model or network calls.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { database } from "../../lib/press-test-support.mjs";
import { searchFaq129 } from "../../lib/mcp/faq129.ts";
import { refineWelfareQuery } from "../../lib/mcp/query-refiner.ts";

const NOW_MS = Date.parse("2026-10-13T00:00:00Z");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function loadSets(db, names) {
  const sets = {};
  for (const name of names) {
    if (name === "exact") {
      sets.exact = db.sqlite.prepare("SELECT faq_id, question FROM faq_129 ORDER BY faq_id").all().map((row) => ({ id: "exact-" + row.faq_id, query: row.question, expected_ids: ["faq129:" + row.faq_id] }));
      continue;
    }
    const file = name === "holdout" ? "quality/hybrid-search-holdout.json" : "quality/faq-paraphrase-" + name + ".json";
    const bytes = readFileSync(file);
    const cases = JSON.parse(bytes).cases;
    if (name === "holdout") for (const slice of ["paraphrase", "negative", "scope"]) sets["holdout-" + slice] = cases.filter((c) => c.slice === slice).map((c) => ({ ...c, file_sha256: sha256(bytes) }));
    else sets[name] = cases.map((c) => ({ ...c, file_sha256: sha256(bytes) }));
  }
  return sets;
}

export async function evaluate(names) {
  const db = database();
  try {
    const sets = loadSets(db, names);
    const summary = {};
    const rows = {};
    for (const [name, cases] of Object.entries(sets)) {
      rows[name] = [];
      for (const c of cases) {
        const plan = { ...refineWelfareQuery(c.query, { currentYear: 2026 }), ...c.plan };
        const result = await searchFaq129(db, plan, { limit: 5, nowMs: NOW_MS });
        const ids = result.hits.map((hit) => hit.id);
        const expected = c.expected_ids ?? [];
        const rank = ids.findIndex((id) => expected.includes(id)) + 1;
        const scopeViolations = c.slice === "scope" ? result.hits.filter((hit) => !hit.scope_flags.some((flag) => flag.startsWith("YEAR_"))).length : 0;
        rows[name].push({ id: c.id, query: c.query, expected, rank, top: ids.slice(0, 3), scope_violations: scopeViolations });
      }
      const supported = rows[name].filter((row) => row.expected.length);
      const n = supported.length || 1;
      summary[name] = {
        cases: rows[name].length,
        recall1: supported.filter((row) => row.rank === 1).length / n,
        recall5: supported.filter((row) => row.rank >= 1).length / n,
        mrr5: supported.reduce((sum, row) => sum + (row.rank ? 1 / row.rank : 0), 0) / n,
        false_positives: rows[name].filter((row) => !row.expected.length && row.top.length).length,
        scope_violations: rows[name].reduce((sum, row) => sum + row.scope_violations, 0),
        file_sha256: cases[0]?.file_sha256 ?? null,
      };
    }
    return { summary, rows };
  } finally { db.sqlite.close(); }
}

if (import.meta.url === "file:///" + process.argv[1].replace(/\\/g, "/") || process.argv[1]?.endsWith("evaluate-faq-paraphrase.mjs")) {
  const arg = (flag) => { const at = process.argv.indexOf(flag); return at < 0 ? null : process.argv[at + 1]; };
  const names = (arg("--sets") ?? "dev,holdout,exact").split(",");
  const detail = new Set((arg("--detail") ?? "").split(",").filter(Boolean));
  const result = await evaluate(names);
  console.log(JSON.stringify(result.summary, null, 1));
  for (const name of detail) for (const row of result.rows[name] ?? []) if (row.rank !== 1) console.log(name, row.id, "rank=" + row.rank, row.query, "expected=" + row.expected.join("|"), "top=" + row.top.join(","));
  if (arg("--output")) writeFileSync(arg("--output"), JSON.stringify(result, null, 2));
}
