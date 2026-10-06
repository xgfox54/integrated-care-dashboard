// 후보 추출용 청크(§5.5, T31): 긴 문단·숫자·단위·각주·계속 표를 잘라 버리지 않고, 빠진 단위를 검출한다.
import assert from "node:assert/strict";
import test from "node:test";

import { chunkDocument, splitText, verifyCoverage } from "../src/chunk.mjs";
import { buildDocument } from "../src/normalize.mjs";

const LIMITS = { maxDepth: 3, maxLogicalSlots: 10_000 };
const header = (labels) => labels.map((text) => ({ text, isHeader: true }));
const row = (values) => values.map((text) => ({ text }));
const table = (rows) => ({ type: "table", pageNumber: 1, table: { rows: rows.length, cols: rows[0].length, cells: rows } });
const paragraph = (text, type = "paragraph") => ({ type, text, pageNumber: 1 });
const parse = (blocks) => {
  const { document, tables } = buildDocument({ metadata: { pageMode: "layout", pageCount: 2 }, blocks }, "p_" + "1".repeat(32), LIMITS);
  return { document, tables };
};

test("긴 문단은 다시 나누되 숫자·천 단위·단위 안에서 자르지 않고, 조각을 이으면 원문과 같다", () => {
  const text = "지원금액은 1인당 월 1,234,567원이며 대상은 만 65세 이상 어르신입니다. ".repeat(12) + "끝 문장 3.5% 인상";
  const pieces = splitText(text, 90);
  assert.equal(pieces.map((piece) => text.slice(piece.start, piece.end)).join(""), text);
  for (const piece of pieces.slice(0, -1)) {
    const before = text[piece.end - 1];
    const after = text[piece.end];
    assert.ok(!(/[0-9,.]/.test(before) && /[0-9,.원%세]/.test(after)), "숫자·단위 경계에서 자름: " + before + "|" + after);
    assert.ok(piece.end - piece.start <= 90);
  }
  const { document, tables } = parse([paragraph("안내", "heading"), paragraph(text)]);
  const result = chunkDocument({ document, tables, maxChars: 90 });
  assert.equal(result.coverage.status, "COMPLETE");
  assert.ok(result.chunks.filter((chunk) => chunk.kind === "text").every((chunk) => chunk.context.heading === "안내"));
});

test("표 뒤 각주는 표 청크에 붙고 본문 청크에는 없으며, 표 조각마다 머리행·단위 문맥을 싣고 행을 자르지 않는다", () => {
  const rows = [header(["구분", "월 한도(천원)"]), ...Array.from({ length: 30 }, (_, index) => row(["사업 " + (index + 1), String((index + 1) * 10)]))];
  const { document, tables } = parse([table(rows), paragraph("※ 사업 3은 연 1회 지급"), paragraph("다음 안내")]);
  const result = chunkDocument({ document, tables, maxChars: 300 });
  const tableChunks = result.chunks.filter((chunk) => chunk.kind === "table");
  assert.ok(tableChunks.length > 1, "큰 표를 여러 조각으로 나눔");
  for (const chunk of tableChunks) {
    assert.deepEqual(chunk.context.header_paths, ["구분", "월 한도(천원)"]);
    assert.equal(chunk.context.footnotes[0].text, "※ 사업 3은 연 1회 지급");
    const rowsInChunk = new Set(chunk.spans.map((span) => span.row));
    for (const rowIndex of rowsInChunk) assert.equal(chunk.spans.filter((span) => span.row === rowIndex).length, rowIndex === 0 ? 2 : 2, "한 행의 셀이 한 청크에 모두");
    assert.match(chunk.text, /월 한도\(천원\): \d+/);
  }
  assert.ok(!result.chunks.some((chunk) => chunk.kind === "text" && chunk.text.includes("연 1회 지급")), "각주는 본문 청크로 새지 않음");
  assert.equal(result.coverage.status, "COMPLETE");
});

test("확인된 계속 표는 한 논리 표로 나누고 반복 머리행은 원본 셀로 세되 본문에서는 뺀다", () => {
  const head = ["순번", "사업명", "금액"];
  const { document, tables } = parse([table([header(head), row(["1", "가", "10"])]), paragraph("(계속)"), table([header(head), row(["2", "나", "20"])])]);
  const result = chunkDocument({ document, tables, maxChars: 2000 });
  const tableChunks = result.chunks.filter((chunk) => chunk.kind === "table");
  assert.equal(tableChunks.length, 1);
  assert.equal(tableChunks[0].context.fragments.length, 2);
  assert.equal((tableChunks[0].text.match(/^순번 \| 사업명 \| 금액$/gm) ?? []).length, 1, "반복 머리행은 본문에 한 번만");
  assert.ok(tableChunks[0].spans.some((span) => span.analysis_excluded));
  assert.equal(result.coverage.status, "COMPLETE");
});

test("청크 ID는 같은 입력이면 같고, 청크 하나가 빠지면 누락으로 검출한다. 빈 문서는 손상과 구분한다", () => {
  const blocks = [paragraph("첫 문단"), table([header(["가", "나"]), row(["1", "2"])]), paragraph("둘째 문단")];
  const first = chunkDocument({ ...parse(blocks), maxChars: 500 });
  const second = chunkDocument({ ...parse(blocks), maxChars: 500 });
  assert.deepEqual(first.chunks.map((chunk) => chunk.chunk_id), second.chunks.map((chunk) => chunk.chunk_id));
  const { document, tables } = parse(blocks);
  const dropped = verifyCoverage({ document, tables, chunks: first.chunks.filter((chunk) => chunk.kind !== "table") });
  assert.equal(dropped.status, "INCOMPLETE");
  assert.equal(dropped.missing.length, 4, "표 셀 4개 누락");
  const empty = chunkDocument({ ...parse([paragraph("   ")]), maxChars: 500 });
  assert.equal(empty.coverage.status, "EMPTY_DOCUMENT");
  assert.match(first.coverage.denominator, /원문 전체 보존율이 아님/);
});
