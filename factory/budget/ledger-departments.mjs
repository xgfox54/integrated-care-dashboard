import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeName } from "./match-departments.mjs";
import { mergeReviewed } from "./department-corpus.mjs";
import { validateApiPage } from "./bulk-departments.mjs";

// Department names from a city's own published budget-ledger export (세입세출예산 운용현황: 부서명·세부사업명·금액).
// Unlike the adopted book this lists the department currently responsible for each 세부사업.
// Rule: same year/entity/account; a 세부사업명 counts only when it is unique on both sides; every unique pair of a code
// must name one department; at least two pairs, and at least two of them corroborated by an exact non-zero amount
// (budget or expenditure) on the same observation; out-of-scope units (읍·면·동, 의회, standalone 보건소·도서관) are never named.

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function unzipEntries(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw Error("NOT_ZIP");
  const count = bytes.readUInt16LE(end + 10), out = new Map();
  let at = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(at) !== 0x02014b50) throw Error("BAD_ZIP_DIRECTORY");
    const method = bytes.readUInt16LE(at + 10), size = bytes.readUInt32LE(at + 20), nameLength = bytes.readUInt16LE(at + 28), extra = bytes.readUInt16LE(at + 30), comment = bytes.readUInt16LE(at + 32), local = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28), data = bytes.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw Error("UNSUPPORTED_ZIP_METHOD");
    out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    at += 46 + nameLength + extra + comment;
  }
  return out;
}

const xmlText = (s) => s.replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&amp;/gu, "&");
export function xlsxRows(bytes) {
  const files = unzipEntries(bytes);
  const shared = [...(files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/gu)].map((m) => [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/gu)].map((t) => xmlText(t[1])).join(""));
  const sheets = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(k));
  if (sheets.length !== 1) throw Error("EXPECTED_ONE_SHEET");
  const col = (ref) => [...ref.replace(/\d+$/u, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return [...files.get(sheets[0]).toString("utf8").matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gu)].map((row) => {
    const cells = [];
    for (const c of row[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
      const body = c[3] ?? "", v = body.match(/<v>([^<]*)<\/v>/u)?.[1], inline = body.match(/<t[^>]*>([^<]*)<\/t>/u)?.[1];
      cells[col(c[1])] = /t="s"/u.test(c[2]) ? shared[Number(v)] : xmlText(v ?? inline ?? "");
    }
    return Array.from(cells, (x) => x ?? "");
  });
}

// 보건소 본소는 범위 안이다(2026-10-09 운영자 지시: 보건정책과·건강증진과 등 과 단위 사업이 보건소 부서코드 하나에 묶여 있다).
// 분소인 보건지소·보건센터·보건진료소는 계속 제외한다.
export const outOfScope = (name) => /(?:회계과|총무과|체육진흥과)$/u.test(name) || /(?:읍|면|동)(?:행정복지센터|주민센터|사무소)?$/u.test(name) || /의회/u.test(name) || /(?:보건지소|보건센터|보건진료소|도서관)$/u.test(name);

export function htmlTableRows(bytes, tableId = null) {
  let html = bytes.toString("utf8");
  if (tableId) {
    const start = html.search(new RegExp("<table\\b[^>]*\\bid=[\"']" + tableId + "[\"']", "u"));
    if (start < 0) throw Error("LEDGER_TABLE_MISSING");
    html = html.slice(start, html.indexOf("</table>", start) + 8);
  }
  const text = (cell) => xmlText(cell.replace(/<br\s*\/?>/giu, "").replace(/<[^>]*>/gu, "")).replace(/\s+/gu, " ").trim();
  const header = [...(html.match(/<thead\b[^>]*>[\s\S]*?<tr\b[^>]*>([\s\S]*?)<\/tr>/iu)?.[1] ?? "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/giu)].map((m) => text(m[1]));
  const body = html.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/iu)?.[1] ?? "";
  const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)].map((row) => [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/giu)].map((m) => text(m[1])));
  return [header, ...rows];
}
// Some exports write numbers as "6.85684E8"; expand them exactly instead of going through floating point.
export function amount(text) {
  const m = String(text ?? "").replace(/,/gu, "").trim().match(/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u);
  if (!m) throw Error("BAD_AMOUNT");
  const digits = m[2] + (m[3] ?? ""), shift = Number(m[4] ?? 0) - (m[3] ?? "").length;
  if (shift < 0 && !/^0*$/u.test(digits.slice(shift))) throw Error("FRACTIONAL_AMOUNT");
  const whole = shift < 0 ? digits.slice(0, shift) || "0" : digits + "0".repeat(shift);
  return (BigInt(m[1] + whole)).toString();
}

