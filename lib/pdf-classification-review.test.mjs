import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { compact, kordocMatches, geometryMatches, compareSourceCells } from "../scripts/data-quality/source-table-review.mjs";
import { alignToRepositoryTaxonomy, correctFromRepositoryBaseline } from "./official-correction.ts";
import { readMohwSeed } from "./mohw-seed.ts";
import { readRepositoryBaseline } from "./repository-baseline.ts";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/mohw/pdf-classification-cells-20261015.json", import.meta.url), "utf8"));
function cells(id, name, field, overrideId = id) {
  const fixture = fixtures[id];
  const names = [compact(name)];
  const k = kordocMatches({ ...fixture.kordoc, document_id: overrideId }, fixture.page, names);
  const g = geometryMatches({ ...fixture.geometry, document_id: overrideId }, fixture.page, names);
  return { k, g, comparison: compareSourceCells(k, g, field) };
}

test("Given adjacent method and type columns When source cells are compared Then municipal scope comes from type alone", () => {
  const { comparison } = cells("0076:1489558:1", "방문운동", "type");
  assert.equal(comparison.agreed, true);
  assert.equal(compact(comparison.geometry.text), "시특화");
  assert.equal(compact(comparison.geometry.header), "유형");
});

test("Given an open outer type border When explicit header and closed business row agree Then the source label is verified", () => {
  const { comparison } = cells("0077:1489748:1", "가사지원서비스", "type");
  assert.equal(comparison.agreed, true);
  assert.equal(compact(comparison.geometry.text), "지자체");
  assert.equal(comparison.geometry.method, "EXPLICIT_HEADER_AND_CLOSED_NAME_ROW");
});

test("Given a reviewed mislabelled page header When that exact document is used Then only its explicit classification values are read", () => {
  const original = cells("0085:1489598:1", "찾아가는 돌봄의료센터", "type").comparison;
  assert.equal(original.agreed, true);
  assert.equal(compact(original.geometry.text), "지역특화경기도");
  assert.equal(cells("0085:1489598:1", "찾아가는 돌봄의료센터", "type", "unreviewed-document").comparison.agreed, false);
});

test("Given a physically merged subcategory When its row span is confirmed Then the source wording reaches the business in that cell", () => {
  const { comparison } = cells("0083:1489622:1", "초록기억 시나미카페", "subcategory");
  assert.equal(comparison.agreed, true);
  assert.equal(comparison.kordoc.inherited, true);
  assert.equal(compact(comparison.geometry.text), "느린마을치매친화");
});

test("Given several printed subcategories for one business When both parsers confirm the complete cell Then all three are preserved", () => {
  const { comparison } = cells("0085:1489590:1", "누구나돌봄", "subcategory");
  assert.equal(comparison.agreed, true);
  assert.equal(compact(comparison.geometry.text), "생활지원이동지원식사지원");
  assert.ok(comparison.kordoc.combined_rows > 1);
});

test("Given a source without a subcategory column When inspected Then no category is guessed from its business name", () => {
  const { comparison } = cells("0091:1489708:1", "장기요양 재택의료센터", "subcategory");
  assert.equal(comparison.agreed, false);
  assert.equal(comparison.geometry, null);
  assert.equal(comparison.kordoc, null);
});

test("Given duplicate exact names with conflicting source types When compared Then a correction is rejected", () => {
  const { k, g } = cells("0076:1489558:1", "방문운동", "type");
  const conflict = { ...g[0], fields: { ...g[0].fields, type: { ...g[0].fields.type, text: "전국" } } };
  assert.equal(compareSourceCells(k, [...g, conflict], "type").agreed, false);
});

test("Given formatting markup When matching headers Then presentation tags are removed and business qualifiers remain", () => {
  assert.equal(compact("<u>사업</u>구분"), "사업구분");
  assert.equal(compact("<필수>지원사업"), "필수지원사업");
});

test("Given the next official ingestion When all reviewed corrections run Then newly verified subcategories survive repository taxonomy", () => {
  const report = JSON.parse(readFileSync(new URL("../docs/data-quality/classification-restorations-20261015-v2.json", import.meta.url), "utf8"));
  const seed = readMohwSeed();
  const baseline = readRepositoryBaseline();
  const rows = alignToRepositoryTaxonomy(correctFromRepositoryBaseline(seed.documents.flatMap((entry) => entry.services), baseline), baseline);
  for (const change of report.rows.filter((row) => row.field === "subcategory")) {
    assert.equal(rows.find((row) => row.serviceId === change.service_id)?.subcategory, change.value, change.service_id);
  }
});
