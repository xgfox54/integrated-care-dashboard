// kordoc 결과(raw IR)를 welfare-document-v1의 문서·표·근거 위치로 바꾼다(작업지시서 v5 §5.12~5.14).
// 표 그리드는 kordoc이 병합으로 가려진 칸도 빈 셀로 채워 주므로, 앞선 소유 셀(anchor)의 span으로 가려진 칸을 직접 계산한다.
// 셀 값은 원문 문자열을 먼저 보존하고, 머리글에 단위가 명시된 경우에만 정규화 값을 만든다(근거 추적 포함).
import { sha256Hex } from "./profile.mjs";

const UNIT_FACTORS = [
  { pattern: /백만\s*원/, unit: "백만원", factor: "1000000" },
  { pattern: /천\s*원/, unit: "천원", factor: "1000" },
  { pattern: /만\s*원/, unit: "만원", factor: "10000" },
  { pattern: /(^|[^백천만])원\)?/, unit: "원", factor: "1" },
];
const TOTAL_LABEL = /^(합\s*계|소\s*계|총\s*계|계|합)$/;
const FOOTNOTE = /^\s*(※|\*|주\s*\d*\)|비고)/;

function shortId(prefix, ...parts) {
  return prefix + sha256Hex(parts.join("\u0000")).slice(0, 16);
}

/** 정수·소수 문자열에 정수 배율을 곱한다(부동소수점 없이). */
export function multiplyDecimal(value, factor) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  const scaled = BigInt(whole + fraction) * BigInt(factor);
  const digits = scaled.toString().padStart(fraction.length + 1, "0");
  const integer = fraction.length ? digits.slice(0, -fraction.length) : digits;
  const rest = fraction.length ? digits.slice(-fraction.length).replace(/0+$/, "") : "";
  const text = (integer.replace(/^0+(?=\d)/, "") || "0") + (rest ? "." + rest : "");
  return (sign && text !== "0" ? "-" : "") + text;
}

