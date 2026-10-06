// 지방자치단체 「세출예산 사업명세서」(kordoc 파싱 결과)에서 예산서 계층 행을 뽑는다(작업지시서 v5 §22.7, T91·T90).
// 부서 → 정책 → 단위 → 세부사업 → 편성목(세 자리) → 통계목(두 자리) → 부기(Ο) → 하위 산출항목(o)을 서로 다른 행으로 저장하고,
// 부기명 칸에 정책·단위·세부사업명이나 소계를 넣지 않는다. 금액은 원문 표시 단위(천원) 문자열 그대로 두고, 원 단위는 따로 계산한다.
// 한 셀에 여러 줄이 이어진 금액 열에서 숫자가 붙어 나온 경우(예: "2002005,028")는 산출식으로 계산한 값의 이어 붙임과 정확히 같을 때만 나눈다.
import { readFileSync } from "node:fs";
import path from "node:path";

export const EXTRACTOR_VERSION = "budget-lines-1.2.2";
const FUNDING_LABELS = { 국: "national", 균: "balanced_development", 도: "province", 시: "municipal", 구: "municipal", 군: "municipal", 기: "other" };
/** 쉼표 세 자리 묶음 금액. 0 하나를 빼고는 0으로 시작하지 않는다(붙은 숫자를 잘못 나누지 않도록). */
const VALID_AMOUNT = /^△?-?(0|[1-9]\d{0,2}(,\d{3})*)$/;
const ITEM_MARK = /^[ΟOＯ○◦ㅇ](?=\S)/u;
const SUB_MARK = /^[oｏοº·∘―](?=\S)/u;
const OBJECT_GROUP = /^(\d{3})\s+(\S.*)$/;
const OBJECT = /^(\d{2})\s+(\S.*)$/;
const FORMULA_START = /\(?\s*[\d,]+(?:\.\d+)?\s*(?:[\p{L}%²³㎡㎥]+\s*[*×x/]\s*[\d,]+(?:\.\d+)?\s*)*원/u;

const squash = (text) => (text ?? "").replace(/\s+/g, "");
export const formatThousands = (value) => (value < 0 ? "△" : "") + Math.abs(value).toLocaleString("en-US");
export const parseAmount = (text) => {
  if (!VALID_AMOUNT.test(text)) return null;
  const negative = text.startsWith("△") || text.startsWith("-");
  const value = Number(text.replace(/[△,-]/g, ""));
  return negative ? -value : value;
};

/** 산출식 계산: 숫자(쉼표·소수·%)와 + - * / ( ) x × 만 남긴다. 계산할 수 없으면 null(추정하지 않음). */
export function evaluateFormula(formula) {
  if (!formula) return null;
  const tokens = [];
  const source = formula.replace(/[x×X＊]/g, "*").replace(/[÷]/g, "/");
  const pattern = /(\d[\d,]*(?:\.\d+)?)\s*(%)?|([()+\-*/])/g;
  let match;
  while ((match = pattern.exec(source))) {
    if (match[1] !== undefined) tokens.push({ n: Number(match[1].replace(/,/g, "")) / (match[2] ? 100 : 1) });
    else tokens.push({ op: match[3] });
  }
  if (!tokens.length) return null;
  let index = 0;
  const peek = () => tokens[index];
  const factor = () => {
    const token = tokens[index++];
    if (!token) throw new Error("end");
    if (token.n !== undefined) return token.n;
    if (token.op === "(") { const value = expr(); if (tokens[index++]?.op !== ")") throw new Error("paren"); return value; }
    if (token.op === "-") return -factor();
    throw new Error("token");
  };
  const term = () => { let value = factor(); while (peek()?.op === "*" || peek()?.op === "/") { const op = tokens[index++].op; const right = factor(); value = op === "*" ? value * right : value / right; } return value; };
  const expr = () => { let value = term(); while (peek()?.op === "+" || peek()?.op === "-") { const op = tokens[index++].op; const right = term(); value = op === "+" ? value + right : value - right; } return value; };
  try {
    const value = expr();
    if (index !== tokens.length || !Number.isFinite(value)) return null;
    return value;
  } catch { return null; }
}

/** 원 단위 산출 결과를 천원 표시로 바꿀 때 문서가 쓸 수 있는 값(내림·반올림·올림). */
export function thousandCandidates(won) {
  if (won === null) return [];
  const raw = won / 1000;
  return [...new Set([Math.floor(raw + 1e-9), Math.round(raw), Math.ceil(raw - 1e-9)])];
}

/** 붙어 나온 금액 문자열을 기대값(후보)들의 이어 붙임으로 정확히 나눈다. 기대값이 "free"인 칸은 형식이 맞는 모든 앞부분을 시도하고, accept로 전체 분할을 검사한다. 실패하면 null. */
export function segmentGlued(text, expectations, accept = () => true) {
  const search = (rest, at, acc) => {
    if (!rest) return accept(acc) ? acc : null;
    if (at >= expectations.length) return null;
    const options = expectations[at] === "free" ? Array.from({ length: Math.min(rest.length, 15) }, (_, i) => rest.slice(0, i + 1)).filter((piece) => VALID_AMOUNT.test(piece)).map((piece) => parseAmount(piece)) : expectations[at] ?? [];
    for (const candidate of options) {
      const piece = formatThousands(candidate);
      if (rest.startsWith(piece)) { const found = search(rest.slice(piece.length), at + 1, [...acc, piece]); if (found) return found; }
    }
    return null;
  };
  return search(text, 0, []);
}

/** 전체 셀의 행 개수·금액 표기·알려진 산출식을 모두 만족하는 분할이 하나일 때만 복원한다. */
export function uniqueRowAmounts(texts, expectations) {
  const solutions = [];
  let steps = 0;
  let exhausted = false;
  const visit = (token, rest, slot, groups, current) => {
    if (++steps > 50_000) { exhausted = true; return; }
    if (solutions.length > 1) return;
    if (token === texts.length) {
      if (slot === expectations.length) solutions.push(groups);
      return;
    }
    if (!rest) {
      // 정상 금액처럼 보이는 붙임은 모든 조각의 산출식까지 있어야 나눈다.
      const start = slot - current.length;
      if (current.length > 1 && current.some((piece, index) => piece === "0" && !expectations[start + index]?.includes(0))) return;
      if (parseAmount(texts[token]) !== null && current.length > 1 && current.some((_, index) => !expectations[start + index]?.length)) return;
      visit(token + 1, texts[token + 1] ?? "", slot, [...groups, current], []);
      return;
    }
    if (slot >= expectations.length) return;
    for (let end = 1; end <= Math.min(rest.length, 16); end += 1) {
      const piece = rest.slice(0, end);
      const amount = parseAmount(piece);
      if (amount === null || (expectations[slot]?.length && !expectations[slot].includes(amount))) continue;
      visit(token, rest.slice(end), slot + 1, groups, [...current, piece]);
      if (solutions.length > 1 || exhausted) return;
    }
  };
  visit(0, texts[0] ?? "", 0, [], []);
  return !exhausted && solutions.length === 1 ? solutions[0] : null;
}

/** 금액 셀 → 순서 있는 토큰. 재원 표시(국·도·시…)가 붙은 값은 funding, 나머지는 amount. */
export function amountTokens(text) {
  const out = [];
  for (const line of (text ?? "").split("\n")) {
    const pattern = /(국|균|도|시|구|군|기타|기)?\s*(△?-?[\d,]+)/g;
    let match;
    while ((match = pattern.exec(line))) {
      const label = match[1] ? (match[1] === "기타" ? "기" : match[1]) : null;
      if (label && !VALID_AMOUNT.test(match[2])) {
        const splits = [];
        for (let i = 1; i < match[2].length; i += 1) if (VALID_AMOUNT.test(match[2].slice(0, i)) && VALID_AMOUNT.test(match[2].slice(i))) splits.push(i);
        if (splits.length > 1) { out.push({ kind: "funding_glued", source: FUNDING_LABELS[label] ?? "other", label: match[1], text: match[2], splits }); continue; }
        if (splits.length === 1) {
          out.push({ kind: "funding", source: FUNDING_LABELS[label] ?? "other", label: match[1], text: match[2].slice(0, splits[0]), split: true });
          out.push({ kind: "amount", text: match[2].slice(splits[0]) });
          continue;
        }
      }
      out.push(label ? { kind: "funding", source: FUNDING_LABELS[label] ?? "other", label: match[1], text: match[2] } : { kind: "amount", text: match[2] });
    }
  }
  return out;
}

/** 쪽 머리의 「정책: …」「단위: …」(한 블록에 함께 있을 수 있음). */
function pageHeader(texts) {
  const header = {};
  for (const text of texts) {
    const policy = /정책\s*:\s*(.+?)(?=\s+단위\s*:|$)/.exec(text);
    const unit = /단위\s*:\s*(.+?)$/.exec(text);
    if (policy) header.policy = policy[1].trim();
    if (unit && !/천원|원\)/.test(unit[1])) header.unit = unit[1].trim();
  }
  return header;
}

