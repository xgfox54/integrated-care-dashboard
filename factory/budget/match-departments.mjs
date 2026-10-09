import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const normalizeName = (value) => String(value ?? "").normalize("NFC").replace(/\s+/gu, "");
export function explicitPageDepartment(blocks) {
  // Some books print 「부서 : X과정책: …」 with no gap; 정책/단위 must be followed by a colon, so 「정책기획과」 is not cut.
  const names = new Set(blocks.flatMap((block) => [...String(block.parsed_text_verbatim ?? "").matchAll(/부서\s*[:：]\s*([^\n]+?)(?=\s*정책\s*[:：]|\s*단위\s*[:：]|$)/gu)].map((match) => normalizeName(match[1]))));
  return names.size === 1 ? [...names][0] : null;
}
const keyOf = (row) => [row.fiscal_year, row.fiscal_entity_name, row.account_code, normalizeName(row.name), row.amount_krw].join("|");
const group = (rows, key) => {
  const out = new Map();
  for (const row of rows) { const k = key(row); if (!out.has(k)) out.set(k, []); out.get(k).push(row); }
  return out;
};

export function matchDepartments(api, documentRows) {
  const apiIndex = group(api, keyOf), docIndex = group(documentRows, keyOf);
  const evidence = [], rejected = [];
  for (const [key, rows] of apiIndex) {
    const candidates = docIndex.get(key) ?? [];
    if (rows.length !== 1 || candidates.length !== 1 || !/^[1-9]\d*$/.test(rows[0].amount_krw ?? "")) {
      rejected.push({ project_ids: rows.map((r) => r.project_id), reason: candidates.length === 0 ? "no_exact_document_row" : "ambiguous_or_zero", document_candidates: candidates.length });
      continue;
    }
    evidence.push({ ...rows[0], document: candidates[0] });
  }
  const mappings = [], held = [];
  for (const rows of group(evidence, (r) => [r.fiscal_year, r.reference_date, r.fiscal_entity_name, r.department_code].join("|")).values()) {
    const names = new Set(rows.map((r) => r.document.department_name));
    const distinctProjects = new Set(rows.map((r) => normalizeName(r.name)));
    if (names.size !== 1 || distinctProjects.size < 2) {
      held.push({ department_code: rows[0].department_code, reason: names.size !== 1 ? "conflicting_departments" : "insufficient_independent_projects", evidence: rows });
      continue;
    }
    const { fiscal_year, reference_date, fiscal_entity_name, department_code } = rows[0];
    mappings.push({ fiscal_year, reference_date, fiscal_entity_name, department_code, department_name: rows[0].document.department_name, status: "verified_exact", evidence: rows });
  }
  return { mappings, held, rejected };
}