/** 머리글 글에서 단위·주기를 찾는다. 명시되지 않으면 null(추정하지 않음). */
export function headerUnit(headerTexts) {
  const joined = headerTexts.join(" ");
  const unit = UNIT_FACTORS.find((candidate) => candidate.pattern.test(joined)) ?? null;
  const period = /(^|\s|\()월(\s|간|별|\s*한도|\s*지원|$)|월\s*한도|\/\s*월/.test(joined) ? "month" : /(^|\s|\()연(\s|간|\s*한도|$)|연\s*한도|\/\s*연|1년/.test(joined) ? "year" : null;
  return { unit, period };
}

function valueState(text, cell, covered) {
  if (covered) return "covered_by_merge";
  if (cell.blocks?.some((block) => block.type === "image")) return text.trim() ? "value" : "unreadable";
  if (cell.blocks?.some((block) => block.spans?.some((span) => span.placeholder))) return "placeholder";
  const trimmed = text.trim();
  if (!trimmed) return "empty";
  if (/^0+(\.0+)?$/.test(trimmed.replace(/,/g, ""))) return "zero";
  if (/^[-–—]$/.test(trimmed)) return "unknown";
  return "value";
}

/** 표 하나를 논리 그리드로 정규화한다. 범위를 벗어나거나 겹치는 span은 품질 플래그로 남긴다. */
export function normalizeTable(table, context) {
  const { parseId, irPointer, tableIndex, pageMode, pageNumber, parentCellId = null, depth = 0 } = context;
  const tableId = shortId("t:", parseId, irPointer);
  const flags = [];
  const rows = table.rows;
  const cols = table.cols;
  const owner = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
  const cells = [];
  const nested = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const raw = table.cells?.[row]?.[col];
      const pointer = irPointer + "/table/cells/" + row + "/" + col;
      const covered = owner[row][col] !== null;
      if (!raw) {
        if (!covered) flags.push("MISSING_CELL_SLOT:" + row + ":" + col);
        continue;
      }
      if (covered) {
        if ((raw.text ?? "").trim()) flags.push("TEXT_IN_COVERED_SLOT:" + row + ":" + col);
        continue;
      }
      const rowSpan = Number.isInteger(raw.rowSpan) && raw.rowSpan > 0 ? raw.rowSpan : 1;
      const colSpan = Number.isInteger(raw.colSpan) && raw.colSpan > 0 ? raw.colSpan : 1;
      if (row + rowSpan > rows || col + colSpan > cols) flags.push("SPAN_OUT_OF_RANGE:" + row + ":" + col);
      const cellId = "c:" + tableId.slice(2) + ":" + row + ":" + col;
      for (let r = row; r < Math.min(rows, row + rowSpan); r += 1) {
        for (let c = col; c < Math.min(cols, col + colSpan); c += 1) {
          if (owner[r][c] !== null && !(r === row && c === col)) flags.push("SPAN_OVERLAP:" + r + ":" + c);
          owner[r][c] = cellId;
        }
      }
      // kordoc의 셀 text는 셀 안 중첩 표 글자까지 평탄화해 담는다. 중첩 표는 따로 출력되므로 부모 셀에는 표가 아닌 블록 글자만 남긴다(T57: 중복 없음).
      const hasNestedTable = (raw.blocks ?? []).some((block) => block.type === "table");
      const text = hasNestedTable ? (raw.blocks ?? []).filter((block) => block.type !== "table").map((block) => block.text ?? "").filter((part) => part !== "").join("\n") : raw.text ?? "";
      if (hasNestedTable) flags.push("NESTED_TABLE_TEXT_SEPARATED:" + row + ":" + col);
      const contentRefs = [];
      (raw.blocks ?? []).forEach((block, index) => {
        const childPointer = pointer + "/blocks/" + index;
        contentRefs.push({ type: block.type, ir_pointer: childPointer });
        if (block.type === "table" && block.table) {
          if (depth + 1 > context.maxDepth) flags.push("NESTING_TOO_DEEP:" + row + ":" + col);
          else nested.push({ table: block.table, irPointer: childPointer, parentCellId: cellId, pageNumber: block.pageNumber ?? pageNumber });
        }
      });
      cells.push({
        cell_id: cellId,
        anchor_row: row,
        anchor_col: col,
        row_span: rowSpan,
        col_span: colSpan,
        is_header_marked: raw.isHeader === true,
        parsed_text_verbatim: text,
        normalized_text: text.replace(/\s+/g, " ").trim(),
        content_refs: contentRefs,
        value_state: valueState(text, raw, false),
        source_refs: [{ ir_pointer: pointer, locator_precision: "parsed_structural" }],
      });
    }
  }
  const slots = rows * cols;
  // 머리행: 위에서부터 모든 소유 셀이 isHeader로 표시된 행, 또는 앞 머리행 셀이 세로 병합으로 걸쳐 내려온 행(머리 이어짐).
  // 표시가 없으면 hasHeader(레이아웃 힌트)만으로 확정하지 않는다.
  let headerRows = 0;
  let continuation = false;
  for (let row = 0; row < rows; row += 1) {
    const anchors = cells.filter((cell) => cell.anchor_row === row);
    const marked = anchors.length > 0 && anchors.every((cell) => cell.is_header_marked);
    const spannedFromHeader = headerRows === row && row > 0 && owner[row].some((id) => {
      const anchor = cells.find((cell) => cell.cell_id === id);
      return anchor !== undefined && anchor.anchor_row < row && anchor.is_header_marked;
    });
    if (marked || spannedFromHeader) {
      headerRows = row + 1;
      if (!marked) continuation = true;
    } else break;
  }
  const headerBasis = headerRows > 0 ? (continuation ? "cell_header_marks_with_span_continuation" : "cell_header_marks") : table.hasHeader ? "layout_hint_unconfirmed" : "none";
  const headerPaths = [];
  for (let col = 0; col < cols; col += 1) {
    const ids = [];
    for (let row = 0; row < headerRows; row += 1) {
      const id = owner[row][col];
      if (id && !ids.includes(id)) ids.push(id);
    }
    headerPaths.push({ column: col, header_cell_ids: ids, labels: ids.map((id) => cells.find((cell) => cell.cell_id === id)?.normalized_text ?? "") });
  }
  // 행 머리열: 머리행 아래 모든 행에서 맨 왼쪽부터 머리 표시가 된 열(전치·이축 표). 표시가 없으면 추정하지 않는다.
  let rowHeaderColumns = 0;
  for (let col = 0; col < cols; col += 1) {
    const anchors = cells.filter((cell) => cell.anchor_row >= headerRows && cell.anchor_col === col);
    if (anchors.length > 0 && anchors.every((cell) => cell.is_header_marked)) rowHeaderColumns = col + 1;
    else break;
  }
  if (rowHeaderColumns === cols) rowHeaderColumns = 0;
  const orientation = headerRows > 0 && rowHeaderColumns > 0 ? "two_axis" : rowHeaderColumns > 0 ? "row_headed" : headerRows > 0 ? "column_headed" : "unlabeled";
  // 좌우 비교표: 마지막 머리행의 열 이름 묶음이 그대로 2번 이상 반복되면 사업 영역을 나눈다(같은 이름이 한 번 더 있다는 것만으로는 나누지 않음).
  const lastHeader = headerPaths.map((path) => path.labels.at(-1) ?? "");
  const columnRegions = [];
  for (let width = 1; width <= Math.floor((cols - rowHeaderColumns) / 2) && headerRows > 0; width += 1) {
    const body = lastHeader.slice(rowHeaderColumns);
    if (body.length % width !== 0 || body.slice(0, width).some((label) => !label)) continue;
    const unit = body.slice(0, width).join("\u0001");
    let repeats = true;
    for (let start = width; start < body.length; start += width) if (body.slice(start, start + width).join("\u0001") !== unit) repeats = false;
    if (!repeats) continue;
    for (let start = 0; start < body.length; start += width) {
      const columns = Array.from({ length: width }, (_, offset) => rowHeaderColumns + start + offset);
      const upper = headerPaths[columns[0]].labels.slice(0, -1);
      columnRegions.push({ region_index: columnRegions.length, columns, labels: body.slice(start, start + width), upper_labels: upper });
    }
    break;
  }
  const rowRoles = [];
  for (let row = headerRows; row < rows; row += 1) {
    const label = cells.find((cell) => cell.anchor_row === row && cell.anchor_col === 0)?.normalized_text ?? "";
    rowRoles.push({ row, role: TOTAL_LABEL.test(label) ? "total" : "data", label });
  }
  for (const cell of cells) {
    if (cell.anchor_row < headerRows) {
      cell.row_role = "header";
      continue;
    }
    cell.row_role = rowRoles.find((role) => role.row === cell.anchor_row)?.role ?? "data";
    const path = headerPaths[cell.anchor_col];
    cell.header_path = path ? path.labels : [];
    const rowHeaderLabels = cells.filter((other) => other.anchor_row === cell.anchor_row && other.anchor_col < rowHeaderColumns && other.cell_id !== cell.cell_id).sort((a, b) => a.anchor_col - b.anchor_col).map((other) => other.normalized_text);
    if (cell.anchor_col < rowHeaderColumns) {
      cell.row_role = "row_header";
      continue;
    }
    if (rowHeaderColumns) cell.row_header_path = rowHeaderLabels;
    const region = columnRegions.find((item) => item.columns.includes(cell.anchor_col));
    if (region) cell.region_index = region.region_index;
    if (cell.value_state !== "value" && cell.value_state !== "zero") continue;
    // 부호·부등호 보존: 유니코드 빼기(−)는 '-'로 읽되 기록하고, '≤ 300' 같은 값은 정확한 금액이 아니라 한계값(inequality_bound)으로 남긴다.
    const signed = cell.normalized_text.replace(/^[\u2212\u2013\uFE63\uFF0D]/, "-");
    const comparator = signed.match(/^\s*(≤|≥|<|>|<=|>=)\s*/)?.[1] ?? null;
    const number = signed.replace(/^\s*(≤|≥|<|>|<=|>=)\s*/, "").replace(/,/g, "");
    if (!/^-?\d+(\.\d+)?$/.test(number)) continue;
    const preTrace = [
      ...(signed !== cell.normalized_text ? [{ rule: "unicode_minus_to_hyphen", input: cell.normalized_text }] : []),
      ...(comparator ? [{ rule: "inequality_comparator_kept", comparator }] : []),
    ];
    const { unit, period } = headerUnit([...(path ? path.labels : []), ...rowHeaderLabels]);
    if (!unit) {
      cell.normalized_value = { value: number, unit: null, period: null, ...(comparator ? { comparator } : {}), status: comparator ? "inequality_bound" : "no_explicit_unit", trace: [...preTrace, { rule: "strip_thousands_separator", input: cell.normalized_text }] };
      continue;
    }
    cell.normalized_value = {
      value: multiplyDecimal(number, unit.factor),
      unit: "KRW",
      period,
      ...(comparator ? { comparator } : {}),
      display: (comparator ? comparator + " " : "") + multiplyDecimal(number, unit.factor) + " KRW" + (period ? "/" + period : ""),
      status: comparator ? "inequality_bound" : "normalized",
      trace: [
        ...preTrace,
        { rule: "strip_thousands_separator", input: cell.normalized_text, output: number },
        { rule: "header_unit", unit: unit.unit, factor: unit.factor, header_cell_ids: path.header_cell_ids },
        ...(period ? [{ rule: "header_period", period, header_cell_ids: path.header_cell_ids }] : []),
      ],
    };
  }
  if (slots > context.maxLogicalSlots) flags.push("TOO_MANY_SLOTS");
  return {
    record: {
      table_id: tableId,
      table_index: tableIndex,
      parent_cell_id: parentCellId,
      ir_pointer: irPointer,
      source_id_available: typeof table.sourceId === "string",
      source_table_id: table.sourceId ?? null,
      logical_rows: rows,
      logical_columns: cols,
      logical_slots: slots,
      header_rows: headerRows,
      header_basis: headerBasis,
      orientation,
      row_header_columns: rowHeaderColumns,
      column_regions: columnRegions,
      header_paths: headerPaths,
      row_roles: rowRoles,
      cells,
      caption_refs: table.captionBlocks ? table.captionBlocks.map((_, index) => irPointer + "/table/captionBlocks/" + index) : table.caption ? [irPointer + "/table/caption"] : [],
      footnote_refs: [],
      physical_fragments: [{ page_mode: pageMode, layout_page_start: pageMode === "layout" ? pageNumber ?? null : null, section: pageMode === "section" ? pageNumber ?? null : null, physical_page_verified: false }],
      classification: table.classification ?? null,
      quality_flags: flags,
    },
    nested,
  };
}

