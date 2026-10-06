import assert from "node:assert/strict";
import test from "node:test";

import { LIMITS } from "../src/limits.mjs";
import { buildDocument } from "../src/normalize.mjs";

test("중첩 표 글자는 부모 셀 글자에 다시 넣지 않고 중첩 표로만 나온다(T57)", () => {
  const inner = { rows: 1, cols: 2, cells: [[{ text: "전략1", blocks: [{ type: "paragraph", text: "전략1" }] }, { text: "전략2", blocks: [{ type: "paragraph", text: "전략2" }] }]] };
  const blocks = [{
    type: "table",
    table: { rows: 1, cols: 1, cells: [[{ text: "개요\n전략1 / 전략2", blocks: [{ type: "paragraph", text: "개요" }, { type: "table", table: inner }] }]] },
  }];
  const { tables } = buildDocument({ metadata: { pageMode: "layout", pageCount: 1 }, blocks }, "p_" + "2".repeat(32), LIMITS);
  assert.equal(tables.length, 2);
  const parent = tables.find((table) => !table.parent_cell_id);
  const child = tables.find((table) => table.parent_cell_id);
  assert.equal(parent.cells[0].parsed_text_verbatim, "개요", "부모 셀은 자기 문단만");
  assert.ok(parent.quality_flags.includes("NESTED_TABLE_TEXT_SEPARATED:0:0"));
  assert.equal(child.parent_cell_id, parent.cells[0].cell_id);
  assert.deepEqual(child.cells.map((cell) => cell.parsed_text_verbatim), ["전략1", "전략2"]);
  const all = tables.flatMap((table) => table.cells.map((cell) => cell.parsed_text_verbatim)).join("|");
  assert.equal(all.split("전략1").length - 1, 1, "같은 글자가 두 번 나오지 않는다");
});