export function ledgerRows(rows, config) {
  const headerRow = config.header_row ?? 0;
  const header = rows[headerRow]?.map(normalizeName) ?? [];
  if (JSON.stringify(header) !== JSON.stringify(config.export_header.map(normalizeName))) throw Error("LEDGER_HEADER_CHANGED");
  const c = config.columns, at = (name) => typeof name === "number" ? name : header.indexOf(normalizeName(name));
  const width = config.row_width ?? null;
  const isData = (r) => width !== null ? r.length === width : /^[\d,]+$/u.test(String(r[at(c.number ?? "번호")] ?? "").trim());
  return rows.slice(config.data_start ?? headerRow + 1).filter(isData).map((r) => ({ account_name: c.account === null ? null : normalizeName(r[at(c.account)]), department_name: normalizeName(config.department_prefix ? String(r[at(c.department)] ?? "").trim().split(/\s+/u).filter((word, index, words) => !(index === 0 && words.length > 1 && new RegExp(config.department_prefix, "u").test(word))).join("") : r[at(c.department)]), name: r[at(c.name)], budget_krw: amount(r[at(c.budget)]), expenditure_krw: amount(r[at(c.expenditure)]) }));
}

export function matchLedger(items, rows, config, sourceUrl) {
  const accountCode = new Map(items.map((i) => [normalizeName(i.account.name), i.account.code]));
  const key = (account, name) => account + "|" + normalizeName(name);
  const count = (list, k) => list.reduce((m, x) => m.set(k(x), (m.get(k(x)) ?? 0) + 1), new Map());
  const accountless = rows.length > 0 && rows.every((r) => r.account_name === null);
  const apiKey = (i) => key(accountless ? "*" : i.account.code, i.name) + (config.exact_budget_key ? "|" + String(i.current_budget_krw) : "");
  const rowKey = (r) => key(accountless ? "*" : accountCode.get(r.account_name) ?? "?", r.name) + (config.exact_budget_key ? "|" + r.budget_krw : "");
  const apiCount = count(items, apiKey), rowCount = count(rows, rowKey), rowByKey = new Map(rows.map((r) => [rowKey(r), r]));
  const byCode = new Map();
  for (const item of items) {
    const k = apiKey(item);
    if (apiCount.get(k) !== 1 || rowCount.get(k) !== 1 || (config.exact_budget_key && String(item.current_budget_krw) === "0")) continue;
    const row = rowByKey.get(k);
    const corroborated = (row.expenditure_krw !== "0" && row.expenditure_krw === String(item.public_expenditure_krw)) || (row.budget_krw !== "0" && row.budget_krw === String(item.current_budget_krw));
    if (!byCode.has(item.department_code)) byCode.set(item.department_code, []);
    byCode.get(item.department_code).push({ project_id: item.fiscal_project_id, fiscal_year: item.fiscal_year, reference_date: item.reference_date, fiscal_entity_name: item.fiscal_entity.name, department_code: item.department_code, account_code: item.account.code, name: item.name, corroborated, document: { department_name: row.department_name, budget_krw: row.budget_krw, expenditure_krw: row.expenditure_krw, department_basis: "official_budget_ledger_export_row", source_url: sourceUrl } });
  }
  const mappings = [], held = [];
  for (const [code, evidence] of [...byCode].sort(([a], [b]) => a.localeCompare(b))) {
    const names = [...new Set(evidence.map((e) => e.document.department_name))];
    const distinct = (list) => new Set(list.map((e) => normalizeName(e.name))).size;
    const reason = names.length !== 1 ? "conflicting_departments" : !names[0] ? "missing_department_name" : outOfScope(names[0]) ? "out_of_scope_unit" : distinct(evidence) < 2 ? "insufficient_independent_projects" : distinct(evidence.filter((e) => e.corroborated)) < 2 ? "insufficient_amount_corroboration" : null;
    const first = evidence[0];
    const entry = { fiscal_year: first.fiscal_year, reference_date: first.reference_date, fiscal_entity_name: first.fiscal_entity_name, department_code: code, department_name: reason ? null : names[0], status: reason ? "held" : "verified_exact", basis: "official_budget_ledger_export", evidence };
    if (reason) held.push({ ...entry, reason, names }); else mappings.push(entry);
  }
  return { mappings, held };
}

