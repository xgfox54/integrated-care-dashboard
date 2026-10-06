// 다단·전치·좌우 비교표(§5.13 표 규칙, T55): 머리 경로·사업 영역·행 머리 단위를 보존하고, 의미가 다른 표를 합치지 않는다.
import assert from "node:assert/strict";
import test from "node:test";

import { buildDocument } from "../src/normalize.mjs";

const LIMITS = { maxDepth: 3, maxLogicalSlots: 10_000 };
const h = (text, extra = {}) => ({ text, isHeader: true, ...extra });
const d = (text) => ({ text });
const table = (rows) => ({ type: "table", pageNumber: 1, table: { rows: rows.length, cols: Math.max(...rows.map((row) => row.length)), cells: rows } });
const build = (blocks) => buildDocument({ metadata: { pageMode: "layout" }, blocks }, "p_" + "2".repeat(32), LIMITS).tables;

test("행 머리열 표(전치)는 행 머리 경로를 셀에 붙이고, 행 머리의 단위로 금액을 정규화한다", () => {
  const [t] = build([table([
    [h("구분"), h("가 사업"), h("나 사업")],
    [h("월 한도(천원)"), d("30"), d("1,200")],
    [h("대상"), d("노인"), d("장애인")],
  ])]);
  assert.equal(t.orientation, "two_axis");
  assert.equal(t.row_header_columns, 1);
  const cell = t.cells.find((c) => c.normalized_text === "1,200");
  assert.deepEqual(cell.row_header_path, ["월 한도(천원)"]);
  assert.deepEqual(cell.header_path, ["나 사업"]);
  assert.equal(cell.normalized_value.value, "1200000");
  assert.equal(t.cells.find((c) => c.normalized_text === "대상").row_role, "row_header");
  const [only] = build([table([[h("월 한도(천원)"), d("30")], [h("대상"), d("노인")]])]);
  assert.equal(only.orientation, "row_headed");
});

test("같은 열 이름 묶음이 좌우로 반복되면 사업 영역을 나누고, 반복이 아니면 나누지 않는다", () => {
  const [side] = build([table([
    [h("2025년", { colSpan: 2 }), null, h("2026년", { colSpan: 2 }), null],
    [h("사업"), h("금액(천원)"), h("사업"), h("금액(천원)")],
    [d("가"), d("10"), d("가"), d("12")],
  ])]);
  assert.deepEqual(side.column_regions.map((region) => [region.columns, region.upper_labels]), [[[0, 1], ["2025년"]], [[2, 3], ["2026년"]]]);
  const twelve = side.cells.find((c) => c.normalized_text === "12");
  assert.equal(twelve.region_index, 1);
  assert.deepEqual(twelve.header_path, ["2026년", "금액(천원)"]);
  assert.equal(twelve.normalized_value.value, "12000");
  const [plain] = build([table([[h("사업"), h("금액"), h("비고"), h("금액")], [d("가"), d("1"), d("-"), d("2")]])]);
  assert.deepEqual(plain.column_regions, [], "같은 이름이 한 번 더 있다는 것만으로는 나누지 않는다");
});