/** 표 바로 뒤 각주 문단을 표에 연결한다. 행 이름이 각주에 그대로 있으면 그 행에만, 아니면 범위 모호로 남긴다. */
function attachFootnotes(tables, blocks) {
  for (const table of tables) {
    if (table.parent_cell_id !== null) continue;
    const index = table.block_index;
    for (let next = index + 1; next < blocks.length; next += 1) {
      const block = blocks[next];
      if (block.type !== "paragraph" || !FOOTNOTE.test(block.text ?? "")) break;
      const text = block.text ?? "";
      const rows = table.row_roles.filter((role) => role.label && role.role === "data" && text.includes(role.label)).map((role) => role.row);
      table.footnote_refs.push({ ir_pointer: "/blocks/" + next, text, scope: rows.length ? "rows" : "ambiguous", rows });
      if (!rows.length) table.quality_flags.push("FOOTNOTE_SCOPE_AMBIGUOUS");
      for (const cell of table.cells) {
        if (!cell.normalized_value) continue;
        if (rows.includes(cell.anchor_row)) cell.normalized_value.footnote_refs = [...(cell.normalized_value.footnote_refs ?? []), "/blocks/" + next];
        if (!rows.length) cell.normalized_value.status = "provisional_footnote_scope";
      }
    }
  }
}