export function revtesRows(pages) {
  const list = pages.flatMap((page) => page.dataList ?? []);
  return list.map((r) => ({ account_code: String(r.fisFgCd), account_name: normalizeName(r.fisFgNm), department_code: String(r.deptCd ?? ""), department_name: normalizeName(r.deptNm ?? ""), project_code: String(r.dbizCd), name: r.dbizNm, budget_krw: amount(r.bgtCurrAmt), expenditure_krw: amount(r.expdAmt) }));
}

// 세입세출예산 운용상황 공개 화면(revtes)은 행마다 부서코드와 세부사업코드를 준다. 지방재정365 세부사업코드·회계코드가 같은 행만 잇고,
// 이은 행의 부서코드가 지방재정365 부서코드와 하나라도 다르면 그 부서코드는 보류한다. 금액까지 같은 사업이 하나 이상 있어야 한다.
export function matchByProjectCode(items, rows, sourceUrl, requireAmount = true) {
  const accountByName = new Map(items.map((i) => [normalizeName(i.account.name), i.account.code]));
  const rowByKey = new Map(rows.map((r) => [(r.account_code ?? accountByName.get(normalizeName(r.account_name)) ?? "?") + "|" + r.project_code, r]));
  if (rowByKey.size !== rows.length) throw Error("REVTES_DUPLICATE_PROJECT");
  const byCode = new Map();
  for (const item of items) {
    const row = rowByKey.get(item.account.code + "|" + item.source_project_code);
    if (!row) continue;
    const corroborated = (row.expenditure_krw !== "0" && row.expenditure_krw === String(item.public_expenditure_krw)) || (row.budget_krw !== "0" && row.budget_krw === String(item.current_budget_krw));
    if (!byCode.has(item.department_code)) byCode.set(item.department_code, []);
    byCode.get(item.department_code).push({ project_id: item.fiscal_project_id, fiscal_year: item.fiscal_year, reference_date: item.reference_date, fiscal_entity_name: item.fiscal_entity.name, department_code: item.department_code, account_code: item.account.code, name: item.name, corroborated, code_agrees: row.department_code === item.department_code, document: { department_code: row.department_code, department_name: row.department_name, budget_krw: row.budget_krw, expenditure_krw: row.expenditure_krw, department_basis: "official_budget_disclosure_project_code_row", source_url: sourceUrl } });
  }
  const mappings = [], held = [];
  for (const [code, evidence] of [...byCode].sort(([a], [b]) => a.localeCompare(b))) {
    const names = [...new Set(evidence.map((e) => e.document.department_name))];
    const reason = evidence.some((e) => !e.code_agrees) ? "department_code_mismatch" : names.length !== 1 ? "conflicting_departments" : !names[0] ? "missing_department_name" : outOfScope(names[0]) ? "out_of_scope_unit" : new Set(evidence.map((e) => normalizeName(e.name))).size < 2 ? "insufficient_independent_projects" : requireAmount && !evidence.some((e) => e.corroborated) ? "insufficient_amount_corroboration" : null;
    const first = evidence[0];
    const entry = { fiscal_year: first.fiscal_year, reference_date: first.reference_date, fiscal_entity_name: first.fiscal_entity_name, department_code: code, department_name: reason ? null : names[0], status: reason ? "held" : "verified_exact", basis: "official_budget_disclosure_project_code", evidence };
    if (reason) held.push({ ...entry, reason, names }); else mappings.push(entry);
  }
  return { mappings, held };
}

