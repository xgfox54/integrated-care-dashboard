// 파싱 결과를 후보 추출용 청크로 나눈다(작업지시서 v5 §5.5, T31). 모델·외부 호출 없음.
// - 청크 ID는 parse_id(원문 해시에서 정해짐)와 위치로만 정한다(시각을 넣지 않음).
// - 긴 문단은 다시 나누되 숫자·단위·천 단위 구분 안에서는 자르지 않고, 조각을 이으면 원문과 같아야 한다.
// - 표는 셀을 행 단위로 묶고, 조각마다 머리행 경로(단위 포함)·제목 위치·각주를 함께 싣는다. 행을 둘로 자르지 않는다.
// - 표 뒤 각주 문단은 그 표 청크에 붙이고 본문 청크에서는 뺀다. 확인된 계속 표는 한 논리 표로 이어 나누며 반복 머리행은 원본 셀로 세되 본문에서는 뺀다.
// - 분모는 '이 파서가 낸 비어 있지 않은 문단·제목과 표 셀'이다. 원문 전체 보존율이 아니다.
import { createHash } from "node:crypto";

export const CHUNKER_VERSION = "welfare-chunker-1.1.0";
const UNIT_CHARS = "원%명세개월년일회건호kgKgmM㎡평배점시분초";
const DENOMINATOR = "parsed_units: welfare-document-v1 블록(문단·제목, 비어 있지 않음) + 표 소유 셀(비어 있지 않음). kordoc 파싱 결과를 분모로 삼은 값이며 원문 전체 보존율이 아님";

const sha = (text) => createHash("sha256").update(text).digest("hex");
/** JS(UTF-16) 위치를 유니코드 코드포인트 위치로 바꾼다. Python 문자열 자르기와 같은 단위다. */
const codePoints = (text, index) => Array.from(text.slice(0, index)).length;
export const OFFSET_UNITS = { start: "utf16_code_unit", end: "utf16_code_unit", start_cp: "unicode_code_point", end_cp: "unicode_code_point" };
const chunkId = (parseId, kind, ref, start) => "ck_" + sha([parseId, kind, ref, start].join("|")).slice(0, 20);

/** i 위치(앞 글자 text[i-1]과 뒤 글자 text[i] 사이)에서 잘라도 숫자·단위·소수·천 단위가 깨지지 않는가. */
function safeCut(text, index) {
  const before = text[index - 1] ?? "";
  const after = text[index] ?? "";
  // UTF-16 대리쌍(𝑥·이모지 등) 가운데에서는 자르지 않는다.
  if (/[\uD800-\uDBFF]/.test(before) && /[\uDC00-\uDFFF]/.test(after)) return false;
  const digit = /[0-9]/;
  if (digit.test(before) && (digit.test(after) || after === "," || after === "." || UNIT_CHARS.includes(after))) return false;
  if ((before === "," || before === ".") && digit.test(after)) return false;
  if (UNIT_CHARS.includes(before) && UNIT_CHARS.includes(after) && /[A-Za-z]/.test(before + after)) return false;
  return true;
}

/** 긴 글을 maxChars 이하 조각으로 나눈다. 문장 끝 → 공백 → 안전한 아무 위치 순으로 자를 곳을 찾는다. */
export function splitText(text, maxChars) {
  const pieces = [];
  let start = 0;
  while (text.length - start > maxChars) {
    const limit = start + maxChars;
    let cut = -1;
    for (const pattern of [/[.!?。]\s/g, /\s/g]) {
      for (let index = limit; index > start + Math.floor(maxChars / 2); index -= 1) {
        pattern.lastIndex = index - 1;
        const match = pattern.exec(text);
        if (match && match.index === index - 1 && safeCut(text, index)) {
          cut = index;
          break;
        }
      }
      if (cut > 0) break;
    }
    if (cut < 0) for (let index = limit; index > start; index -= 1) if (safeCut(text, index)) { cut = index; break; }
    if (cut <= start) cut = /[\uD800-\uDBFF]/.test(text[limit - 1] ?? "") ? limit + 1 : limit;
    pieces.push({ start, end: cut });
    start = cut;
  }
  pieces.push({ start, end: text.length });
  return pieces;
}