const CONTINUATION_MARKER = /^[(\[<〈【]?\s*(앞\s*쪽에서\s*|앞\s*면에서\s*|다음\s*쪽에\s*|다음\s*면에\s*)?(계\s*속|이어짐|續)\s*(됨|함|합니다)?\s*[)\]>〉】]?$/;

function blockText(block) {
  if (!block) return "";
  if (block.type === "table") return "";
  return (block.text ?? "").trim();
}

function captionText(block) {
  const table = block?.table;
  if (!table) return "";
  if (Array.isArray(table.captionBlocks)) return table.captionBlocks.map((item) => (item.text ?? "").trim()).join(" ");
  return typeof table.caption === "string" ? table.caption.trim() : "";
}

const headerLabels = (table) => table.header_paths.map((path) => path.labels.join(" / "));
const firstRowTexts = (table) => table.cells.filter((cell) => cell.anchor_row === 0).sort((a, b) => a.anchor_col - b.anchor_col).map((cell) => cell.normalized_text);

/** 첫 열의 순번(1, 2, 3 …). 숫자가 아닌 행은 빼고 본다. */
function sequenceNumbers(table) {
  return table.cells
    .filter((cell) => cell.anchor_col === 0 && cell.row_role === "data" && /^\d{1,4}\.?$/.test(cell.normalized_text))
    .sort((a, b) => a.anchor_row - b.anchor_row)
    .map((cell) => Number.parseInt(cell.normalized_text, 10));
}