/** 산출 셀(통계목·부기 줄들)을 항목 목록으로 나눈다. */
export function splitDetailLines(text, parentHasItem = false) {
  const items = [];
  for (const raw of (text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const group = OBJECT_GROUP.exec(line);
    const object = !group && OBJECT.exec(line);
    if (group) { items.push({ level: "object_group", code: group[1], name: group[2], formula: null, lines: [line] }); continue; }
    if (object) { items.push({ level: "object", code: object[1], name: object[2], formula: null, lines: [line] }); continue; }
    const marked = ITEM_MARK.test(line);
    const small = !marked && SUB_MARK.test(line);
    const hasItemInObject = (() => { for (let i = items.length - 1; i >= 0; i -= 1) { if (items[i].level === "item") return true; if (items[i].level === "object" || items[i].level === "object_group") return false; } return parentHasItem; })();
    const isItem = marked || (small && !hasItemInObject);
    const isSub = small && hasItemInObject;
    if (isItem || isSub) {
      const body = line.slice(1).trim();
      const at = body.search(FORMULA_START);
      let name = (at > 0 ? body.slice(0, at) : at === 0 ? "" : body).trim();
      const marker = /\s(경정|기정|당초|증액|감액|변경)$/.exec(name);
      if (marker && at > 0) name = name.slice(0, marker.index).trim();
      items.push({ level: isItem ? "item" : "sub_item", code: null, name, formula: at >= 0 ? body.slice(at).trim() : null, lines: [line], ...(marker && at > 0 ? { markers: [marker[1]] } : {}) });
      continue;
    }
    const last = items[items.length - 1];
    if (!last) { items.push({ level: "unknown", code: null, name: line, formula: null, lines: [line] }); continue; }
    last.lines.push(line);
    const formulaOpen = last.formula && ((last.formula.match(/\(/g) ?? []).length > (last.formula.match(/\)/g) ?? []).length || /[*+×x\-/]$/.test(last.formula));
    if (last.formula && (formulaOpen || /^[*+×x)/]/.test(line))) last.formula += line;
    else if (FORMULA_START.test(line) && (last.level === "item" || last.level === "sub_item") && !last.formula) {
      // 「원 173,880,000원」: 줄바꿈으로 넘어온 이름 끝(「지원」의 「원」)과 산출식. 산출식 앞 글자는 이름에 붙인다(한두 글자면 낱말 중간 줄바꿈으로 보고 붙여 씀).
      const at = line.search(FORMULA_START);
      let head = line.slice(0, at).trim();
      // 추경 문서의 산출식 앞 표시(「경정 532,181,000원」의 「경정」 등)는 이름이 아니라 금액 성격 표시라 따로 남긴다(「원 경정 …」처럼 이름 끝과 함께 올 수 있음).
      const marker = /(^|\s)(경정|기정|당초|증액|감액|신규|변경)$/.exec(head);
      if (marker) {
        (last.markers ??= []).push(marker[2]);
        head = head.slice(0, marker.index).trim();
      }
      if (head && !/\d/.test(head)) last.name = (last.name + (/^[가-힣]{1,2}$/.test(head) ? "" : " ") + head).trim();
      last.formula = (head && !/\d/.test(head)) || marker ? line.slice(at).trim() : line;
    }
    else if (last.formula) last.formula += " " + line;
    else last.name = (last.name + " " + line).trim();
  }
  return items;
}