async function revtesPages(entity, dir) {
  const e = entity.export;
  if (new URL(e.url).origin !== new URL(e.referer).origin) throw Error("INVALID_EXPORT");
  const files = [];
  let total = null, pages = 1;
  for (let page = 1; page <= pages; page++) {
    const file = path.join(dir, "revtes-" + String(page).padStart(4, "0") + ".json");
    if (!existsSync(file)) {
      const response = await fetch(e.url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(180000), headers: { referer: e.referer, "content-type": "application/json; charset=UTF-8", "user-agent": "Mozilla/5.0" }, body: JSON.stringify({ ...e.form, page: String(page), rowNum: String(e.page_size ?? 5000) }) });
      if (!response.ok) throw Error("HTTP_" + response.status);
      const body = await response.json();
      if (!Array.isArray(body.dataList)) throw Error("REVTES_NO_LIST");
      writeFileSync(file, JSON.stringify(body));
    }
    const body = JSON.parse(readFileSync(file, "utf8"));
    total ??= body.totalCount; pages = body.totalPages;
    files.push(file);
  }
  return { files, expected: total };
}

// 지출내역 화면(창원 등)은 지출 한 건마다 부서명과 세부사업코드를 준다. 금액은 지출 한 건이라 예산현액과 견줄 수 없다.
// 사업비는 행정구·읍면동으로 재배정되어 그 기관 이름으로도 지출되므로, 세부사업코드·회계가 같은 사업이 서로 다른 사업명으로 두 개 이상 이어지고
// (1) 모든 사업의 지출에 빠짐없이 나오는 부서명이 하나뿐이거나, (2) 행정구 소속·읍면동을 뺀 지출 부서명이 하나뿐일 때만 그 이름을 붙인다.
export function matchBySpendingProjects(items, rows, sourceUrl, subordinatePrefixes = []) {
  const accountCode = new Map(items.map((i) => [normalizeName(i.account.name), i.account.code]));
  const byProject = new Map();
  for (const r of rows) {
    const k = (accountCode.get(normalizeName(r.account_name)) ?? "?") + "|" + r.project_code;
    if (!byProject.has(k)) byProject.set(k, new Set());
    byProject.get(k).add(normalizeName(r.department_name));
  }
  const byCode = new Map();
  for (const item of items) {
    const names = byProject.get(item.account.code + "|" + item.source_project_code);
    if (!names) continue;
    if (!byCode.has(item.department_code)) byCode.set(item.department_code, []);
    byCode.get(item.department_code).push({ project_id: item.fiscal_project_id, fiscal_year: item.fiscal_year, reference_date: item.reference_date, fiscal_entity_name: item.fiscal_entity.name, department_code: item.department_code, account_code: item.account.code, name: item.name, document: { department_names: [...names], department_basis: "official_spending_disclosure_project_code_rows", source_url: sourceUrl } });
  }
  const mappings = [], held = [];
  for (const [code, evidence] of [...byCode].sort(([a], [b]) => a.localeCompare(b))) {
    const names = [...new Set(evidence.flatMap((e) => e.document.department_names))];
    const distinct = new Set(evidence.map((e) => normalizeName(e.name))).size;
    const everywhere = names.filter((n) => evidence.every((e) => e.document.department_names.includes(n)));
    const core = names.filter((n) => n && !outOfScope(n) && !subordinatePrefixes.some((p) => n.startsWith(p)));
    const picks = [...new Set([everywhere.length === 1 ? everywhere[0] : null, core.length === 1 ? core[0] : null].filter((n) => n !== null))];
    const chosen = names.length === 1 ? names : picks.length === 1 ? picks : names;
    const reason = chosen.length !== 1 ? "conflicting_departments" : !chosen[0] ? "missing_department_name" : outOfScope(chosen[0]) ? "out_of_scope_unit" : distinct < 2 || new Set(evidence.filter((e) => e.document.department_names.includes(chosen[0])).map((e) => normalizeName(e.name))).size < 2 ? "insufficient_independent_projects" : null;
    const first = evidence[0];
    const entry = { fiscal_year: first.fiscal_year, reference_date: first.reference_date, fiscal_entity_name: first.fiscal_entity_name, department_code: code, department_name: reason ? null : chosen[0], status: reason ? "held" : "verified_exact", basis: "official_spending_disclosure_project_code", evidence };
    if (reason) held.push({ ...entry, reason, names }); else mappings.push(entry);
  }
  return { mappings, held };
}

