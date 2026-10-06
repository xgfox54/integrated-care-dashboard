// 문자·단위 보존(T62): 줄바꿈·첨자·부호·부등호를 지우지 않고, 정규화는 추적과 함께 한다.
import assert from "node:assert/strict";
import test from "node:test";

import { buildDocument } from "../src/normalize.mjs";

const h = (text) => ({ text, isHeader: true });
const d = (text) => ({ text });

test("유니코드 빼기는 부호로 읽고 기록하며, 부등호 값은 정확한 금액이 아니라 한계값으로 남긴다. 첨자·줄바꿈은 원문 그대로 둔다", () => {
  const { document, tables } = buildDocument({ metadata: { pageMode: "layout" }, blocks: [
    { type: "paragraph", text: "면적 30m² 이하\n소득 ≤ 50%", pageNumber: 1 },
    { type: "table", pageNumber: 1, table: { rows: 4, cols: 2, cells: [[h("구분"), h("금액(천원)")], [d("감액"), d("−1,200")], [d("상한"), d("≤ 300")], [d("면적"), d("30m²")]] } },
  ] }, "p_" + "5".repeat(32), { maxDepth: 3, maxLogicalSlots: 1000 });
  assert.equal(document.blocks[0].parsed_text_verbatim, "면적 30m² 이하\n소득 ≤ 50%");
  const cell = (text) => tables[0].cells.find((item) => item.normalized_text === text);
  assert.equal(cell("−1,200").normalized_value.value, "-1200000");
  assert.equal(cell("−1,200").normalized_value.trace[0].rule, "unicode_minus_to_hyphen");
  assert.deepEqual([cell("≤ 300").normalized_value.status, cell("≤ 300").normalized_value.comparator, cell("≤ 300").normalized_value.value], ["inequality_bound", "≤", "300000"]);
  assert.equal(cell("30m²").normalized_value, undefined, "단위가 붙은 글은 금액으로 바꾸지 않는다");
});
