import test from "node:test";
import assert from "node:assert/strict";
import { reviewedMappings } from "../review-department-bulk.mjs";
import { budgetDepartmentLabel } from "../../../components/budget/budget-departments.ts";

function fixture() {
  const mappings = [{ department_code: "100", evidence: [1, 2].map(page => ({ document: { document_id: "pdf", page } })) }];
  const sheets = [
    { path: "h1", kind: "headers", sha256: "a", codes: ["100"], pages: ["pdf:1"] },
    { path: "h2", kind: "headers", sha256: "b", codes: ["100"], pages: ["pdf:2"] },
    { path: "r1", kind: "representatives", sha256: "c", codes: ["100"], pages: ["pdf:1"] },
  ];
  return { mappings, manifest: { sha256: "manifest", sheets }, receipt: { manifest_sha256: "manifest", sheets: sheets.map(s => ({ ...s, result: "PASS" })) } };
}

test("requires both every evidence header and a full representative review", () => {
  const f = fixture();
  assert.equal(reviewedMappings(f.mappings, f.manifest, f.receipt).approved.length, 1);
  for (const missing of ["h1", "h2", "r1"]) {
    const result = reviewedMappings(f.mappings, f.manifest, { ...f.receipt, sheets: f.receipt.sheets.filter(s => s.path !== missing) });
    assert.equal(result.approved.length, 0);
    assert.equal(result.held[0].reason, "VISUAL_COVERAGE_INCOMPLETE");
  }
});

test("rejects a receipt from another manifest", () => {
  const f = fixture();
  assert.throws(() => reviewedMappings(f.mappings, f.manifest, { ...f.receipt, manifest_sha256: "old" }), /exact manifest/);
});

test("changed sheet bytes or nonpassing inspection cannot authorize a mapping", () => {
  for (const change of [{ sha256: "changed" }, { result: "PENDING" }]) {
    const f = fixture();
    Object.assign(f.receipt.sheets[1], change);
    assert.equal(reviewedMappings(f.mappings, f.manifest, f.receipt).approved.length, 0);
  }
});

test("explicit ambiguity hold overrides complete visual coverage", () => {
  const f = fixture();
  f.receipt.held = [{ code: "100", reason: "district name ambiguous" }];
  assert.deepEqual(reviewedMappings(f.mappings, f.manifest, f.receipt), { approved: [], held: f.receipt.held });
});

test("another code's representative does not approve this code", () => {
  const f = fixture();
  f.manifest.sheets[2].codes = ["200"];
  assert.equal(reviewedMappings(f.mappings, f.manifest, f.receipt).approved.length, 0);
});

test("new Yongin names resolve only their verified snapshot; held codes stay unknown", () => {
  assert.equal(budgetDepartmentLabel("경기용인시", "1001003", "2026", "2026-10-02"), "재산관리과 (1001003)");
  for (const args of [
    ["경기용인시", "1001003", "2026", "2026-10-04"],
    ["경기용인시", "1001003", "2025", "2026-10-02"],
    ["용인시", "1001003", "2026", "2026-10-02"],
    ["수원시", "1001003", "2026", "2026-10-02"],
    ["경기용인시", "3005010", "2026", "2026-10-02"],
    ["경기용인시", "1015030", "2026", "2026-10-02"],
  ]) assert.match(budgetDepartmentLabel(...args), /명칭 미확인/u);
});