const DEPTH = { department: 0, policy: 1, unit: 2, detail_project: 3, object_group: 4, object: 5, item: 6, sub_item: 7, unresolved: 3 };
const depth = (line) => DEPTH[line.level] ?? 9;
const expected = (item) => {
  if (item.level !== "item" && item.level !== "sub_item") return null;
  return thousandCandidates(evaluateFormula(item.formula_text ?? item.formula));
};

/** parse 디렉터리(document.json·tables.jsonl)에서 예산서 행을 만든다. */
export function extractBudgetLines(parseDir, meta = {}) {
  const document = JSON.parse(readFileSync(path.join(parseDir, "document.json"), "utf8"));
  const tables = new Map(readFileSync(path.join(parseDir, "tables.jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).map((table) => [table.table_id, table]));
  const lines = [];
  const problems = [];
  const context = { department: null, policy: null, unit: null, detail: null, group: null, object: null, item: null };
  let lastAmountLine = null;
  let header = {};
  const headerNames = { policy: new Set(), unit: new Set() };
  const add = (row) => {
    const parentKey = { department: null, unresolved: null, policy: "department", unit: "policy", detail_project: "unit", object_group: "detail", object: "group", item: "object", sub_item: "item" }[row.level];
    const parent = parentKey ? context[parentKey] : null;
    const line = { line_no: lines.length + 1, parent_line_no: parent?.line_no ?? null, ...row, amount_thousand_krw: null, amount_basis: null, funding: [], formula_value_krw: null, checks: {} };
    lines.push(line);
    const slot = { department: "department", policy: "policy", unit: "unit", detail_project: "detail", object_group: "group", object: "object", item: "item" }[row.level];
    if (slot) {
      context[slot] = line;
      const order = ["department", "policy", "unit", "detail", "group", "object", "item"];
      for (const key of order.slice(order.indexOf(slot) + 1)) context[key] = null;
    }
    return line;
  };
  const pending = [];
  const columnHeaders = new Set();
  // 지금 읽는 행의 오른쪽 두 칸(본예산: 전년도예산액·비교증감, 추경: 기정예산액·비교증감). 금액 칸에서 이 행에 놓인 값(행 금액·재원 금액)을
  // 순서대로 entity로 모은 뒤, 「금액 − 앞 칸 = 비교증감」이 되는 짝으로만 맞춘다(붙어 나온 숫자도 이 식으로만 나눔). 값이 없는 entity는 건너뛸 수 있다.
  let rowSide = null;
  let sink = null;
  const pendingPush = (entry) => { if (rowSide && !entry.sharesCell) { entry.side = rowSide; rowSide = null; } pending.push(entry); };
  /** 이름 없는 이어짐 행: 금액·오른쪽 칸을 대기 중인 이름 행에 붙인다. */
  const appendPending = (amountText) => {
    const entry = pending[pending.length - 1];
    entry.amountText += "\n" + amountText;
    if (rowSide) { entry.side = entry.side ? { previous: entry.side.previous + "\n" + rowSide.previous, change: entry.side.change + "\n" + rowSide.change } : rowSide; rowSide = null; }
  };
  const alignSide = (side, entities, where) => {
    const clean = (text) => text.split("\n").map((part) => part.trim()).filter(Boolean).join("\n");
    const prev = clean(side.previous);
    const chg = clean(side.change);
    if (!prev && !chg) return;
    const picked = [];
    let steps = 0;
    const skip = (text, at) => (text[at] === "\n" ? at + 1 : at);
    const search = (j, pi, ci) => {
      if ((steps += 1) > 50_000) return false;
      pi = skip(prev, pi); ci = skip(chg, ci);
      if (pi >= prev.length && ci >= chg.length) return true;
      if (j >= entities.length || pi >= prev.length || ci >= chg.length) return false;
      const end = prev.indexOf("\n", pi) === -1 ? prev.length : prev.indexOf("\n", pi);
      for (let k = pi + 1; k <= Math.min(end, pi + 16); k += 1) {
        const piece = prev.slice(pi, k);
        const previous = parseAmount(piece);
        if (previous === null) continue;
        const change = formatThousands(entities[j].value - previous);
        if (!chg.startsWith(change, ci)) continue;
        picked.push({ entity: entities[j], previous: piece, change });
        if (search(j + 1, k, ci + change.length)) return true;
        picked.pop();
      }
      // 이 entity에는 오른쪽 값이 없다(본예산의 부기 등): 건너뛰고 다음 entity로 맞춘다.
      return search(j + 1, pi, ci);
    };
    if (!entities.length || !search(0, 0, 0)) {
      problems.push({ code: "SIDE_COLUMNS_UNALIGNED", where, text: prev.replace(/\n/g, " ") + " / " + chg.replace(/\n/g, " ") });
      return;
    }
    for (const { entity, previous, change } of picked) {
      const target = entity.kind === "amount" ? entity.line : entity.line.funding[entity.index];
      target.previous_amount_thousand_krw = previous;
      target.change_amount_thousand_krw = change;
    }
  };
  let orphanFragment = null;
  const LEVELS_FROM_END = ["detail_project", "unit", "policy", "department"];
  /** 모은 이름 행을 정한다. beforeObjectGroup이면 마지막이 세부사업, 아니면(문서 끝·통계목 앞) 판정하지 않고 검토로 남긴다. */
  const flushPending = (beforeObjectGroup) => {
    const created = [];
    if (!pending.length) return created;
    const rows = pending.splice(0);
    if (!beforeObjectGroup || rows.length > LEVELS_FROM_END.length) {
      for (const row of rows) problems.push({ code: "NAME_ROW_UNRESOLVED", where: row.where, text: row.name.slice(0, 60) });
    }
    rows.forEach((row, index) => {
      const fromEnd = rows.length - 1 - index;
      const level = beforeObjectGroup ? LEVELS_FROM_END[Math.min(fromEnd, LEVELS_FROM_END.length - 1)] : "unresolved";
      const line = add({ level, code: null, name: row.name, evidence: row.evidence });
      if (row.fragment) {
        line.checks.name_fragment_rejoined = "moved_by_table_reconstruction";
        line.fragment_text = row.fragment;
      }
      if (row.annotations) line.annotations = row.annotations;
      created.push(line);
      if (!row.sharesCell) {
        const own = [];
        const saved = sink;
        sink = own;
        assign([line], amountTokens(row.amountText), row.where);
        sink = saved;
        if (row.side) alignSide(row.side, own, row.where);
      }
    });
    return created;
  };
  /** 금액 슬롯(행 순서)과 금액 토큰을 맞춘다. 붙은 숫자는 산출식 기대값으로만 나눈다. */
  const assign = (slots, tokens, where) => {
    const plain = tokens.filter(token => token.kind === "amount");
    if (plain.length && plain.length < slots.length && tokens.every(token => token.kind !== "funding_glued")) {
      const aligned = uniqueRowAmounts(plain.map(token => token.text), slots.map(expected));
      if (aligned) {
        let index = 0;
        tokens = tokens.flatMap(token => {
          if (token.kind !== "amount") return [token];
          const pieces = aligned[index++];
          return pieces.map(text => ({ ...token, text, uniqueSplit: pieces.length > 1 }));
        });
      }
    }
    let at = 0;
    for (let ti = 0; ti < tokens.length; ti += 1) {
      const token = tokens[ti];
      if (token.kind === "funding_glued") {
        const target = lastAmountLine;
        const total = target ? parseAmount(target.amount_thousand_krw ?? "") : null;
        const have = target ? target.funding.reduce((a, f) => a + parseAmount(f.amount_thousand_krw), 0) : 0;
        const pick = total === null ? [] : token.splits.filter((i) => have + parseAmount(token.text.slice(0, i)) === total);
        if (target && pick.length === 1) {
          target.funding.push({ source: token.source, label: token.label, amount_thousand_krw: token.text.slice(0, pick[0]), split: "funding_sum" });
          sink?.push({ kind: "funding", line: target, index: target.funding.length - 1, value: parseAmount(token.text.slice(0, pick[0])) });
          tokens.splice(tokens.indexOf(token) + 1, 0, { kind: "amount", text: token.text.slice(pick[0]) });
        } else problems.push({ code: "FUNDING_UNATTACHED", where, text: token.label + " " + token.text });
        continue;
      }
      if (token.kind === "funding") {
        const target = lastAmountLine;
        const value = parseAmount(token.text);
        if (target && value !== null) {
          target.funding.push({ source: token.source, label: token.label, amount_thousand_krw: token.text });
          sink?.push({ kind: "funding", line: target, index: target.funding.length - 1, value });
        }
        else problems.push({ code: "FUNDING_UNATTACHED", where, text: token.label + " " + token.text });
        continue;
      }
      if (at >= slots.length) { problems.push({ code: "EXTRA_AMOUNT", where, text: token.text }); continue; }
      const value = parseAmount(token.text);
      if (value !== null) {
        slots[at].amount_thousand_krw = token.text; slots[at].amount_basis = token.uniqueSplit ? "source_cell_unique_row_split" : "source_cell"; lastAmountLine = slots[at];
        sink?.push({ kind: "amount", line: slots[at], value });
        at += 1;
        continue;
      }
      const window = slots.slice(at);
      const expectations = window.map((slot) => { const e = expected(slot); return e && e.length ? e : slot.level === "object" || slot.level === "object_group" || slot.level === "item" || slot.level === "sub_item" ? "free" : []; });
      // 자유 칸은 바로 뒤 자식 칸들의 합과 같아야 한다(통계목 = 부기 합, 부기 = 하위항목 합).
      const accept = (pieces) => window.slice(0, pieces.length).every((slot, i) => {
        if (expectations[i] !== "free") return true;
        const kids = [];
        for (let j = i + 1; j < pieces.length; j += 1) { if (window[j].parent_line_no === slot.line_no) kids.push(parseAmount(pieces[j])); else if (depth(window[j]) <= depth(slot)) break; }
        if (!kids.length) return i === pieces.length - 1;
        return kids.reduce((a, b) => a + b, 0) === parseAmount(pieces[i]);
      });
      const pieces = segmentGlued(token.text, expectations, accept);
      if (pieces) {
        for (const piece of pieces) { slots[at].amount_thousand_krw = piece; slots[at].amount_basis = "source_cell_split_by_formula"; lastAmountLine = slots[at]; sink?.push({ kind: "amount", line: slots[at], value: parseAmount(piece) }); at += 1; }
      } else {
        problems.push({ code: "AMOUNT_UNSPLITTABLE", where, text: token.text });
        for (let rest = at; rest < slots.length; rest += 1) slots[rest].amount_basis = "unverified_alignment_lost";
        return;
      }
    }
    for (let rest = at; rest < slots.length; rest += 1) if (!slots[rest].amount_basis) slots[rest].amount_basis = "missing_in_cell";
  };

  for (const block of document.blocks) {
    if (block.type !== "table") {
      const found = pageHeader([block.parsed_text_verbatim ?? ""]);
      header = { ...header, ...found, page: block.page };
      if (found.policy) headerNames.policy.add(squash(found.policy));
      if (found.unit) headerNames.unit.add(squash(found.unit));
      continue;
    }
    const table = tables.get(block.table_id);
    if (!table) continue;
    const rows = new Map();
    for (const cell of table.cells) (rows.get(cell.anchor_row) ?? rows.set(cell.anchor_row, []).get(cell.anchor_row)).push(cell);
    const ordered = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, cells]) => cells.sort((a, b) => a.anchor_col - b.anchor_col));
    const columns = table.logical_columns;
    for (let r = 0; r < ordered.length; r += 1) {
      const cells = ordered[r];
      // 금액 오른쪽 두 칸(본예산: 전년도예산액·비교증감, 추경: 기정예산액·비교증감)은 그 행의 첫 예산 행 값이다.
      const sideText = (offset) => (cells.find((cell) => cell.anchor_col === columns - offset)?.parsed_text_verbatim ?? "").trim();
      const side = { previous: sideText(2), change: sideText(1) };
      rowSide = side.previous || side.change ? side : null;
      const own = [];
      sink = own;
      handleRow(cells);
      sink = null;
      if (rowSide) alignSide(rowSide, own, { page: block.page, table_id: table.table_id, row: cells[0].anchor_row });
    }
    function handleRow(cells) {
      const label = cells.filter((cell) => cell.anchor_col < columns - 3).map((cell) => cell.parsed_text_verbatim ?? "").filter(Boolean).join("\n").trim();
      const amountCell = cells.find((cell) => cell.anchor_col === columns - 3);
      const amountText = amountCell?.parsed_text_verbatim ?? "";
      if (/부서.*정책.*세부사업/.test(squash(label))) {
        // 머리 행: 오른쪽 두 칸의 이름(본예산 「전년도예산액·비교증감」, 추경 「기정예산액·비교증감」)을 문서 열 정의로 남긴다.
        const names = ["amount", "previous", "change"].map((_, i) => squash(cells.find((cell) => cell.anchor_col === columns - 3 + i)?.parsed_text_verbatim ?? ""));
        columnHeaders.add(names.join("|"));
        rowSide = null;
        return;
      }
      const where = { page: block.page, table_id: table.table_id, row: cells[0].anchor_row, cell_id: amountCell?.cell_id ?? null };
      const first = label.split("\n")[0]?.trim() ?? "";
      const evidence = { page: block.page, block_id: block.block_id, table_id: table.table_id, row: cells[0].anchor_row };
      if (!label) {
        // 이름 없는 행은 앞 행(같은 쪽 또는 앞 쪽)의 재원·금액 이어짐이다.
        if (pending.length) appendPending(amountText);
        else assign([], amountTokens(amountText), where);
        return;
      }
      if (OBJECT_GROUP.test(first) || OBJECT.test(first) || ITEM_MARK.test(first) || SUB_MARK.test(first)) {
        flushPending(OBJECT_GROUP.test(first));
        const rowLines = [];
        for (const item of splitDetailLines(label, Boolean(context.item))) {
          if (item.level === "unknown") { problems.push({ code: "LINE_UNCLASSIFIED", where, text: item.name.slice(0, 60) }); return; }
          if ((item.level === "item" || item.level === "sub_item") && !context.object) problems.push({ code: "ITEM_WITHOUT_OBJECT", where, text: item.name.slice(0, 60) });
          const line = add({ level: item.level, code: item.code, name: item.name, formula_text: item.formula, source_text: item.lines.join("\n"), evidence, ...(item.markers ? { annotations: [...item.markers] } : {}) });
          const value = evaluateFormula(item.formula);
          line.formula_value_krw = value === null ? null : Math.round(value * 1000) / 1000;
          rowLines.push(line);
        }
        assign(rowLines, amountTokens(amountText), where);
        return;
      }
      const labelLines = label.split("\n").map((line) => line.trim()).filter(Boolean);
      const codeAt = labelLines.findIndex((line) => OBJECT_GROUP.test(line) || OBJECT.test(line) || ITEM_MARK.test(line) || SUB_MARK.test(line));
      const lastLine = lines[lines.length - 1];
      if (codeAt > 0 && !OBJECT_GROUP.test(labelLines[codeAt])) {
        // 통계목·부기 앞의 이름 조각은 앞 행 이름이 줄바꿈으로 넘어온 것이다(새 사업이 아님).
        if (pending.length) pending[pending.length - 1].name += " " + labelLines.slice(0, codeAt).join(" ");
        else if (lastLine) { lastLine.name = (lastLine.name + " " + labelLines.slice(0, codeAt).join(" ")).trim(); lastLine.checks.name_continued = "next_row"; }
        const rowLines = [];
        for (const item of splitDetailLines(labelLines.slice(codeAt).join("\n"), Boolean(context.item))) {
          const line = add({ level: item.level, code: item.code, name: item.name, formula_text: item.formula, source_text: item.lines.join("\n"), evidence, ...(item.markers ? { annotations: [...item.markers] } : {}) });
          const value = evaluateFormula(item.formula);
          line.formula_value_krw = value === null ? null : Math.round(value * 1000) / 1000;
          rowLines.push(line);
        }
        flushPending(false);
        assign(rowLines, amountTokens(amountText), where);
        return;
      }
      const detailCount = codeAt > 0 ? splitDetailLines(labelLines.slice(codeAt).join("\n"), false).length : 0;
      const plainAmounts = amountTokens(amountText).filter((token) => token.kind === "amount").length;
      if (codeAt > 0 && plainAmounts <= detailCount) {
        // 이름 조각에 금액이 없다: 표 셀 배정 과정에서 아래 행 이름 앞부분이 이 셀로 옮겨진 것(원문 쪽 대조로 확인한 kordoc 결과 특성).
        orphanFragment = labelLines.slice(0, codeAt).join(" ");
        flushPending(true);
        const rowLines = [];
        for (const item of splitDetailLines(labelLines.slice(codeAt).join("\n"), false)) rowLines.push(add({ level: item.level, code: item.code, name: item.name, formula_text: item.formula, source_text: item.lines.join("\n"), evidence, ...(item.markers ? { annotations: [...item.markers] } : {}) }));
        assign(rowLines, amountTokens(amountText), where);
        return;
      }
      if (codeAt > 0) {
        // 편성목 앞의 이름 줄은 새 이름 행(세부사업 등)이고 같은 셀의 금액을 함께 쓴다.
        pendingPush({ name: labelLines.slice(0, codeAt).join(" "), amountText: "", evidence, where, sharesCell: true });
        const created = flushPending(true);
        const rowLines = [created[created.length - 1]];
        for (const item of splitDetailLines(labelLines.slice(codeAt).join("\n"), false)) rowLines.push(add({ level: item.level, code: item.code, name: item.name, formula_text: item.formula, source_text: item.lines.join("\n"), evidence, ...(item.markers ? { annotations: [...item.markers] } : {}) }));
        rowLines[0].amount_basis = null;
        assign(rowLines, amountTokens(amountText), where);
        return;
      }
      if (FORMULA_START.test(label) && (lastLine?.level === "item" || lastLine?.level === "sub_item") && !pending.length) {
        // 「8,360,000원」「수련회 2,000,000원」: 줄바꿈으로 넘어온 직전 부기의 이름·산출식.
        const joined = labelLines.join(" ");
        const at = joined.search(FORMULA_START);
        if (at > 0) lastLine.name = (lastLine.name + " " + joined.slice(0, at)).trim();
        lastLine.formula_text = ((lastLine.formula_text ?? "") + " " + joined.slice(Math.max(at, 0))).trim();
        lastLine.source_text = (lastLine.source_text ?? "") + "\n" + label;
        const value = evaluateFormula(lastLine.formula_text);
        lastLine.formula_value_krw = value === null ? null : Math.round(value * 1000) / 1000;
        lastLine.checks.name_continued = "next_row";
        assign(lastLine.amount_thousand_krw === null ? [lastLine] : [], amountTokens(amountText), where);
        return;
      }
      if (!amountTokens(amountText).some((token) => token.kind === "amount")) {
        // 자기 금액이 없는 이름 행(예: 「신규」)은 예산 행이 아니라 앞 행의 표시다. 재원 이어짐만 앞 행에 붙인다.
        const target = pending.length ? null : lines[lines.length - 1];
        if (target) (target.annotations ??= []).push(labelLines.join(" "));
        else if (pending.length) (pending[pending.length - 1].annotations ??= []).push(labelLines.join(" "));
        if (pending.length) appendPending(amountText); else assign([], amountTokens(amountText), where);
        return;
      }
      // 이름만 있는 행: 다음 편성목(세 자리 코드)이 나올 때까지 모아 끝에서부터 세부사업·단위·정책·부서로 정한다.
      pendingPush({ name: (orphanFragment ? orphanFragment + " " : "") + labelLines.join(" "), amountText, evidence, where, fragment: orphanFragment });
      orphanFragment = null;
    }
  }
  flushPending(false);
  for (const line of lines) if ((line.level === "policy" || line.level === "unit") && !headerNames[line.level].has(squash(line.name))) line.checks.page_header = "not_in_headers";
  else if (line.level === "policy" || line.level === "unit") line.checks.page_header = "match";
  relocateFragments(lines);
  verify(lines, problems);
  for (const line of lines) delete line.fragment_text;
  return { extractor_version: EXTRACTOR_VERSION, ...meta, amount_columns: [...columnHeaders], lines, problems, summary: summarize(lines, problems) };
}

