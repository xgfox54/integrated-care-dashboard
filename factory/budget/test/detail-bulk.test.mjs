import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { completeDepartmentPages } from "../build-bulk-detail.mjs";
import { completeDepartment } from "../build-detail-department.mjs";
import { extractBudgetLines } from "../extract-budget-lines.mjs";
import { buildBudgetPack } from "../build-budget-pack.mjs";
import { readZip } from "../../../lib/imports/zip.ts";
import { validateBudgetPack } from "../../../lib/imports/budget-pack.ts";

test("a complete department rejects page gaps, damaged continuations and missing source tables", () => {
  const audit = [902, 903].map(page => ({ page, department: "권선구사회복지과", verified: true }));
  const parsed = { blocks: audit.map(row => ({ page: row.page, table_id: "t" + row.page })), tables: audit.map(row => ({ table_id: "t" + row.page })) };
  assert.deepEqual(completeDepartmentPages(parsed, audit, "권선구사회복지과").page_range, { first: 902, last: 903 });
  assert.throws(() => completeDepartmentPages(parsed, [audit[0], { ...audit[1], verified: false }], "권선구사회복지과"), /continuation/);
  assert.throws(() => completeDepartmentPages(parsed, [audit[0], { ...audit[1], page: 904 }], "권선구사회복지과"), /contiguous/);
  assert.throws(() => completeDepartmentPages({ ...parsed, tables: parsed.tables.slice(1) }, audit, "권선구사회복지과"), /every source table/);
  assert.throws(() => completeDepartmentPages({ ...parsed, blocks: parsed.blocks.slice(1) }, audit, "권선구사회복지과"), /every audited/);
});

const json = file => JSON.parse(readFileSync(file));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const reportFile = process.env.BUDGET_BULK_DETAIL_REPORT;
if (reportFile) test("real Suwon packs retain every source row, reproduce exact ZIPs and preserve held documents", async () => {
  const report = json(reportFile);
  assert.deepEqual(report.counts, { validated: 2, held: 9, lines: 160 });
  for (const record of report.documents) if (record.status === "HELD") {
    assert.ok(record.problems.length);
    const id = "suwon-2026-dept-" + digest(Buffer.from(record.department)).slice(0, 12);
    const extraction = json(path.join(path.dirname(reportFile), id, "extraction.json"));
    assert.throws(() => completeDepartment(extraction, record.department), /entire selected department/, "held source errors must remain reproducible");
  }
  for (const bundle of report.bundles) {
    const config = json(bundle.config), document = config.documents[0];
    const original = extractBudgetLines(document.parse_dir);
    assert.deepEqual(json(document.lines_json).lines, original.lines, "no original descendants may be deleted or adjusted");
    const bytes = readFileSync(bundle.bundle);
    assert.equal(digest(bytes), bundle.sha256);
    assert.equal((await buildBudgetPack(config)).sha256, bundle.sha256);
    const entries = await readZip(bytes);
    const manifest = JSON.parse(new TextDecoder().decode(entries.find(entry => entry.path === "manifest.json").bytes));
    const validated = await validateBudgetPack(entries, manifest);
    assert.equal(validated.ok, true);
    const blocks = new Map(json(path.join(document.parse_dir, "document.json")).blocks.map(block => [block.block_id, block]));
    const tables = new Map(readFileSync(path.join(document.parse_dir, "tables.jsonl"), "utf8").trim().split("\n").map(row => { const table = JSON.parse(row); return [table.table_id, table]; }));
    for (const line of validated.pack.lines) {
      assert.equal(blocks.get(line.block_id)?.page, line.page);
      assert.ok(tables.get(line.table_id)?.cells.some(cell => cell.anchor_row === line.row_index));
    }
    const changed = entries.map(entry => entry.path === "data/budget/lines.jsonl" ? { ...entry, bytes: Uint8Array.from([...entry.bytes, 32]) } : entry);
    assert.equal((await validateBudgetPack(changed, manifest)).ok, false);
  }
  for (const input of json(path.join(path.dirname(reportFile), "input-integrity.json"))) assert.equal(digest(readFileSync(input.file)), input.sha256);
});