function tableRows(table, excludedRows) {
  const rows = new Map();
  for (const cell of table.cells) {
    if (!cell.normalized_text) continue;
    const list = rows.get(cell.anchor_row) ?? [];
    list.push(cell);
    rows.set(cell.anchor_row, list);
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([row, cells]) => ({
    row, excluded: excludedRows.includes(row), header: row < table.header_rows,
    cells: cells.sort((a, b) => a.anchor_col - b.anchor_col),
  }));
}

function rowText(row, table) {
  return row.cells.map((cell) => {
    const path = row.header ? [] : (table.header_paths[cell.anchor_col]?.labels ?? []).filter(Boolean);
    return (path.length ? path.join(" > ") + ": " : "") + cell.normalized_text;
  }).join(" | ");
}

/**
 * @param {{ document: object, tables: object[], maxChars?: number }} input
 * @returns {{ chunker_version: string, parse_id: string, max_chars: number, chunks: object[], coverage: object }}
 */
export function chunkDocument({ document, tables, maxChars = 2000 }) {
  const parseId = document.parse_id;
  const chunks = [];
  const footnotePointers = new Set(tables.flatMap((table) => table.footnote_refs.map((ref) => ref.ir_pointer)));
  const groupOf = new Map();
  for (const group of document.logical_tables ?? []) for (const id of group.fragments) groupOf.set(id, group);
  const tableById = new Map(tables.map((table) => [table.table_id, table]));

  // 본문: 이어진 문단·제목을 maxChars까지 모으고, 넘는 문단은 다시 나눈다. 가장 가까운 제목을 문맥으로 붙인다.
  let heading = null;
  let buffer = [];
  const flush = () => {
    if (!buffer.length) return;
    const first = buffer[0];
    chunks.push({
      chunk_id: chunkId(parseId, "text", first.ref_id, first.start), kind: "text", parse_id: parseId,
      context: { heading: heading?.text ?? null, heading_ref: heading?.ref_id ?? null },
      spans: buffer.map(({ ref_id, ir_pointer, start, end, source }) => ({ ref_id, ir_pointer, start, end, start_cp: codePoints(source, start), end_cp: codePoints(source, end) })),
      text: buffer.map((part) => part.text).join("\n"),
    });
    buffer = [];
  };
  for (const block of document.blocks) {
    if (block.type === "table") {
      flush();
      continue;
    }
    const text = block.parsed_text_verbatim ?? "";
    if (!text.trim() || footnotePointers.has(block.ir_pointer)) continue;
    if (block.type === "heading") {
      flush();
      heading = { text, ref_id: block.block_id };
    }
    for (const piece of splitText(text, maxChars)) {
      const part = { ref_id: block.block_id, ir_pointer: block.ir_pointer, start: piece.start, end: piece.end, text: text.slice(piece.start, piece.end), source: text };
      const size = buffer.reduce((sum, item) => sum + item.text.length + 1, 0);
      if (buffer.length && size + part.text.length > maxChars) flush();
      buffer.push(part);
      if (piece.end - piece.start >= maxChars) flush();
    }
  }
  flush();

  // 표: 상위 표마다(확인된 계속 표는 논리 표 하나로) 행 단위로 나눈다. 조각마다 머리행 경로·제목·각주를 싣는다.
  const done = new Set();
  for (const table of tables) {
    if (done.has(table.table_id)) continue;
    const group = groupOf.get(table.table_id);
    const fragments = group ? group.fragments.map((id) => tableById.get(id)) : [table];
    fragments.forEach((fragment) => done.add(fragment.table_id));
    const head = fragments[0];
    const context = {
      logical_table_id: group?.logical_table_id ?? null,
      fragments: fragments.map((fragment) => fragment.table_id),
      parent_cell_id: head.parent_cell_id,
      caption_refs: fragments.flatMap((fragment) => fragment.caption_refs),
      header_paths: head.header_paths.map((path) => path.labels.filter(Boolean).join(" > ")),
      footnotes: fragments.flatMap((fragment) => fragment.footnote_refs.map((ref) => ({ ir_pointer: ref.ir_pointer, text: ref.text }))),
    };
    const rows = fragments.flatMap((fragment) => {
      const excluded = group?.analysis_excluded_rows.find((item) => item.table_id === fragment.table_id)?.rows ?? [];
      return tableRows(fragment, excluded).map((row) => ({ ...row, table: fragment }));
    });
    const contextSize = JSON.stringify(context).length;
    let piece = [];
    let size = 0;
    const emit = () => {
      if (!piece.length && rows.length) return;
      const first = piece[0];
      chunks.push({
        chunk_id: chunkId(parseId, "table", head.table_id, first ? first.table.table_id + ":" + first.row : "empty"), kind: "table", parse_id: parseId, context,
        spans: piece.flatMap((row) => row.cells.map((cell) => ({ ref_id: cell.cell_id, ir_pointer: cell.source_refs?.[0]?.ir_pointer ?? null, table_id: row.table.table_id, row: row.row, analysis_excluded: row.excluded }))),
        text: piece.filter((row) => !row.excluded).map((row) => rowText(row, row.table)).join("\n"),
        // 행 하나가 한도보다 길면 행을 자르지 않고 한도 초과를 표시한다(검토·모델 입력 때 따로 다룸).
        ...(piece.length === 1 && contextSize + size > maxChars ? { oversize: "single_row_exceeds_max_chars" } : {}),
      });
      piece = [];
      size = 0;
    };
    for (const row of rows) {
      const length = rowText(row, row.table).length + 1;
      if (piece.length && contextSize + size + length > maxChars) emit();
      piece.push(row);
      size += length;
    }
    emit();
  }
  return { chunker_version: CHUNKER_VERSION, parse_id: parseId, max_chars: maxChars, offset_units: OFFSET_UNITS, chunks, coverage: verifyCoverage({ document, tables, chunks }) };
}

