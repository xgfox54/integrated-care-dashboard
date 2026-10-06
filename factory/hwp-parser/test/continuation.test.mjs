// 계속 표·반복 머리행 연결 규칙(작업지시서 v5 T59, 5.13 표 규칙). 합성 IR로 경계조건을 시험한다(운영 자료 아님).
import assert from "node:assert/strict";
import test from "node:test";

import { buildDocument } from "../src/normalize.mjs";

const LIMITS = { maxDepth: 3, maxLogicalSlots: 10_000 };
const header = (labels) => labels.map((text) => ({ text, isHeader: true }));
const row = (values) => values.map((text) => ({ text }));
const table = (rows, extra = {}) => ({ type: "table", pageNumber: extra.page ?? 1, table: { rows: rows.length, cols: rows[0].length, cells: rows, ...(extra.sourceId ? { sourceId: extra.sourceId } : {}), ...(extra.caption ? { caption: extra.caption } : {}) } });
const paragraph = (text) => ({ type: "paragraph", text, pageNumber: 1 });
const build = (blocks) => buildDocument({ metadata: { pageMode: "layout", pageCount: 3 }, blocks }, "p_" + "0".repeat(32), LIMITS);
const HEAD = ["순번", "사업명", "금액(천원)"];

test("'(계속)' 표시가 있고 열 수·머리행이 같으면 한 표로 잇고, 반복 머리행은 분석에서만 뺀다(원본 셀은 그대로)", () => {
  const { document, tables } = build([
    table([header(HEAD), row(["1", "가 사업", "100"]), row(["2", "나 사업", "200"])]),
    paragraph(""),
    paragraph("(계속)"),
    table([header(HEAD), row(["3", "다 사업", "300"]), row(["3", "다 사업", "300"])], { page: 2 }),
  ]);
  const [first, second] = tables;
  assert.equal(first.continuation.role, "head");
  assert.equal(second.continuation.role, "continuation");
  assert.equal(second.continuation.previous_table_id, first.table_id);
  assert.ok(second.continuation.evidence.includes("marker_paragraph:/blocks/2"));
  assert.ok(second.continuation.evidence.includes("repeated_header_identical"));
  assert.equal(second.continuation.repeated_header_rows, 1);
  assert.equal(second.cells.filter((cell) => cell.anchor_row === 0).length, 3, "반복 머리행 셀을 지우지 않는다");
  assert.equal(second.cells.filter((cell) => cell.row_role === "data" && cell.normalized_text === "다 사업").length, 2, "똑같은 사업행이 두 번 있어도 지우지 않는다");
  assert.deepEqual(document.logical_tables, [{
    logical_table_id: "lt:" + first.table_id.slice(2), fragments: [first.table_id, second.table_id], columns: 3,
    analysis_excluded_rows: [{ table_id: second.table_id, rows: [0], rule: "repeated_header_identical" }],
  }]);
});

test("표시 없이 열 수·머리행만 같으면 합치지 않고 검토 표시만 남긴다", () => {
  const { document, tables } = build([
    table([header(HEAD), row(["1", "가 사업", "100"])]),
    table([header(HEAD), row(["2", "나 사업", "200"])]),
  ]);
  assert.equal(tables[1].continuation, null);
  assert.ok(tables[1].quality_flags.includes("CONTINUATION_CANDIDATE_UNCONFIRMED"));
  assert.deepEqual(document.logical_tables, []);
});

test("표시가 있어도 열 수가 다르거나, 사이에 본문 문단이 있으면 잇지 않는다", () => {
  const mismatch = build([table([header(HEAD), row(["1", "가", "1"])]), paragraph("< 계 속 >"), table([header(["순번", "사업명"]), row(["2", "나"])])]);
  assert.equal(mismatch.tables[1].continuation, null);
  assert.ok(mismatch.tables[1].quality_flags.includes("CONTINUATION_MARKER_COLUMN_MISMATCH"));
  const prose = build([table([header(HEAD), row(["1", "가", "1"])]), paragraph("계속 지원하는 사업은 다음과 같다."), table([header(HEAD), row(["2", "나", "2"])])]);
  assert.equal(prose.tables[1].continuation, null, "문장 속 '계속'은 계속 표 표시가 아니다");
});

test("순번이 1부터 다시 시작하면(별지 재번호) 표시가 있어도 잇지 않는다. 같은 원본 표 ID이면 잇되 검토 표시를 남긴다", () => {
  const restart = build([table([header(HEAD), row(["1", "가", "1"]), row(["2", "나", "2"])]), paragraph("(계속)"), table([header(HEAD), row(["1", "별지 가", "9"])])]);
  assert.equal(restart.tables[1].continuation, null);
  assert.ok(restart.tables[1].quality_flags.includes("NUMBERING_RESTART_NOT_LINKED"));
  const same = build([table([header(HEAD), row(["1", "가", "1"])], { sourceId: "7" }), table([header(HEAD), row(["1", "나", "2"])], { sourceId: "7" })]);
  assert.equal(same.tables[1].continuation.role, "continuation");
  assert.ok(same.tables[1].continuation.evidence.includes("same_source_table_id"));
  assert.ok(same.tables[1].quality_flags.includes("NUMBERING_RESTART_REVIEW"));
});

test("이어지는 표의 첫 행이 머리행 표시 없이 앞 표 머리행과 같은 글이면 지우지 않고 검토 표시만 남긴다", () => {
  const { document, tables } = build([table([header(HEAD), row(["1", "가", "1"])]), paragraph("(앞쪽에서 계속)"), table([row(HEAD), row(["2", "나", "2"])])]);
  assert.equal(tables[1].continuation.repeated_header_rows, 0);
  assert.ok(tables[1].quality_flags.includes("POSSIBLE_REPEATED_HEADER_UNMARKED"));
  assert.deepEqual(document.logical_tables[0].analysis_excluded_rows, []);
});