// 목차 시작 페이지를 검증한 뒤 각 페이지 자체의 명시적 부서 머리글만 사용한다.
export function collectJejuRows(root) {
  const read = (name) => JSON.parse(readFileSync(path.join(root, name), "utf8").replace(/^\uFEFF/, ""));
  const downloads = read("downloads.json");
  const toc = read("parsed/v1-toc/raw-ir.json").blocks.map((b) => b.text ?? "").join("\n");
  const entries = [...toc.matchAll(/([\p{L}\p{N}·]+)\s+(\d+)/gu)].map((m) => ({
    name: m[1], printed_page: Number(m[2]), volume: m[1].startsWith("제주시") ? 2 : m[1].startsWith("서귀포시") ? 3 : 1,
  }));
  const rows = [], anchors = [], skipped = [];
  for (const source of downloads) {
    const folders = readdirSync(path.join(root, "parsed-v2")).filter((f) => new RegExp(`^v${source.volume}-\\d+-\\d+$`).test(f));
    const blocks = [], tables = new Map();
    for (const folder of folders) {
      blocks.push(...read(`parsed-v2/${folder}/document.json`).blocks);
      for (const line of readFileSync(path.join(root, "parsed-v2", folder, "tables.jsonl"), "utf8").trim().split("\n").filter(Boolean)) { const t = JSON.parse(line); tables.set(t.table_id, t); }
    }
    blocks.sort((a, b) => a.page - b.page || a.index - b.index);
    const specialPages = new Set(blocks.filter((b) => /특별회계/u.test(normalizeName(b.parsed_text_verbatim))).map((b) => b.page));
    for (const block of blocks.filter((b) => b.table_id)) {
      if (tables.get(block.table_id)?.cells.some((c) => /특별회계/u.test(normalizeName(c.parsed_text_verbatim)))) specialPages.add(block.page);
    }
    const byPage = group(blocks, (b) => b.page);
    const confirmedToc = new Map();
    for (const entry of entries.filter((e) => e.volume === source.volume)) {
      const first = entry.printed_page + 8, pageBlocks = byPage.get(first) ?? [];
      if (explicitPageDepartment(pageBlocks) !== entry.name) continue;
      const start = pageBlocks.filter((b) => b.table_id).map((b) => tables.get(b.table_id)).find((t) => t?.cells.some((c) => c.anchor_row === 1 && normalizeName(c.parsed_text_verbatim) === entry.name));
      if (!start) continue;
      confirmedToc.set(entry.name, { first, table_id: start.table_id });
    }
    for (const [page, pageBlocks] of byPage) {
      const department = explicitPageDepartment(pageBlocks);
      const tocAnchor = department ? confirmedToc.get(department) : null;
      if (!department || !tocAnchor) {
        if (pageBlocks.some((b) => b.table_id && tables.get(b.table_id)?.cells.some((c) => /부서.*정책.*세부사업/u.test(normalizeName(c.parsed_text_verbatim))))) skipped.push({ volume: source.volume, page, department_name: department, reason: !department ? "page_department_missing_or_ambiguous" : "department_not_confirmed_in_toc" });
        continue;
      }
      // 이 페이지 자체의 부서 머리글만 인정한다. 앞뒤 페이지의 부서를 넘겨받지 않는다.
      anchors.push({ volume: source.volume, department_name: department, first: page, last: page, toc_page: tocAnchor.first, table_id: tocAnchor.table_id, basis: "explicit_same_page_department_and_toc" });
      for (const block of pageBlocks.filter((b) => b.type === "table")) {
        // 혼합 페이지도 통째로 보류해 특별회계 금액을 일반회계로 대조하지 않는다.
        if (specialPages.has(block.page)) continue;
        const table = tables.get(block.table_id);
        if (!table?.cells.some((c) => /부서.*정책.*세부사업/u.test(normalizeName(c.parsed_text_verbatim)))) continue;
        const cols = table.logical_columns;
        for (const cells of group(table.cells.filter((c) => c.anchor_row > 0), (c) => c.anchor_row).values()) {
          const name = cells.filter((c) => c.anchor_col < cols - 3).sort((a, b) => a.anchor_col - b.anchor_col).map((c) => c.parsed_text_verbatim ?? "").join(" ").trim();
          const amount = (cells.find((c) => c.anchor_col === cols - 3)?.parsed_text_verbatim ?? "").split("\n")[0].trim();
          if (!name || !/^\d{1,3}(?:,\d{3})*$|^\d+$/u.test(amount)) continue;
          rows.push({ fiscal_year: "2026", fiscal_entity_name: "제주본청", account_code: "100", name, amount_krw: (BigInt(amount.replaceAll(",", "")) * 1000n).toString(), department_name: department, department_basis: "explicit_same_page_department_and_toc", toc_page: tocAnchor.first, volume: source.volume, page: block.page, table_id: table.table_id, row: cells[0].anchor_row, source_url: source.url, raw_sha256: source.sha256, stage: "adopted_initial" });
        }
      }
    }
  }
  return { rows, anchors, skipped };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, output] = process.argv.slice(2);
  const read = (f) => JSON.parse(readFileSync(path.join(root, f), "utf8").replace(/^\uFEFF/, ""));
  const unique = new Map();
  for (const item of read("api-all.json").items) unique.set(item.fiscal_project_id, item);
  const api = [...unique.values()].map((r) => ({ project_id: r.fiscal_project_id, fiscal_year: r.fiscal_year, reference_date: r.reference_date, fiscal_entity_name: r.fiscal_entity.name, department_code: r.department_code, account_code: r.account.code, name: r.name, amount_krw: r.current_budget_krw }));
  const collected = collectJejuRows(root);
  const result = matchDepartments(api, collected.rows);
  const report = { rule: "Explicit same-page department header and confirmed original TOC start required; no cross-page carryforward; missing or ambiguous headers held. Same year/entity/account; whitespace-only normalized exact project name; exact positive KRW amount; unique on both sides across all 3 volumes; two independent project names; reject code conflicts. No source values overwritten.", document_stage: "2026 adopted_initial", api_measure: "current_budget_krw", api_projects: api.length, document_rows: collected.rows.length, anchors: collected.anchors, skipped_anchors: collected.skipped, ...result };
  writeFileSync(output, JSON.stringify(report, null, 2));
  if (process.argv[4]) {
    const targetCodes = new Set(["social_welfare", "health", "integrated_care"].flatMap((mode) => read(`api-${mode}.json`).items.map((item) => item.department_code)));
    writeFileSync(process.argv[4], JSON.stringify({ schema: "budget-department-names-v1", rule: report.rule, mappings: result.mappings.filter((m) => targetCodes.has(m.department_code)).map(({ evidence, ...mapping }) => ({ ...mapping, evidence_count: evidence.length, source_urls: [...new Set(evidence.map((e) => e.document.source_url))] })) }, null, 2) + "\n");
  }
  console.log(JSON.stringify({ api_projects: api.length, document_rows: collected.rows.length, anchors: collected.anchors.length, mappings: result.mappings.map((m) => ({ code: m.department_code, name: m.department_name, matches: m.evidence.length })), held: result.held.map((h) => ({code:h.department_code, reason:h.reason})), rejected: result.rejected.length }));
}
