// HWPX 원본 XML에서 표 구조를 독립적으로 읽는다(kordoc를 쓰지 않음). 작업지시서 v5 §18.5·T76의 「원본 XML 직접 대조」 정답 작성용.
// ZIP 중앙 디렉터리 → Contents/section*.xml(deflate) → hp:tbl/hp:tc 스택 파싱. 셀 글자는 그 셀에 직접 속한 hp:t만(중첩 표 글자는 중첩 표 쪽).
import { inflateRawSync } from "node:zlib";

export function readZipEntries(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("ZIP_EOCD_NOT_FOUND");
  const count = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n += 1) {
    const method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extra = bytes.readUInt16LE(offset + 30);
    const comment = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const dataStart = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const raw = bytes.subarray(dataStart, dataStart + compressed);
    entries.set(name, () => (method === 0 ? raw : inflateRawSync(raw)));
    offset += 46 + nameLength + extra + comment;
  }
  return entries;
}

const attr = (tag, name) => { const m = tag.match(new RegExp("\\s" + name + '="([^"]*)"')); return m ? m[1] : null; };
const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** 표 목록: { id, rows, cols, depth, parent:{table_id,row,col}|null, cells:[{row,col,row_span,col_span,text}] } (문서 순서). */
export function hwpxTables(bytes) {
  const entries = readZipEntries(bytes);
  const sections = [...entries.keys()].filter((name) => /^Contents\/section\d+\.xml$/.test(name)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const tables = [];
  for (const section of sections) {
    const xml = entries.get(section)().toString("utf8");
    const stack = [];
    let current = null;
    let inText = 0;
    for (const token of xml.match(/<[^>]+>|[^<]+/g) ?? []) {
      if (token[0] !== "<") { if (inText && stack.length && stack.at(-1).cell) stack.at(-1).cell.text += unescape(token); continue; }
      const closing = token.startsWith("</");
      const selfClosing = token.endsWith("/>");
      const name = (token.match(/^<\/?([\w:]+)/) || [])[1];
      if (name === "hp:tbl" && !closing) {
        const parent = stack.length && stack.at(-1).cell ? { table_index: stack.at(-1).index, row: stack.at(-1).cell.row, col: stack.at(-1).cell.col } : null;
        current = { id: attr(token, "id"), rows: Number(attr(token, "rowCnt")), cols: Number(attr(token, "colCnt")), depth: stack.length, parent, cells: [] };
        stack.push({ table: current, index: tables.length, cell: null });
        tables.push(current);
      } else if (name === "hp:tbl" && closing) {
        stack.pop();
      } else if (name === "hp:tc" && !closing && stack.length) {
        stack.at(-1).cell = { row: -1, col: -1, row_span: 1, col_span: 1, text: "" };
      } else if (name === "hp:tc" && closing && stack.length && stack.at(-1).cell) {
        stack.at(-1).table.cells.push(stack.at(-1).cell);
        stack.at(-1).cell = null;
      } else if (name === "hp:cellAddr" && stack.length && stack.at(-1).cell) {
        stack.at(-1).cell.col = Number(attr(token, "colAddr"));
        stack.at(-1).cell.row = Number(attr(token, "rowAddr"));
      } else if (name === "hp:cellSpan" && stack.length && stack.at(-1).cell) {
        stack.at(-1).cell.col_span = Number(attr(token, "colSpan"));
        stack.at(-1).cell.row_span = Number(attr(token, "rowSpan"));
      } else if (name === "hp:t") {
        if (!closing && !selfClosing) inText += 1; else if (closing) inText = Math.max(0, inText - 1);
      } else if ((name === "hp:lineBreak" || name === "hp:p") && inText === 0 && stack.length && stack.at(-1).cell && !closing) {
        stack.at(-1).cell.text += " ";
      }
    }
  }
  return tables;
}

export const normalizeText = (s) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/[\s\u00a0\u3000]+/g, "").trim();