/**
 * 병합된 왼쪽 칸에 들어간 이름 조각(예: 「지진」)은 원문 근거가 있을 때만 이름에 붙인다. 근거: 그 세부사업 아래 부기(원문 Ο 행) 이름이
 * 「조각 + 세부사업명」으로 시작한다. 바로 다음 이름 행에 근거가 없고 같은 상위 아래 뒤쪽 세부사업에 근거가 있으면 그쪽으로 옮긴다.
 * 어디에도 근거가 없으면 이름에서 떼어 「배치 근거 없는 이름 조각」 표시로만 남긴다(검토 대상).
 */
function relocateFragments(lines) {
  const byNo = new Map(lines.map((line) => [line.line_no, line]));
  const under = (root) => lines.filter((line) => { for (let at = byNo.get(line.parent_line_no); at; at = byNo.get(at.parent_line_no)) if (at === root) return true; return false; });
  // 부기 이름이 줄바꿈으로 잘린 경우(「…지원」 → 「…지」)도 근거로 본다: 부기 이름이 조각으로 시작하고, 「조각+세부사업명」과 앞부분이 서로 겹치면 된다.
  const supported = (line, fragment, baseName) => under(line).some((item) => {
    if (item.level !== "item") return false;
    const name = squash(item.name);
    const full = fragment + squash(baseName);
    return name.startsWith(fragment) && name.length > fragment.length + 1 && (name.startsWith(full) || full.startsWith(name));
  });
  for (const line of lines.filter((item) => item.fragment_text)) {
    if (!line.name.startsWith(line.fragment_text)) continue;
    const fragment = squash(line.fragment_text);
    const baseName = line.name.slice(line.fragment_text.length).trim();
    if (supported(line, fragment, baseName)) {
      line.checks.name_fragment_rejoined = "supported_by_item_name";
      continue;
    }
    line.name = baseName;
    const target = lines.find((other) => other.level === line.level && other.parent_line_no === line.parent_line_no && other.line_no > line.line_no && supported(other, fragment, other.name));
    if (target) {
      target.name = line.fragment_text + " " + target.name;
      line.checks.name_fragment_rejoined = "moved_to_later_sibling_by_item_name";
      target.checks.name_fragment_rejoined = "received_by_item_name";
    } else {
      line.checks.name_fragment_rejoined = "unplaced_no_evidence";
      (line.annotations ??= []).push("배치 근거 없는 이름 조각: " + line.fragment_text);
    }
  }
}

