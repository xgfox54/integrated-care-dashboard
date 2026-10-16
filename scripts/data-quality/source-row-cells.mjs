import { detectMohwLayout, columnGlyphs, groupGlyphLines } from '../../lib/mohw-glyphs.ts';

export const compactCell = (value) => value.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

function indexedGlyphs(glyphs) {
  let text = '';
  const positions = [];
  for (const line of groupGlyphLines(glyphs, 5)) for (const glyph of line.glyphs) {
    const part = compactCell(glyph.text);
    text += part;
    for (const character of part) positions.push(glyph);
  }
  return { text, positions };
}

export function sourceRowCells(page, services, inherited = null) {
  let layout;
  try { layout = detectMohwLayout(page.glyphs, page.height); }
  catch (error) { if (!(error instanceof Error) || !/^보건복지부 문서의/.test(error.message)) throw error; layout = inherited; }
  if (!layout) return { layout: null, rows: [] };
  const content = page.glyphs.filter(glyph => glyph.y > layout.headerBottom && glyph.y < page.height - 20);
  const header = page.glyphs.filter(glyph => glyph.y < layout.headerBottom);
  const bands = header.filter(glyph => glyph.text === '구').flatMap(glyph => header.filter(other => other.text === '분' && (Math.abs(other.x - glyph.x) <= 8 && other.y > glyph.y && other.y - glyph.y < 30 || Math.abs(other.y - glyph.y) <= 4 && other.x > glyph.x && other.x - glyph.x < 40)).map(other => (glyph.x + other.x + other.width) / 2));
  const typeCenter = bands.sort((a, b) => b - a)[0];
  const names = indexedGlyphs(columnGlyphs(layout, content, 'name'));
  const located = services.flatMap(service => {
    const name = compactCell(service.name);
    if (name.length < 3) return [];
    const at = names.text.indexOf(name);
    if (at < 0 || names.text.indexOf(name, at + 1) >= 0) return [];
    const glyphs = names.positions.slice(at, at + name.length);
    return [{ service, top: Math.min(...glyphs.map(glyph => glyph.y)), bottom: Math.max(...glyphs.map(glyph => glyph.y + glyph.height)) }];
  }).sort((a, b) => a.top - b.top);
  const locatedIds = new Set(located.map(entry => entry.service.serviceId));
  const rows = located.map((entry, index) => {
    const previous = located[index - 1];
    const next = located[index + 1];
    const top = previous ? (previous.bottom + entry.top) / 2 : Math.max(layout.headerBottom, entry.top - 35);
    const bottom = next ? (entry.bottom + next.top) / 2 : Math.min(page.height - 20, entry.bottom + 35);
    const fields = Object.fromEntries(['type', 'sourceType', 'subcategory'].map(field => {
      const column = field === 'type' && typeCenter !== undefined && !layout.columns.some(column => column.key === 'type' || column.key === 'sourceType') ? content.filter(glyph => Math.abs(glyph.x + glyph.width / 2 - typeCenter) <= 20) : columnGlyphs(layout, content, field);
      const glyphs = column.filter(glyph => glyph.y + glyph.height / 2 >= top && glyph.y + glyph.height / 2 < bottom);
      return [field, indexedGlyphs(glyphs).text];
    }));
    const sourceIndex = services.findIndex(service => service.serviceId === entry.service.serviceId);
    const adjacent = [services[sourceIndex - 1], services[sourceIndex + 1]].filter(Boolean);
    const verifiedBounds = adjacent.every(service => locatedIds.has(service.serviceId)) && (!previous || previous.bottom <= entry.top + 1) && (!next || next.top >= entry.bottom - 1);
    return { service_id: entry.service.serviceId, name: entry.service.name, top, bottom, verified_bounds: verifiedBounds, fields };
  });
  return { layout, rows };
}
