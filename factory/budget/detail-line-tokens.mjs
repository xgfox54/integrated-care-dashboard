export const ITEM_MARK = /^[ΟOＯ○◦ㅇ](?=\S)/u;
export const SUB_MARK = /^[oｏοº·∘―－](?=\S)/u;
export const DETAIL_MARK = /^ㆍ(?=\S)/u;
export const OBJECT_GROUP = /^(\d{3})\s+(\S.*)$/;
export const OBJECT = /^(\d{2})\s+(\S.*)$/;
export const FORMULA_START = /\(?\s*[\d,]+(?:\.\d+)?\s*(?:[\p{L}%²³㎡㎥]+\s*[*×x/]\s*[\d,]+(?:\.\d+)?\s*)*원/u;
const FORMULA_LEVELS = new Set(['item', 'sub_item', 'sub_item_detail']);

/** Split printed source markers; inherited parents apply only before a new object/item. */
export function splitDetailLines(text, parentHasItem = false, parentHasSubItem = false) {
  const items = [];
  const hasParent = (level, inherited) => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (items[i].level === level) return true;
      if (items[i].level === 'object' || items[i].level === 'object_group' || (level === 'sub_item' && items[i].level === 'item')) return false;
    }
    return inherited;
  };
  for (const raw of (text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const group = OBJECT_GROUP.exec(line);
    const object = !group && OBJECT.exec(line);
    if (group) { items.push({ level: 'object_group', code: group[1], name: group[2], formula: null, lines: [line] }); continue; }
    if (object) { items.push({ level: 'object', code: object[1], name: object[2], formula: null, lines: [line] }); continue; }
    const marked = ITEM_MARK.test(line);
    const small = !marked && SUB_MARK.test(line);
    const detail = DETAIL_MARK.test(line);
    const hasItem = hasParent('item', parentHasItem);
    const hasSub = hasParent('sub_item', parentHasSubItem);
    const level = marked || (small && !hasItem) ? 'item' : small ? 'sub_item' : detail && hasSub ? 'sub_item_detail' : null;
    if (detail && !hasSub) {
      items.push({ level: 'unknown', code: null, name: line, formula: null, lines: [line] });
      continue;
    }
    if (level) {
      const body = line.slice(1).trim();
      const at = body.search(FORMULA_START);
      let name = (at > 0 ? body.slice(0, at) : at === 0 ? '' : body).trim();
      const marker = /\s(경정|기정|당초|증액|감액|변경)$/.exec(name);
      if (marker && at > 0) name = name.slice(0, marker.index).trim();
      items.push({ level, code: null, name, formula: at >= 0 ? body.slice(at).trim() : null, lines: [line], ...(marker && at > 0 ? { markers: [marker[1]] } : {}) });
      continue;
    }
    const last = items[items.length - 1];
    if (!last) { items.push({ level: 'unknown', code: null, name: line, formula: null, lines: [line] }); continue; }
    last.lines.push(line);
    const formulaOpen = last.formula && ((last.formula.match(/\(/g) ?? []).length > (last.formula.match(/\)/g) ?? []).length || /[*+×x\-/]$/.test(last.formula));
    if (last.formula && (formulaOpen || /^[*+×x)/]/.test(line))) last.formula += line;
    else if (FORMULA_START.test(line) && FORMULA_LEVELS.has(last.level) && !last.formula) {
      const at = line.search(FORMULA_START);
      let head = line.slice(0, at).trim();
      const marker = /(^|\s)(경정|기정|당초|증액|감액|신규|변경)$/.exec(head);
      if (marker) {
        (last.markers ??= []).push(marker[2]);
        head = head.slice(0, marker.index).trim();
      }
      if (head && !/\d/.test(head)) last.name = (last.name + (/^[가-힣]{1,2}$/.test(head) ? '' : ' ') + head).trim();
      last.formula = (head && !/\d/.test(head)) || marker ? line.slice(at).trim() : line;
    }
    else if (last.formula) last.formula += ' ' + line;
    else last.name = (last.name + ' ' + line).trim();
  }
  return items;
}
