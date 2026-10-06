// HWPX 원본 XML을 kordoc 없이 읽어 글자 단위(문단·셀)를 문서 순서대로 뽑는다. 의미 필드 정답 작성·근거 검증용.
import { readZipEntries } from "./hwpx-xml.mjs";

const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** [{ id: "s0:p12" | "s0:t<tableId>:r,c", text }] 문서 순서. 셀 안 문단은 그 셀 단위로 합친다. */
export function hwpxTextUnits(bytes) {
  const entries = readZipEntries(bytes);
  const sections = [...entries.keys()].filter((n) => /^Contents\/section\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const units = [];
  for (const [si, section] of sections.entries()) {
    const xml = entries.get(section)().toString("utf8");
    const stack = [];
    let para = null;
    let paraCount = 0;
    let inText = 0;
    for (const token of xml.match(/<[^>]+>|[^<]+/g) ?? []) {
      if (token[0] !== "<") {
        if (!inText) continue;
        const cell = stack.at(-1)?.cell;
        if (cell) cell.text += unescape(token); else if (para) para.text += unescape(token);
        continue;
      }
      const closing = token.startsWith("</");
      const self = token.endsWith("/>");
      const name = (token.match(/^<\/?([\w:]+)/) || [])[1];
      if (name === "hp:tbl" && !closing) stack.push({ id: (token.match(/\sid="(\d+)"/) || [])[1], cell: null });
      else if (name === "hp:tbl" && closing) stack.pop();
      else if (name === "hp:tc" && !closing && stack.length) stack.at(-1).cell = { row: -1, col: -1, text: "" };
      else if (name === "hp:tc" && closing && stack.at(-1)?.cell) { const t = stack.at(-1); units.push({ id: "s" + si + ":t" + t.id + ":" + t.cell.row + "," + t.cell.col, text: t.cell.text.replace(/\s+/g, " ").trim() }); t.cell = null; }
      else if (name === "hp:cellAddr" && stack.at(-1)?.cell) { stack.at(-1).cell.col = Number((token.match(/colAddr="(\d+)"/) || [])[1]); stack.at(-1).cell.row = Number((token.match(/rowAddr="(\d+)"/) || [])[1]); }
      else if (name === "hp:p" && !closing && !stack.length) { para = { text: "" }; }
      else if (name === "hp:p" && closing && !stack.length && para) { const text = para.text.replace(/\s+/g, " ").trim(); if (text) units.push({ id: "s" + si + ":p" + paraCount, text }); paraCount += 1; para = null; }
      else if (name === "hp:p" && !closing && stack.at(-1)?.cell && stack.at(-1).cell.text) stack.at(-1).cell.text += " ";
      else if (name === "hp:t") { if (!closing && !self) inText += 1; else if (closing) inText = Math.max(0, inText - 1); }
      else if (name === "hp:lineBreak" && inText) { const cell = stack.at(-1)?.cell; if (cell) cell.text += " "; else if (para) para.text += " "; }
    }
  }
  return units;
}
