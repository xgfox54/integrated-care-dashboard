import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { EMPTY_FILTERS, filterRows, normalizeRows } from "./dataset.ts";
import { repairKnownExtractionFragments } from "./official-correction.ts";
import { applyWikiEdits } from "./wiki-edits.ts";
import { getVerifiedWikiSupplement } from "./wiki-verified-supplements.ts";

const fixtures = JSON.parse(await readFile(new URL("./fixtures/mohw/source-restoration.json", import.meta.url), "utf8"));
const rows = () => structuredClone(fixtures.map(({ live }) => live));
const structuralFields = ["subcategory", "type"];

test("saved live rows recover all 30 verified source identities without collapsing the 19 extra rows", () => {
  const input = rows();
  const unchanged = structuredClone(input);
  const normalized = normalizeRows(input);
  assert.equal(normalized.length, 30);
  assert.deepEqual(normalized.map(r => r.serviceId), input.map(r => r.serviceId));
  for (const [i, row] of normalized.entries()) {
    for (const field of structuralFields) assert.equal(row[field], fixtures[i].expected[field], `${row.serviceId}: ${field}`);
  }
  const semanticKeys = normalized.map(r => JSON.stringify([r.sido, r.sigungu, r.name, r.subcategory, r.type]));
  assert.equal(new Set(semanticKeys).size, 30);
  assert.deepEqual(input, unchanged);
  assert.equal(filterRows(normalized, {...EMPTY_FILTERS, keyword: "방문간호"}).length, 2);
  assert.equal(filterRows(normalized, {...EMPTY_FILTERS, type: "공통_연계"}).length, 6);
});

test("official correction restores distinctions before wiki edits and retains verified overview text", () => {
  const input = rows();
  const corrected = repairKnownExtractionFragments(input);
  for (const [i, row] of corrected.entries()) {
    for (const field of structuralFields) assert.equal(row[field], fixtures[i].expected[field], `${row.serviceId}: ${field}`);
    assert.equal(row.description, getVerifiedWikiSupplement(row.serviceId)?.overview ?? input[i].description);
  }
  const gimpo = input.filter(r => r.serviceId.startsWith("0085:1489600:1:"));
  for (const description of ["담당자가 수정한 안내", "", gimpo[0].description]) {
    const edits = new Map(gimpo.map(r => [r.serviceId, {
      description, target: "편집 대상", detailTarget: null, provider: "편집 기관",
      applicationMethod: "편집 신청방법", content: null, sourceTitle: null, sourceUrl: null,
    }]));
    const publicRows = normalizeRows(applyWikiEdits(corrected, edits));
    for (const row of publicRows.filter(r => edits.has(r.serviceId))) {
      assert.equal(row.description, description);
      assert.equal(row.target, "편집 대상");
      assert.equal(row.provider, "편집 기관");
      assert.equal(row.applicationMethod, "편집 신청방법");
    }
    assert.deepEqual(normalizeRows(publicRows), publicRows);
  }
});

test("verified restoration is scoped by exact service ID and source date and leaves other blank types alone", () => {
  const pyeongtaek = rows().find(r => r.serviceId === "0085:1489596:1:2:2");
  const unrelated = [
    {...pyeongtaek, serviceId: "0085:1489596:1:2:200"},
    {...pyeongtaek, updatedDate: "2026-08"},
    {...pyeongtaek, serviceId: "another-source", type: ""},
    {...pyeongtaek, serviceId: "another-source-2", type: "미분류"},
  ];
  assert.deepEqual(repairKnownExtractionFragments(unrelated), unrelated);
  for (const [i, row] of normalizeRows(unrelated).entries()) {
    assert.equal(row.subcategory, unrelated[i].subcategory);
    assert.equal(row.type, unrelated[i].type);
  }
});