/**
 * 계속 표 연결. 같은 원본 표 ID이거나, 두 표 사이에 '(계속)' 같은 표시만 있을 때만 같은 표로 본다.
 * 제목·열 수가 비슷하다는 이유만으로 합치지 않고 검토 표시만 남긴다. 셀은 바꾸지 않고, 반복 머리행은 분석 투영에서만 제외한다.
 */
export function linkContinuations(tables, blocks) {
  const top = tables.filter((table) => table.parent_cell_id === null).sort((a, b) => a.block_index - b.block_index);
  const logical = new Map();
  for (let index = 1; index < top.length; index += 1) {
    const previous = top[index - 1];
    const table = top[index];
    const between = blocks.slice(previous.block_index + 1, table.block_index);
    const texts = between.map(blockText).filter(Boolean);
    if (between.some((block) => block.type === "table") || texts.some((text) => !CONTINUATION_MARKER.test(text))) continue;
    const evidence = [];
    between.forEach((block, offset) => {
      if (CONTINUATION_MARKER.test(blockText(block))) evidence.push("marker_paragraph:/blocks/" + (previous.block_index + 1 + offset));
    });
    if (CONTINUATION_MARKER.test(captionText(blocks[table.block_index])) || /\(\s*계\s*속\s*\)/.test(captionText(blocks[table.block_index]))) evidence.push("marker_caption:/blocks/" + table.block_index);
    const sameSource = previous.source_table_id !== null && previous.source_table_id === table.source_table_id;
    if (sameSource) evidence.push("same_source_table_id");
    const sameColumns = previous.logical_columns === table.logical_columns;
    const sameHeader = table.header_rows > 0 && previous.header_rows > 0 && JSON.stringify(headerLabels(previous)) === JSON.stringify(headerLabels(table));
    if (!evidence.length) {
      if (sameColumns && sameHeader) table.quality_flags.push("CONTINUATION_CANDIDATE_UNCONFIRMED");
      continue;
    }
    if (!sameColumns) {
      table.quality_flags.push("CONTINUATION_MARKER_COLUMN_MISMATCH");
      continue;
    }
    const before = sequenceNumbers(previous);
    const after = sequenceNumbers(table);
    const restarted = before.length > 0 && after.length > 0 && after[0] === 1 && before.at(-1) >= 1;
    if (restarted && !sameSource) {
      table.quality_flags.push("NUMBERING_RESTART_NOT_LINKED");
      continue;
    }
    if (restarted) table.quality_flags.push("NUMBERING_RESTART_REVIEW");
    evidence.push("same_column_count");
    let repeatedHeaderRows = 0;
    if (sameHeader) {
      repeatedHeaderRows = table.header_rows;
      evidence.push("repeated_header_identical");
    } else if (table.header_rows > 0) {
      table.quality_flags.push("CONTINUATION_HEADER_DIFFERS");
    } else if (previous.header_rows > 0 && JSON.stringify(firstRowTexts(table)) === JSON.stringify(headerLabels(previous).map((label) => label.split(" / ").at(-1)))) {
      table.quality_flags.push("POSSIBLE_REPEATED_HEADER_UNMARKED");
    }
    const groupId = previous.continuation?.group_id ?? previous.table_id;
    previous.continuation ??= { group_id: groupId, role: "head", fragment_index: 0, previous_table_id: null, evidence: [], repeated_header_rows: 0 };
    table.continuation = { group_id: groupId, role: "continuation", fragment_index: previous.continuation.fragment_index + 1, previous_table_id: previous.table_id, evidence, repeated_header_rows: repeatedHeaderRows };
    const group = logical.get(groupId) ?? { logical_table_id: "lt:" + groupId.slice(2), fragments: [previous.table_id], columns: previous.logical_columns, analysis_excluded_rows: [] };
    group.fragments.push(table.table_id);
    if (repeatedHeaderRows) group.analysis_excluded_rows.push({ table_id: table.table_id, rows: Array.from({ length: repeatedHeaderRows }, (_, row) => row), rule: "repeated_header_identical" });
    logical.set(groupId, group);
  }
  for (const table of top) table.continuation ??= null;
  return [...logical.values()];
}