async function fetchExport(entity, form) {
  const e = entity.export;
  if (new URL(e.url).protocol !== "https:" || new URL(e.url).origin !== new URL(e.referer).origin) throw Error("INVALID_EXPORT");
  for (let attempt = 0; ; attempt++) {
    try {
      const get = e.method === "GET";
      const target = get ? e.url + (e.url.includes("?") ? "&" : "?") + new URLSearchParams(form).toString() : e.url;
      const response = await fetch(target, get
        ? { redirect: "error", signal: AbortSignal.timeout(180000), headers: { referer: e.referer, "user-agent": "Mozilla/5.0" } }
        : { method: "POST", redirect: "error", signal: AbortSignal.timeout(180000), headers: { referer: e.referer, "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0" }, body: new URLSearchParams(form).toString() });
      if (!response.ok) throw Error("HTTP_" + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      const html = entity.format === "html_table";
      if (bytes.length > 32 * 1024 * 1024 || (html ? !/<table\b/iu.test(bytes.toString("utf8")) : bytes.subarray(0, 2).toString() !== "PK")) throw Error(html ? "NOT_HTML_TABLE" : "NOT_XLSX");
      return bytes;
    } catch (error) { if (attempt === 3) throw error; await new Promise((r) => setTimeout(r, 3000)); }
  }
}

// Exports limited to one screen page (Yongin: 10 rows) are fetched page by page; the row total is read from the
// publisher's own list page for the same year, and the collected rows must add up to it exactly.
async function exportPages(entity, dir) {
  const paged = entity.export.paged;
  if (entity.format === "rows_json") { const file = path.join(dir, "rows.json"); if (!existsSync(file)) throw Error("ROWS_JSON_MISSING"); return { files: [file], expected: null }; }
  if (!paged) { const file = path.join(dir, "ledger-export.xlsx"); if (!existsSync(file)) writeFileSync(file, await fetchExport(entity, entity.export.form)); return { files: [file], expected: null }; }
  const list = await (await fetch(paged.count_url, { signal: AbortSignal.timeout(60000), headers: { "user-agent": "Mozilla/5.0" } })).text();
  if (!new RegExp(paged.year_selected_pattern, "u").test(list)) throw Error("LEDGER_YEAR_CHANGED");
  const total = Number(list.match(new RegExp(paged.count_pattern, "u"))?.[1]);
  if (!Number.isInteger(total) || total < 1 || total > 100000) throw Error("LEDGER_COUNT_MISSING");
  const pages = Math.ceil(total / paged.page_size), files = [];
  mkdirSync(path.join(dir, "pages"), { recursive: true });
  for (let page = 1; page <= pages; page++) {
    const file = path.join(dir, "pages", String(page).padStart(4, "0") + ".xlsx");
    if (!existsSync(file)) { writeFileSync(file, await fetchExport(entity, { ...entity.export.form, [paged.param]: String(page) })); await new Promise((r) => setTimeout(r, paged.delay_ms ?? 300)); }
    files.push(file);
  }
  return { files, expected: total };
}

async function apiItems(config, entity) {
  const url = (page) => config.public_api + "?" + new URLSearchParams({ mode: "department", region: entity.region, entity: entity.fiscal_entity_id, year: config.year, view: "main", page: String(page) });
  const get = async (page) => { for (let i = 0; ; i++) { try { const r = await fetch(url(page), { signal: AbortSignal.timeout(60000), redirect: "error" }); if (!r.ok) throw Error("HTTP_" + r.status); return await r.json(); } catch (error) { if (i === 3) throw error; } } };
  const first = await get(1);
  validateApiPage(first, entity, config.year);
  const pages = Math.ceil(first.total / first.size); let items = first.items;
  for (let page = 2; page <= pages; page++) { const data = await get(page); validateApiPage(data, entity, config.year); items = items.concat(data.items); }
  if (items.length !== first.total || new Set(items.map((i) => i.fiscal_project_id)).size !== items.length || new Set(items.map((i) => i.reference_date)).size !== 1) throw Error("API_INCOMPLETE_OR_MIXED_DATES");
  return items;
}

async function main() {
  const [configFile, outRoot, entityId] = process.argv.slice(2);
  const config = JSON.parse(readFileSync(configFile, "utf8")), entity = config.entities.find((e) => e.id === entityId);
  if (!entity || !/^[a-z0-9-]+$/u.test(entityId)) throw Error("UNKNOWN_ENTITY");
  const dir = path.join(path.resolve(outRoot), entityId); mkdirSync(dir, { recursive: true });
  if (["revtes_json", "project_spending_json", "dept_project_json"].includes(entity.format)) return revtesMain(config, entity, dir, entityId);
  const exported = await exportPages(entity, dir);
  const read = entity.format === "html_table" ? (bytes) => htmlTableRows(bytes, entity.table_id ?? null) : entity.format === "rows_json" ? (bytes) => JSON.parse(bytes.toString("utf8")) : xlsxRows;
  const raws = exported.files.map((f) => readFileSync(f)), listed = raws.flatMap((raw) => ledgerRows(read(raw), entity));
  if (exported.expected !== null && listed.length !== exported.expected) throw Error("LEDGER_ROWS_INCOMPLETE");
  if (entity.export.count_pattern) {
    const stated = Number(raws[0].toString("utf8").match(new RegExp(entity.export.count_pattern, "u"))?.[1]?.replaceAll(",", ""));
    if (!Number.isInteger(stated) || stated !== listed.length) throw Error("LEDGER_ROWS_INCOMPLETE");
  }
  if (entity.numbered_rows) {
    const numbers = raws.flatMap((raw) => read(raw).slice(entity.data_start ?? 1).filter((r) => r.length === entity.row_width).map((r) => Number(String(r[0]).replaceAll(",", ""))));
    if (new Set(numbers).size !== listed.length || Math.min(...numbers) !== 1 || Math.max(...numbers) !== listed.length) throw Error("LEDGER_ROWS_INCOMPLETE");
  }
  // 김포처럼 같은 세부사업이 사업구분(자체·보조)만 다른 똑같은 두 줄로 나오는 목록은, 사업구분을 뺀 모든 값이 같은 줄을 한 줄로 합친다.
  const rows = entity.collapse_duplicate_rows ? [...new Map(listed.map((r) => [JSON.stringify(r), r])).values()] : listed;
  const raw = Buffer.concat(raws.map((r) => Buffer.from(digest(r))));
  const apiFile = path.join(dir, "api-items.json");
  if (!existsSync(apiFile)) writeFileSync(apiFile, JSON.stringify(await apiItems(config, entity)));
  const apiRaw = JSON.parse(readFileSync(apiFile, "utf8"));
  // 통합 자치단체(전남광주)는 지방재정365 사업명 끝에 옛 단체 표시("(광주)")를 붙이므로, 설정한 꼬리표만 떼고 견준다.
  const items = entity.api_name_strip ? apiRaw.filter((i) => new RegExp(entity.api_name_strip, "u").test(i.name)).map((i) => ({ ...i, name: i.name.replace(new RegExp(entity.api_name_strip, "u"), "") })) : apiRaw;
  const result = matchLedger(items, rows, entity, entity.export.referer);
  const namesFile = fileURLToPath(new URL("../../components/budget/budget-department-names.json", import.meta.url));
  const baseline = JSON.parse(readFileSync(namesFile, "utf8"));
  const { merged, fresh, superseded } = mergeLedger(baseline, result.mappings);
  const report = { status: "SPOT_CHECK_REQUIRED", entity: entityId, export_sha256: digest(raw), export_rows: rows.length, retrieved_at: new Date().toISOString(), api_projects: items.length, reference_date: items[0].reference_date, mappings: result.mappings, held: result.held, new_entries: fresh.length, superseded };
  writeFileSync(path.join(dir, "matches.json"), JSON.stringify(report, null, 2));
  writeFileSync(path.join(dir, "approved-preview.json"), JSON.stringify(merged, null, 2) + "\n");
  console.log(JSON.stringify({ rows: rows.length, api: items.length, mapped: result.mappings.length, new_entries: fresh.length, superseded, held: result.held.reduce((m, h) => ({ ...m, [h.reason]: (m[h.reason] ?? 0) + 1 }), {}), export_sha256: report.export_sha256 }));
}

async function revtesMain(config, entity, dir, entityId) {
  const spending = entity.format === "project_spending_json", listed = entity.format === "dept_project_json";
  const exported = spending || listed ? { files: [path.join(dir, "rows.json")], expected: null } : await revtesPages(entity, dir);
  const raws = exported.files.map((f) => readFileSync(f));
  let rows;
  if (listed) {
    rows = JSON.parse(raws[0].toString("utf8")).rows;
  } else if (spending) {
    const body = JSON.parse(raws[0].toString("utf8"));
    rows = body.rows;
    if (new Set(rows.map((r) => r.number)).size !== body.total || rows.length !== body.total) throw Error("LEDGER_ROWS_INCOMPLETE");
  } else {
    rows = revtesRows(raws.map((raw) => JSON.parse(raw.toString("utf8"))));
    if (rows.length !== exported.expected) throw Error("LEDGER_ROWS_INCOMPLETE");
  }
  const apiFile = path.join(dir, "api-items.json");
  if (!existsSync(apiFile)) writeFileSync(apiFile, JSON.stringify(await apiItems(config, entity)));
  const items = JSON.parse(readFileSync(apiFile, "utf8"));
  const result = spending ? matchBySpendingProjects(items, rows, entity.export.referer, entity.subordinate_prefixes ?? []) : matchByProjectCode(items, rows, entity.export.referer, !listed);
  const namesFile = fileURLToPath(new URL("../../components/budget/budget-department-names.json", import.meta.url));
  const { merged, fresh, superseded } = mergeLedger(JSON.parse(readFileSync(namesFile, "utf8")), result.mappings);
  const sha = digest(Buffer.concat(raws.map((r) => Buffer.from(digest(r)))));
  const joined = result.mappings.concat(result.held).reduce((n, m) => n + m.evidence.length, 0);
  const report = { status: "SPOT_CHECK_REQUIRED", entity: entityId, export_sha256: sha, export_rows: rows.length, joined_projects: joined, retrieved_at: new Date().toISOString(), api_projects: items.length, reference_date: items[0].reference_date, mappings: result.mappings, held: result.held, new_entries: fresh.length, superseded };
  writeFileSync(path.join(dir, "matches.json"), JSON.stringify(report, null, 2));
  writeFileSync(path.join(dir, "approved-preview.json"), JSON.stringify(merged, null, 2) + "\n");
  console.log(JSON.stringify({ rows: rows.length, api: items.length, joined, mapped: result.mappings.length, new_entries: fresh.length, superseded, held: result.held.reduce((m, h) => ({ ...m, [h.reason]: (m[h.reason] ?? 0) + 1 }), {}), export_sha256: sha }));
}

// The ledger names today's responsible department; an older budget-book name for the same code is replaced in place
// (the replaced name is kept on the entry). Every other existing entry must stay byte-identical.
export function mergeLedger(baseline, mappings) {
  const k = (m) => [m.fiscal_entity_name, m.department_code].join("|");
  const byKey = new Map(mappings.map((m) => [k(m), m]));
  const superseded = [];
  const replaced = baseline.mappings.map((entry) => {
    const ledger = byKey.get(k(entry));
    if (!ledger || ledger.department_name === entry.department_name) return entry;
    superseded.push({ department_code: entry.department_code, from: entry.department_name, to: ledger.department_name });
    return { fiscal_year: ledger.fiscal_year, reference_date: ledger.reference_date, fiscal_entity_name: ledger.fiscal_entity_name, department_code: ledger.department_code, department_name: ledger.department_name, status: "verified_exact", basis: ledger.basis, evidence_count: ledger.evidence.length, source_urls: [...new Set(ledger.evidence.map((e) => e.document.source_url))], supersedes: { department_name: entry.department_name, source_urls: entry.source_urls } };
  });
  const existing = new Set(baseline.mappings.map(k));
  const fresh = mappings.filter((m) => !existing.has(k(m)));
  const merged = mergeReviewed({ ...baseline, mappings: replaced }, fresh, fresh.map((m) => [m.fiscal_entity_name, m.fiscal_year, m.reference_date, m.department_code].join("|")));
  return { merged, fresh, superseded };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

