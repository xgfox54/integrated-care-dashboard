const NAME_HEADERS = new Set(["사업명", "서비스명", "사업서비스명", "서비스사업명", "사업명칭"]);
const TYPE_HEADERS = new Map([["사업구분", 4], ["국가지자체", 4], ["사업유형", 3], ["서비스유형", 3], ["유형", 2], ["구분", 1]]);
const MISLABELLED_PAGE_HEADER_DOCUMENT = "0085:1489598:1";

export const compact = (text) => text
  .replace(/<\/?(?:u|b|i|em|strong|span)(?:\s[^>]*)?>/gi, "")
  .normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();

function expandTable(table) {
  const grid = table.cells.map((row) => row.map((cell) => ({ ...cell })));
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) {
    const cell = grid[y][x];
    for (let dy = 1; dy < cell.rowSpan; dy++) {
      if (grid[y + dy]?.[x] && !grid[y + dy][x].text.trim()) {
        grid[y + dy][x] = { ...cell, rowSpan: 1, inherited: true };
      }
    }
  }
  return grid;
}

function headers(cells, allowPageHeader) {
  const name = cells.find((cell) => NAME_HEADERS.has(compact(cell.text)));
  const type = cells.filter((cell) => TYPE_HEADERS.has(compact(cell.text))
    || allowPageHeader && compact(cell.text) === "페이지")
    .sort((a, b) => (TYPE_HEADERS.get(compact(b.text)) ?? 0) - (TYPE_HEADERS.get(compact(a.text)) ?? 0))[0];
  const subcategory = cells.find((cell) => compact(cell.text) === "중분류");
  return { name, type, subcategory };
}

export function kordocMatches(parsed, page, candidates) {
  const result = [];
  let inherited = null;
  for (const part of parsed.pages.filter((p) => p.page <= page).sort((a, b) => a.page - b.page)) {
    for (const [table, block] of part.blocks.entries()) {
      if (block.type !== "table") continue;
      const grid = expandTable(block.table);
      let own = null;
      let headerRow = -1;
      for (let y = 0; y < Math.min(grid.length, 6); y++) {
        const cells = grid[y].map((cell, index) => ({ ...cell, index }));
        if (!headers(cells, parsed.document_id === MISLABELLED_PAGE_HEADER_DOCUMENT).name) continue;
        own = headers(grid.slice(y, y + 2).flatMap((row) => row.map((cell, index) => ({ ...cell, index }))),
          parsed.document_id === MISLABELLED_PAGE_HEADER_DOCUMENT);
        headerRow = y;
        inherited = own;
        break;
      }
      if (part.page !== page) continue;
      const head = own ?? inherited;
      if (!head) continue;
      for (let y = headerRow + 1; y < grid.length; y++) {
        const columns = own
          ? Array.from({ length: head.name.colSpan || 1 }, (_, i) => head.name.index + i)
          : grid[y].flatMap((cell, i) => candidates.includes(compact(cell.text)) ? [i] : []);
        for (const nameIndex of columns) {
          const nameCell = grid[y][nameIndex];
          if (!nameCell || !candidates.includes(compact(nameCell.text))) continue;
          const fields = Object.fromEntries(["type", "subcategory"].map((field) => {
            const h = head[field];
            if (!h) return [field, null];
            const index = own ? h.index : nameIndex + h.index - head.name.index - (head.name.colSpan || 1) + 1;
            return [field, index < 0 ? null : {
              text: grid[y][index]?.text ?? "", header: h.text, inherited: grid[y][index]?.inherited ?? false,
            }];
          }));
          result.push({ table, row: y, name: nameCell.text, fields });
        }
      }
    }
  }
  return result;
}

export function geometryMatches(parsed, page, candidates) {
  const result = [];
  let inherited = null;
  for (const part of parsed.pages.filter((p) => p.page <= page)) {
    for (const [tableIndex, table] of part.tables.entries()) {
      const own = headers(table.cells.filter((cell) => cell.bbox[1] < table.bbox[1] + 90),
        parsed.document_id === MISLABELLED_PAGE_HEADER_DOCUMENT);
      if (own.name) inherited = own;
      if (part.page !== page) continue;
      const head = own.name ? own : inherited;
      if (!head?.name) continue;
      const nameX = (head.name.bbox[0] + head.name.bbox[2]) / 2;
      const bodyTop = own.name ? head.name.bbox[3] - 1 : table.bbox[1] - 1;
      const names = table.cells.filter((cell) => !cell.clipped && cell.bbox[1] >= bodyTop
        && cell.bbox[0] <= nameX && cell.bbox[2] >= nameX && candidates.includes(compact(cell.text)));
      for (const nameCell of names) {
        const y = (nameCell.bbox[1] + nameCell.bbox[3]) / 2;
        const fields = {};
        for (const field of ["type", "subcategory"]) {
          const h = head[field];
          if (!h) { fields[field] = null; continue; }
          const x = (h.bbox[0] + h.bbox[2]) / 2;
          const cell = table.cells.find((c) => !c.clipped && c.bbox[0] <= x && c.bbox[2] >= x
            && c.bbox[1] <= y && c.bbox[3] >= y);
          fields[field] = cell && Math.abs(cell.bbox[0] - h.bbox[0]) < 2 && Math.abs(cell.bbox[2] - h.bbox[2]) < 2
            ? { ...cell, header: h.text } : null;
        }
        if (!fields.type && table.open_type_header && nameCell.open_type) fields.type = nameCell.open_type;
        result.push({ table: tableIndex, name: nameCell.text, name_bbox: nameCell.bbox, fields });
      }
    }
  }
  return result;
}

export function compareSourceCells(kordoc, geometry, field) {
  const allGeometry = geometry.map((row) => row.fields[field]).filter(Boolean);
  const g = allGeometry.length === geometry.length && new Set(allGeometry.map((cell) => compact(cell.text))).size === 1
    ? allGeometry[0] : null;
  const matching = kordoc.filter((row) => row.fields[field] && g && compact(row.fields[field].text) === compact(g.text));
  let k = (matching.length ? matching[0] : kordoc.length === 1 ? kordoc[0] : null)?.fields[field] ?? null;
  if (!k && field === "subcategory" && g && kordoc.length > 1
    && kordoc.every((row) => row.table === kordoc[0].table)
    && kordoc.every((row, i) => !i || row.row === kordoc[i - 1].row + 1)) {
    const cells = kordoc.map((row) => row.fields[field]).filter(Boolean);
    const parts = [...new Set(cells.map((cell) => cell.text).filter(Boolean))];
    if (compact(parts.join("")) === compact(g.text)) k = { text: parts.join("\n"), header: cells[0].header, combined_rows: kordoc.length };
  }
  return { k_matches: kordoc.length, g_matches: geometry.length, kordoc: k, geometry: g,
    agreed: Boolean(k && g && compact(k.text) && compact(k.text) === compact(g.text)) };
}