/**
 * 쪽별 추출 방식. kordoc은 OCR 줄 신뢰도를 블록에 싣지 않으므로(낮은 줄은 버리고 OCR_LOW_CONF 경고만 남김) 신뢰도 값을 만들지 않는다.
 * - structured_source: HWP·HWPX·DOCX·XLSX 등 문서 구조에서 직접 읽음
 * - text_layer: PDF 텍스트층
 * - ocr_page: OCR이 그 쪽 전체를 대신함(스캔·텍스트층 없음·글자 깨짐)
 * - text_layer_with_ocr_regions: 텍스트층 쪽에 그림 영역 OCR 글을 덧붙임(블록별로 어느 쪽인지 kordoc이 구분해 주지 않음 → 쪽 전체 검토)
 * - ocr_image: 이미지 입력 OCR
 */
export function extractionPlan(format, raw, ocrRequested) {
  if (format === "image") return { pageMethod: () => "ocr_image", ocr_pages: [1] };
  if (format !== "pdf") return { pageMethod: () => "structured_source", ocr_pages: [] };
  const byPage = new Map();
  for (const quality of raw.pageQuality ?? []) {
    if (!ocrRequested || !quality.ocrApplied) byPage.set(quality.page, "text_layer");
    else byPage.set(quality.page, quality.needsOcr || raw.isImageBased ? "ocr_page" : "text_layer_with_ocr_regions");
  }
  return {
    pageMethod: (page) => byPage.get(page) ?? "text_layer",
    ocr_pages: [...byPage].filter(([, method]) => method !== "text_layer").map(([page]) => page).sort((a, b) => a - b),
  };
}

export const OCR_METHODS = new Set(["ocr_page", "text_layer_with_ocr_regions", "ocr_image"]);

function locatorPrecision(method, hasBox) {
  if (OCR_METHODS.has(method)) return "ocr_page";
  if (method === "text_layer") return hasBox ? "pdf_page_bbox" : "pdf_page";
  return "parsed_structural";
}