/** 검산: 부모 금액 = 직계 자식 금액 합(자식이 모두 금액을 가진 경우만), 부기 금액 ∈ 산출식 값의 천원 표시 후보. */
function verify(lines, problems) {
  const children = new Map();
  for (const line of lines) if (line.parent_line_no) (children.get(line.parent_line_no) ?? children.set(line.parent_line_no, []).get(line.parent_line_no)).push(line);
  for (const line of lines) {
    const value = line.amount_thousand_krw === null ? null : parseAmount(line.amount_thousand_krw);
    if ((line.level === "item" || line.level === "sub_item") && line.formula_text) {
      const candidates = thousandCandidates(evaluateFormula(line.formula_text));
      line.checks.formula = !candidates.length ? "not_computable" : value === null ? "no_amount" : candidates.includes(value) ? "match" : "mismatch";
      if (line.checks.formula === "mismatch") problems.push({ code: "FORMULA_MISMATCH", where: line.evidence, text: line.name.slice(0, 40) + " " + line.amount_thousand_krw + " vs " + candidates.join("/") });
    }
    const kids = (children.get(line.line_no) ?? []).filter((kid) => kid.level !== "sub_item" || line.level === "item");
    if (kids.length && value !== null) {
      const values = kids.map((kid) => (kid.amount_thousand_krw === null ? null : parseAmount(kid.amount_thousand_krw)));
      if (values.every((v) => v !== null)) {
        const sum = values.reduce((a, b) => a + b, 0);
        // 추경 사업명세서는 바뀐 하위 항목만 싣는다. 그때는 상위 금액 ≠ 하위 합이어도 「상위 비교증감 = 하위 비교증감 합」이면(빠진 항목은 증감 0) 맞는 문서다.
        const kidChanges = kids.map((kid) => (kid.change_amount_thousand_krw ? parseAmount(kid.change_amount_thousand_krw) : null));
        const ownChange = line.change_amount_thousand_krw ? parseAmount(line.change_amount_thousand_krw) : null;
        const changeMatches = ownChange !== null && kidChanges.every((item) => item !== null) && kidChanges.reduce((a, b) => a + b, 0) === ownChange;
        line.checks.children_sum = sum === value ? "match" : changeMatches ? "partial_listing_change_match" : "mismatch";
        if (sum !== value && !changeMatches) problems.push({ code: "CHILD_SUM_MISMATCH", where: line.evidence, text: line.level + " " + line.name.slice(0, 40) + " " + value + " vs " + sum });
      } else line.checks.children_sum = "incomplete";
    }
    if (line.previous_amount_thousand_krw !== undefined) {
      // 오른쪽 두 칸은 「금액 − 앞 칸 = 비교증감」으로만 맞춰 붙였다. 독립 검산은 아래 「앞 칸 상위 = 하위 합」이다.
      const previous = parseAmount(line.previous_amount_thousand_krw);
      const change = parseAmount(line.change_amount_thousand_krw);
      line.checks.side_columns = value === null || previous === null || change === null ? "not_checkable" : value - previous === change ? "match" : "mismatch";
      const kidPrevious = (children.get(line.line_no) ?? []).filter((kid) => kid.level !== "sub_item" || line.level === "item").map((kid) => (kid.previous_amount_thousand_krw === undefined ? null : parseAmount(kid.previous_amount_thousand_krw)));
      if (kidPrevious.length && previous !== null) {
        if (kidPrevious.every((item) => item !== null)) {
          const sum = kidPrevious.reduce((a, b) => a + b, 0);
          // 앞 칸(전년도·기정액) 상위값에는 이번 문서에 행이 없는 사업(폐지·감액 0원 등)이 들어 있을 수 있어 상위 > 하위 합은 설명 가능한 차이다. 상위 < 하위 합만 문제다.
          line.checks.previous_children_sum = sum === previous ? "match" : previous > sum ? "parent_includes_unlisted" : "mismatch";
          if (previous < sum) problems.push({ code: "PREVIOUS_CHILD_SUM_MISMATCH", where: line.evidence, text: line.level + " " + line.name.slice(0, 40) + " " + previous + " vs " + sum });
        } else line.checks.previous_children_sum = "incomplete";
      }
    } else {
      line.previous_amount_thousand_krw = null;
      line.change_amount_thousand_krw = null;
    }
    if (line.funding.length && value !== null) {
      const sum = line.funding.reduce((a, f) => a + parseAmount(f.amount_thousand_krw), 0);
      line.checks.funding_sum = sum === value ? "match" : "partial_or_mismatch";
    }
  }
}

function summarize(lines, problems) {
  const by = (key) => lines.reduce((acc, line) => ((acc[line[key]] = (acc[line[key]] ?? 0) + 1), acc), {});
  const checks = {};
  for (const line of lines) for (const [k, v] of Object.entries(line.checks)) (checks[k] ??= {})[v] = (checks[k][v] ?? 0) + 1;
  return { lines: lines.length, by_level: by("level"), by_amount_basis: by("amount_basis"), checks, problems: problems.reduce((acc, p) => ((acc[p.code] = (acc[p.code] ?? 0) + 1), acc), {}) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  const parseDir = process.argv[2];
  const result = extractBudgetLines(parseDir);
  console.log(JSON.stringify(result.summary, null, 1));
  if (process.argv[3]) (await import("node:fs")).writeFileSync(process.argv[3], JSON.stringify(result, null, 1));
}