/** 분모 단위가 모두 정확히 한 번 덮였는지 본다. 문단은 글자 구간, 셀은 셀 ID 기준. 빠진 것·겹친 것을 돌려준다. */
export function verifyCoverage({ document, tables, chunks }) {
  const textUnits = document.blocks.filter((block) => block.type !== "table" && (block.parsed_text_verbatim ?? "").trim());
  const footnotePointers = new Set(tables.flatMap((table) => table.footnote_refs.map((ref) => ref.ir_pointer)));
  const footnoteCovered = new Set(chunks.flatMap((chunk) => (chunk.context?.footnotes ?? []).map((note) => note.ir_pointer)));
  const cellUnits = tables.flatMap((table) => table.cells.filter((cell) => cell.normalized_text).map((cell) => cell.cell_id));
  const spans = new Map();
  const cells = new Map();
  for (const chunk of chunks) for (const span of chunk.spans) {
    if (span.start !== undefined) spans.set(span.ref_id, [...(spans.get(span.ref_id) ?? []), [span.start, span.end]]);
    else cells.set(span.ref_id, (cells.get(span.ref_id) ?? 0) + 1);
  }
  const missing = [];
  const overlapping = [];
  for (const block of textUnits) {
    if (footnotePointers.has(block.ir_pointer)) {
      if (!footnoteCovered.has(block.ir_pointer)) missing.push(block.block_id);
      continue;
    }
    const ranges = (spans.get(block.block_id) ?? []).sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    for (const [start, end] of ranges) {
      if (start < cursor) overlapping.push(block.block_id);
      if (start > cursor) break;
      cursor = Math.max(cursor, end);
    }
    if (cursor < block.parsed_text_verbatim.length) missing.push(block.block_id);
  }
  for (const id of cellUnits) {
    const count = cells.get(id) ?? 0;
    if (count === 0) missing.push(id);
    if (count > 1) overlapping.push(id);
  }
  const total = textUnits.length + cellUnits.length;
  return {
    denominator: DENOMINATOR, units_total: total, units_covered: total - new Set(missing).size, missing, overlapping,
    status: total === 0 ? "EMPTY_DOCUMENT" : missing.length || overlapping.length ? "INCOMPLETE" : "COMPLETE",
  };
}