/** 문서 블록·표·근거 위치를 만든다. ID는 parse_id와 IR 위치로만 정해져 같은 입력이면 항상 같다. */
export function buildDocument(raw, parseId, limits, plan = extractionPlan("hwpx", raw, false)) {
  const pageMode = raw.metadata?.pageMode ?? "unknown";
  const documentBlocks = [];
  const tables = [];
  const sourceMap = [];
  raw.blocks.forEach((block, index) => {
    const pointer = "/blocks/" + index;
    const blockId = shortId("b:", parseId, pointer);
    const method = plan.pageMethod(block.pageNumber ?? null);
    const entry = { block_id: blockId, index, type: block.type, ir_pointer: pointer, level: block.level ?? null, page_mode: pageMode, page: block.pageNumber ?? null, extraction_method: method };
    if (OCR_METHODS.has(method)) entry.ocr = { applied_to_page: true, line_confidence: "not_provided_by_parser", review_required: true };
    if (block.bbox) entry.bbox = { page: block.bbox.page, x: block.bbox.x, y: block.bbox.y, width: block.bbox.width, height: block.bbox.height, unit: "pdf_point" };
    if (block.type === "table" && block.table) {
      const queue = [{ table: block.table, irPointer: pointer, parentCellId: null, pageNumber: block.pageNumber, depth: 0 }];
      while (queue.length) {
        const item = queue.shift();
        const { record, nested } = normalizeTable(item.table, { parseId, irPointer: item.irPointer, tableIndex: tables.length, pageMode, pageNumber: item.pageNumber, parentCellId: item.parentCellId, depth: item.depth, maxDepth: limits.maxDepth, maxLogicalSlots: limits.maxLogicalSlots });
        record.block_index = index;
        record.extraction_method = plan.pageMethod(item.pageNumber ?? null);
        if (OCR_METHODS.has(record.extraction_method)) {
          // OCR로 읽은 표의 숫자·금액은 사람이 원문과 대조하기 전까지 확정값으로 쓰지 않는다.
          record.quality_flags.push("OCR_VALUES_REQUIRE_REVIEW");
          for (const cell of record.cells) if (cell.normalized_value) cell.normalized_value.status = "ocr_needs_review";
        }
        tables.push(record);
        if (item.parentCellId === null) entry.table_id = record.table_id;
        for (const child of nested) queue.push({ ...child, depth: item.depth + 1 });
      }
    } else {
      entry.parsed_text_verbatim = block.text ?? "";
      if (block.spans?.some((span) => span.placeholder)) entry.contains_placeholder = true;
      if (block.style?.strike || block.spans?.some((span) => span.strike)) entry.contains_strike = true;
    }
    documentBlocks.push(entry);
    sourceMap.push({
      ref_id: blockId,
      ir_pointer: pointer,
      native_locator: null,
      locator_precision: locatorPrecision(method, Boolean(block.bbox)),
      extraction_method: method,
      page_mode: pageMode,
      layout_page_start: pageMode === "layout" ? block.pageNumber ?? null : null,
      section: pageMode === "section" ? block.pageNumber ?? null : null,
      ...(block.bbox ? { bbox: { page: block.bbox.page, x: block.bbox.x, y: block.bbox.y, width: block.bbox.width, height: block.bbox.height, unit: "pdf_point" } } : {}),
      physical_page_verified: false,
      parse_id: parseId,
    });
  });
  attachFootnotes(tables, raw.blocks);
  const logicalTables = linkContinuations(tables, raw.blocks);
  for (const table of tables) {
    const precision = locatorPrecision(table.extraction_method, false);
    sourceMap.push({
      ref_id: table.table_id, ir_pointer: table.ir_pointer,
      native_locator: table.source_table_id ? { kind: "hwpx_tbl_id_reported_by_parser", value: table.source_table_id } : null,
      locator_precision: precision, extraction_method: table.extraction_method, page_mode: pageMode, physical_page_verified: false, parse_id: parseId,
    });
    for (const cell of table.cells) {
      sourceMap.push({ ref_id: cell.cell_id, ir_pointer: cell.source_refs[0].ir_pointer, native_locator: null, locator_precision: precision, extraction_method: table.extraction_method, page_mode: pageMode, physical_page_verified: false, parse_id: parseId, table_id: table.table_id, logical_cell: [cell.anchor_row, cell.anchor_col] });
    }
  }
  return { document: { parse_id: parseId, page_mode: pageMode, page_count: raw.metadata?.pageCount ?? raw.pageCount ?? null, ocr_pages: plan.ocr_pages, blocks: documentBlocks, logical_tables: logicalTables }, tables, sourceMap };
}
