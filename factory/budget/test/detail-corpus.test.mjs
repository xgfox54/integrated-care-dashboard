import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { checkRanges, detailHolds } from "../build-detail-corpus.mjs";
import { buildBudgetPack } from "../build-budget-pack.mjs";
import { validateBudgetPack } from "../../../lib/imports/budget-pack.ts";
import { readZip } from "../../../lib/imports/zip.ts";

test("complete source page ranges reject gaps, overlaps and probe-only coverage", () => {
  assert.equal(checkRanges([{ first: 1, last: 250, pageCount: 563 }, { first: 251, last: 500, pageCount: 563 }, { first: 501, last: 563, pageCount: 563 }], 563), true);
  for (const ranges of [[], [{ first: 1, last: 1, pageCount: 563 }], [{ first: 2, last: 563, pageCount: 563 }], [{ first: 1, last: 250, pageCount: 563 }, { first: 250, last: 563, pageCount: 563 }]]) assert.equal(checkRanges(ranges, 563), false);
});

test("publication holds preserve extraction errors and review-only defects", () => {
  const result = detailHolds({ problems: [{ code: "SOURCE_ERROR" }], lines: [{ line_no: 1, level: "item", amount_thousand_krw: null,
    checks: { funding_sum: "partial_or_mismatch", name_fragment_rejoined: "unplaced_no_evidence", formula: "not_computable", children_sum: "incomplete" } }] });
  assert.deepEqual(result.map(row => row.code), ["SOURCE_ERROR", "MISSING_AMOUNT", "FUNDING_SUM_REVIEW", "NAME_FRAGMENT_REVIEW", "FORMULA_NOT_COMPUTABLE", "CHILDREN_INCOMPLETE"]);
});

const reportFile = process.env.BUDGET_DETAIL_REPORT;
if (reportFile) test("saved corpus bundles validate and resolve every line to original source evidence", async () => {
  const report = JSON.parse(readFileSync(reportFile));
  assert.equal(report.counts.documents, 58);
  assert.equal(report.counts.documents, report.counts.validated + report.counts.held + report.counts.already_public);
  assert.ok(report.bundles.length > 0);
  assert.equal(report.documents.find(document => document.id === "yongin-2026-3766-8").status, "ALREADY_PUBLIC");
  assert.ok(!report.bundles.some(bundle => bundle.id === "yongin-2026-3766-8"));
  for (const record of report.documents) {
    assert.ok(statSync(record.lines_json).size > 0);
    if (record.status === "HELD") assert.ok(record.problems.length > 0);
  }
  for (const bundle of report.bundles) {
    const bytes = readFileSync(bundle.bundle);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), bundle.sha256);
    const rebuilt = await buildBudgetPack(JSON.parse(readFileSync(bundle.config)));
    assert.equal(rebuilt.sha256, bundle.sha256, "rebuilding the saved config must reproduce identical bundle bytes");
    const entries = await readZip(bytes);
    const manifest = JSON.parse(new TextDecoder().decode(entries.find(entry => entry.path === "manifest.json").bytes));
    const validated = await validateBudgetPack(entries, manifest);
    assert.equal(validated.ok, true, JSON.stringify(validated.problems));
    const record = report.documents.find(document => document.id === bundle.id);
    const provenance = JSON.parse(readFileSync(path.join(record.evidence_dir, "provenance.json")));
    const originals = provenance.parsedInputs.flatMap(input => JSON.parse(readFileSync(path.join(input.directory, "document.json"))).blocks);
    const originalTables = provenance.parsedInputs.flatMap(input => readFileSync(path.join(input.directory, "tables.jsonl"), "utf8").trim().split("\n").map(JSON.parse));
    const byBlock = new Map(originals.map(block => [block.block_id, block]));
    const byTable = new Map(originalTables.map(table => [table.table_id, table]));
    for (const line of validated.pack.lines) {
      assert.equal(byBlock.get(line.block_id)?.page, line.page);
      assert.ok(byTable.get(line.table_id)?.cells.some(cell => cell.anchor_row === line.row_index));
    }
    const tampered = entries.map(entry => entry.path === "data/budget/lines.jsonl" ? { ...entry, bytes: Uint8Array.from([...entry.bytes, 32]) } : entry);
    assert.equal((await validateBudgetPack(tampered, manifest)).ok, false);
  }
  const audit = JSON.parse(readFileSync(report.input_integrity));
  for (const input of audit) {
    assert.equal(input.unchanged, true);
    assert.equal(createHash("sha256").update(readFileSync(input.file)).digest("hex"), input.sha256);
  }
});
