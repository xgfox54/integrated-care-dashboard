import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(process.argv[2] ?? ".omo/evidence/budget-departments-20261006");
const read = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8").replace(/^\uFEFF/, ""));
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const normalized = (s) => s.normalize("NFC").replace(/\s+/gu, "");
const downloads = read("downloads.json"), report = read("matches.json");
const allDisplayed = JSON.parse(readFileSync("components/budget/budget-department-names.json", "utf8"));
const displayed = { ...allDisplayed, mappings: allDisplayed.mappings.filter((m) => m.fiscal_entity_name === "제주본청") };
const api = read("api-all.json"), apiIndex = new Map(api.items.map((r) => [r.fiscal_project_id, r]));
const tables = new Map(), pages = new Map(), pageHeaders = new Map();
for (const folder of readdirSync(path.join(root, "parsed-v2")).filter((f) => /^v\d+-\d+-\d+$/u.test(f))) {
  const summary = read(`parsed-v2/${folder}/parse-summary.json`);
  assert.equal(summary.parser, "kordoc"); assert.equal(summary.version, "4.18.13");
  assert.ok(downloads.some((s) => s.sha256 === summary.raw_sha256));
  const volume = Number(folder.match(/^v(\d+)/u)[1]);
  for (const block of read(`parsed-v2/${folder}/document.json`).blocks) {
    if (block.table_id) pages.set(block.table_id, block.page);
    const header = String(block.parsed_text_verbatim ?? "").match(/부서\s*[:：]\s*([^\n]+?)(?=\s+정책\s*[:：]|\s+단위\s*[:：]|$)/u);
    if (header) { const key = volume + ":" + block.page; const values = pageHeaders.get(key) ?? new Set(); values.add(normalized(header[1])); pageHeaders.set(key, values); }
  }
  for (const line of readFileSync(path.join(root, "parsed-v2", folder, "tables.jsonl"), "utf8").trim().split("\n").filter(Boolean)) { const table = JSON.parse(line); tables.set(table.table_id, table); }
}
for (const source of downloads) assert.equal(hash(source.file), source.sha256);
let checked = 0;
for (const entry of displayed.mappings) {
  const mapping = report.mappings.find((m) => m.department_code === entry.department_code && m.reference_date === entry.reference_date && m.fiscal_entity_name === entry.fiscal_entity_name);
  assert.ok(mapping); assert.equal(mapping.department_name, entry.department_name);
  assert.ok(new Set(mapping.evidence.map((e) => normalized(e.name))).size >= 2);
  for (const evidence of mapping.evidence) {
    const row = apiIndex.get(evidence.project_id), doc = evidence.document;
    assert.equal(row.department_code, entry.department_code); assert.equal(row.reference_date, entry.reference_date);
    assert.equal(row.fiscal_year, entry.fiscal_year); assert.equal(row.fiscal_entity.name, entry.fiscal_entity_name);
    assert.equal(row.current_budget_krw, doc.amount_krw); assert.equal(row.account.code, doc.account_code);
    const table = tables.get(doc.table_id), cols = table.logical_columns;
    const cells = table.cells.filter((c) => c.anchor_row === doc.row);
    const name = cells.filter((c) => c.anchor_col < cols - 3).sort((a, b) => a.anchor_col - b.anchor_col).map((c) => c.parsed_text_verbatim ?? "").join(" ");
    const amount = cells.find((c) => c.anchor_col === cols - 3).parsed_text_verbatim.split("\n")[0].trim();
    assert.equal(normalized(name), normalized(row.name)); assert.equal((BigInt(amount.replaceAll(",", "")) * 1000n).toString(), row.current_budget_krw);
    assert.equal(pages.get(doc.table_id), doc.page);
    assert.deepEqual([...pageHeaders.get(doc.volume + ":" + doc.page)], [entry.department_name]);
    assert.equal(doc.department_basis, "explicit_same_page_department_and_toc");
    const anchor = report.anchors.find((a) => a.volume === doc.volume && a.department_name === entry.department_name && a.first <= doc.page && doc.page <= a.last);
    assert.ok(anchor); assert.ok(tables.get(anchor.table_id).cells.some((c) => c.anchor_row === 1 && normalized(c.parsed_text_verbatim ?? "") === entry.department_name));
    checked++;
  }
}
const typecheck = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "false"], { encoding: "utf8", windowsHide: true });
writeFileSync(path.join(root, "typecheck-result.json"), JSON.stringify({ invocation: "node node_modules/typescript/bin/tsc --noEmit --incremental false", exit_code: typecheck.status, stdout: typecheck.stdout, stderr: typecheck.stderr }, null, 2));
assert.equal(typecheck.status, 0);
const national = read("national-filters.json").filters, jeju = read("jeju-filters.json").filters;
const missing = national.departments.filter((d) => !displayed.mappings.some((m) => m.fiscal_entity_name === d.fiscal_entity_name && m.department_code === d.code));
const missingDocuments = national.entities.filter((e) => !["lofin:laf:4900000", "admin:4900000:3", "admin:4900000:4"].includes(e.id));
const coverage = {
  basis: "Captured public social_welfare filter inventory; units include local governments and admin units. Counts are unit scopes, not an assumed number of PDF files.",
  national_local_governments_known: national.entities.filter((e) => e.kind === "local_government").length,
  national_local_governments_with_rows: national.entities.filter((e) => e.kind === "local_government" && e.project_count > 0).length,
  national_admin_units_known: national.entities.filter((e) => e.kind === "admin_unit").length,
  national_social_department_codes: national.departments.length, national_unresolved_social_codes: missing.length,
  jeju_social_department_codes: jeju.departments.length, jeju_social_resolved: jeju.departments.filter((d) => displayed.mappings.some((m) => m.department_code === d.code)).length,
  jeju_displayed_mappings: displayed.mappings.length, independent_evidence_rows: checked,
  downloaded_and_verified_this_attempt: downloads.length, verified_document_unit_scopes: 3,
  unit_scopes_without_document_verified_this_attempt: missingDocuments.length,
  missing_document_unit_scopes: missingDocuments,
  limitations: ["Existing Yongin budget files were found but not re-downloaded in this attempt; the unit gap counts unverified material, not physical file absence.", "The number of additional PDF/HWP files is unknown until each publisher's 2026 document list is inventoried.", "No production DB writes, deployment or commit; static reviewed UI mapping only; original API department_name remains null.", "Dedicated department-name administrator import/activation pipeline is not implemented. Existing budget-document import stores document facts, not this code mapping."]
};
writeFileSync(path.join(root, "coverage.json"), JSON.stringify(coverage, null, 2));
const result = { pass: true, invocation: "node factory/budget/verify-department-evidence.mjs .omo/evidence/budget-departments-20261006", downloads_sha256_verified: downloads.length, mapped_codes: displayed.mappings.length, evidence_rows_checked_against_source_cells_and_api: checked, typecheck_exit: typecheck.status };
writeFileSync("docs/acceptance/budget-department-matches-20261006.json", JSON.stringify({ rule: "Explicit same-page department + confirmed TOC anchor; no page carryforward; exact unique project name and positive amount; 2 independent names; reject conflicts", result, mappings: report.mappings.filter((m) => displayed.mappings.some((d) => d.department_code === m.department_code)), held: report.held, excluded_pages: report.skipped_anchors }, null, 2));
writeFileSync(path.join(root, "evidence-check.json"), JSON.stringify(result, null, 2));
const artifacts = ["downloads.json", "api-all.json", "api-social_welfare.json", "api-health.json", "api-integrated_care.json", "national-filters.json", "matches.json", "coverage.json", "tests.log", "typecheck-result.json", "evidence-check.json", "ui-result.json", "ui-mapped.png", "ui-unknown.png"];
writeFileSync(path.join(root, "artifact-hashes.json"), JSON.stringify(artifacts.map((file) => { const full = path.join(root, file); assert.ok(statSync(full).size > 0); return { path: full, bytes: statSync(full).size, sha256: hash(full) }; }), null, 2));
console.log(JSON.stringify(result));
