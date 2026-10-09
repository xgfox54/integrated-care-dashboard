import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeName } from "./match-departments.mjs";
import { mergeReviewed, officialAttachments, organisationDepartments, documentRows, matchCorpus, pageUnitVerified } from "./department-corpus.mjs";

export function reviewedMappings(mappings, manifest, receipt) {
  assert.equal(receipt.manifest_sha256, manifest.sha256, "visual receipt must pin the exact manifest");
  const approvedSheets = new Set(receipt.sheets.filter((s) => s.result === "PASS").map((s) => s.path + "|" + s.sha256));
  const held = [], approved = [];
  for (const mapping of mappings) {
    const sheets = manifest.sheets.filter((s) => s.codes.includes(mapping.department_code));
    const requiredPages = [...new Set(mapping.evidence.map((e) => e.document.document_id + ":" + e.document.page))];
    const coveredPages = new Set(sheets.filter((s) => s.kind === "headers" && approvedSheets.has(s.path + "|" + s.sha256)).flatMap((s) => s.pages));
    const representative = sheets.some((s) => s.kind === "representatives" && approvedSheets.has(s.path + "|" + s.sha256));
    const rejection = receipt.held?.find((h) => h.code === mapping.department_code);
    if (rejection || !representative || requiredPages.some((p) => !coveredPages.has(p))) held.push({ code: mapping.department_code, reason: rejection?.reason ?? "VISUAL_COVERAGE_INCOMPLETE" });
    else approved.push(mapping);
  }
  return { approved, held };
}

async function main() {

const root = path.resolve(process.argv[2]), entity = process.argv[3];
if (!/^[a-z0-9-]+$/u.test(entity ?? "")) throw Error("ENTITY_REQUIRED");
const read = (file) => JSON.parse(readFileSync(path.join(root, entity, file), "utf8"));
const state = read("state.json"), report = read("matches.json"), documents = read("documents.json");
const all = process.argv.includes("--all");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.equal(state.status, "REVIEW_REQUIRED");
for (const artifact of [state.index, state.download_resolver, state.department_toc, ...Object.values(state.downloads), ...Object.values(state.parses).flat(), ...Object.values(state.api_pages)].filter(Boolean)) assert.equal(hash(readFileSync(path.join(root, artifact.path))), artifact.sha256);
const api = new Map(Object.values(state.api_pages).flatMap((a) => JSON.parse(readFileSync(path.join(root, a.path), "utf8")).items).map((r) => [r.fiscal_project_id, r]));
const tables = new Map(), headers = new Map(), pageBlocks = new Map(), corpus = [];
const indexText = readFileSync(path.join(root, state.index.path), "utf8");
const currentIndex = officialAttachments(indexText, report.entity);
if (report.entity.department_toc) {
  assert.equal(state.department_toc.url, report.entity.department_toc.url);
  const directory = path.join(root, entity, "parsed", "department-toc");
  const summary = organisationDepartments({ blocks: JSON.parse(readFileSync(path.join(directory, "document.json"), "utf8")).blocks, tables: readFileSync(path.join(directory, "tables.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) }, "2026", report.entity.department_toc.account_name, report.entity.department_toc);
  for (const item of currentIndex) item.toc_names = summary.names;
  for (const document of documents) assert.deepEqual(document.department_toc, { source_url: state.department_toc.url, raw_sha256: state.department_toc.sha256, ...(report.entity.department_toc.page_range ? { page_range: report.entity.department_toc.page_range } : {}), locations: summary.locations });
}
assert.equal(documents.length, currentIndex.length);
for (const document of documents) {
  const index = currentIndex.find((d) => d.id === document.id);
  assert.ok(index); assert.equal(index.url, document.url); assert.deepEqual(index.toc_names, document.toc_names);
  assert.equal(document.account_code, index.account_code); assert.equal(document.account_basis, index.account_basis);
}
const byDocument = new Map(documents.map((d) => [d.id, { blocks: [], tables: [] }]));
for (const doc of documents) for (const chunk of doc.chunks) {
  const dir = path.join(root, entity, "parsed", chunk);
  for (const table of readFileSync(path.join(dir, "tables.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)) { tables.set(table.table_id, table); byDocument.get(doc.id).tables.push(table); }
  for (const block of JSON.parse(readFileSync(path.join(dir, "document.json"), "utf8")).blocks) {
    byDocument.get(doc.id).blocks.push(block);
    const key = doc.id + ":" + block.page;
    if (!pageBlocks.has(key)) pageBlocks.set(key, []);
    pageBlocks.get(key).push(block);
    if (!headers.has(key)) headers.set(key, new Set());
    const found = String(block.parsed_text_verbatim ?? "").match(/부서\s*[:：]\s*([^\n]+?)(?=\s*정책\s*[:：]|\s*단위\s*[:：]|$)/u);
    if (found) headers.get(key).add(normalizeName(found[1]));
  }
}
for (const document of documents) corpus.push(...documentRows(document, byDocument.get(document.id), report.entity, "2026").rows);
const reproduced = matchCorpus([...api.values()], corpus, report.entity);
assert.deepEqual(reproduced.mappings, report.mappings, "recheck uniqueness against the complete corpus, including unverified rows");
let checks = 0;
for (const mapping of report.mappings) {
  assert.ok(new Set(mapping.evidence.map((e) => normalizeName(e.name))).size >= 2);
  for (const evidence of mapping.evidence) {
    const d = evidence.document, source = documents.find((s) => s.id === d.document_id), row = api.get(evidence.project_id);
    assert.ok(source.toc_names.includes(mapping.department_name));
    assert.deepEqual([...headers.get(source.id + ":" + d.page)], [mapping.department_name]);
    assert.equal(source.account_code, row.account.code);
    assert.equal(source.sha256, d.raw_sha256);
    assert.equal(source.index_sha256, d.toc_index_sha256);
    assert.equal(d.department_basis, "explicit_same_page_header_and_official_index");
    const text = normalizeName(pageBlocks.get(source.id + ":" + d.page).map((b) => b.parsed_text_verbatim ?? "").join(" "));
    assert.ok(report.entity.amount_unit === "천원" && pageUnitVerified(report.entity, source, d.page, text, mapping.department_name));
    assert.ok(!text.includes("특별회계"));
    assert.ok(BigInt(d.amount_krw) > 0n);
    assert.equal(row.fiscal_entity.name, mapping.fiscal_entity_name);
    assert.equal(row.fiscal_entity.fiscal_entity_id, report.entity.fiscal_entity_id);
    assert.equal(row.fiscal_year, mapping.fiscal_year);
    assert.equal(row.reference_date, mapping.reference_date);
    assert.equal(row.department_code, mapping.department_code);
    const table = tables.get(d.table_id), cells = table.cells.filter((c) => c.anchor_row === d.row);
    const label = cells.filter((c) => c.anchor_col < table.logical_columns - 3).sort((a, b) => a.anchor_col - b.anchor_col).map((c) => c.parsed_text_verbatim ?? "").join(" ");
    const amount = cells.find((c) => c.anchor_col === table.logical_columns - 3).parsed_text_verbatim.split("\n")[0].trim();
    assert.equal(normalizeName(label), normalizeName(row.name));
    assert.equal((BigInt(amount.replaceAll(",", "")) * 1000n).toString(), row.current_budget_krw);
    checks++;
  }
}
const selected = all ? report.mappings : report.mappings.filter((m) => ["복지정책과", "노인복지과", "장애인복지과", "아동보육과"].includes(m.department_name));
if (!all) assert.equal(new Set(selected.map((m) => m.department_name)).size, 4, "The initial four-department review scope must be complete; multiple source codes may share one name");
const output = path.join(root, entity, all ? "review-remainder" : "review"); mkdirSync(output, { recursive: true });
const baselineFile = all ? path.join(output, "baseline-mappings.json") : path.join(root, "baseline-mappings.json");
if (all && !existsSync(baselineFile)) writeFileSync(baselineFile, readFileSync(new URL("../../components/budget/budget-department-names.json", import.meta.url)));
const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
const keys = selected.map((m) => [m.fiscal_entity_name, m.fiscal_year, m.reference_date, m.department_code].join("|"));
const preview = mergeReviewed(baseline, selected, keys);
if (all) {
  const manifestFile = path.join(output, "visual-manifest.json"), receiptArg = process.argv.indexOf("--finalize");
  if (receiptArg >= 0) {
    const manifestBytes = readFileSync(manifestFile), manifest = JSON.parse(manifestBytes);
    assert.equal(manifest.matches_sha256, hash(readFileSync(path.join(root, entity, "matches.json"))));
    for (const sheet of manifest.sheets) assert.equal(hash(readFileSync(path.join(output, sheet.path))), sheet.sha256);
    const decision = reviewedMappings(report.mappings, { ...manifest, sha256: hash(manifestBytes) }, JSON.parse(readFileSync(process.argv[receiptArg + 1], "utf8")));
    const accepted = mergeReviewed(baseline, decision.approved, decision.approved.map((m) => [m.fiscal_entity_name, m.fiscal_year, m.reference_date, m.department_code].join("|")));
    writeFileSync(path.join(output, "approved-preview.json"), JSON.stringify(accepted, null, 2) + "\n");
    writeFileSync(path.join(output, "decision.json"), JSON.stringify({ status: "VISUALLY_REVIEWED", approved_codes: decision.approved.map((m) => m.department_code), held: decision.held, already_held: report.held.map((h) => ({ code: h.department_code, reason: h.reason, document_reasons: [...new Set(h.evidence.map((e) => e.document.hold_reason).filter(Boolean))] })), original_entries_preserved: baseline.mappings.length, resulting_entries: accepted.mappings.length, evidence_rechecked: checks, manifest_sha256: hash(manifestBytes) }, null, 2));
    console.log(JSON.stringify({ approved: decision.approved.length, held: decision.held.length, original_entries: baseline.mappings.length, resulting_entries: accepted.mappings.length, evidence_rechecked: checks }));
    return;
  }
  const require = createRequire(new URL("../hwp-parser/package.json", import.meta.url));
  const { PDFiumLibrary } = require("@hyzyla/pdfium"), sharp = require("sharp");
  const library = await PDFiumLibrary.init(), pages = new Map(), representativePages = new Map(), sheets = [];
  for (const mapping of selected) {
    const first = mapping.evidence[0].document, representative = first.document_id + ":" + first.page;
    if (!representativePages.has(representative)) representativePages.set(representative, []);
    representativePages.get(representative).push(mapping.department_code);
    for (const evidence of mapping.evidence) {
      const d = evidence.document, key = d.document_id + ":" + d.page;
      if (!pages.has(key)) pages.set(key, { document: d.document_id, page: d.page, key, codes: new Set(), expected_header: mapping.department_name });
      pages.get(key).codes.add(mapping.department_code);
    }
  }
  const targets = [...pages.values()].sort((a, b) => a.document.localeCompare(b.document, "en", { numeric: true }) || a.page - b.page);
  const headerImages = [], representatives = [];
  try {
    for (const document of documents) {
      const selectedPages = targets.filter((p) => p.document === document.id);
      if (!selectedPages.length) continue;
      const pdf = await library.loadDocument(readFileSync(path.join(root, state.downloads[document.id].path)));
      for (const target of selectedPages) {
        const rendered = await pdf.getPage(target.page - 1).render({ scale: 1.5, render: async ({ data, width, height }) => sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer() });
        const png = Buffer.from(rendered.data), file = `${target.document}-p${target.page}.png`;
        writeFileSync(path.join(output, file), png);
        target.file = file; target.sha256 = hash(png); target.codes = [...target.codes];
        const image = await sharp(png).resize({ width: 900 }).png().toBuffer();
        const label = Buffer.from(`<svg width="900" height="24"><rect width="900" height="24" fill="white"/><text x="8" y="18" font-size="15">${target.key}</text></svg>`);
        const crop = await sharp(image).extract({ left: 0, top: 105, width: 900, height: 140 }).extend({ top: 24, bottom: 0, left: 0, right: 0, background: "white" }).composite([{ input: label, left: 0, top: 0 }]).png().toBuffer();
        headerImages.push({ target, input: crop });
        if (representativePages.has(target.key)) representatives.push({ target, input: await sharp(image).extend({ top: 24, bottom: 0, left: 0, right: 0, background: "white" }).composite([{ input: label, left: 0, top: 0 }]).png().toBuffer() });
      }
      pdf.destroy();
    }
    for (const [kind, images, perSheet] of [["headers", headerImages, 16], ["representatives", representatives, 4]]) {
      for (let start = 0; start < images.length; start += perSheet) {
        const batch = images.slice(start, start + perSheet), cellHeight = Math.max(...await Promise.all(batch.map(async (i) => (await sharp(i.input).metadata()).height)));
        const file = `${kind}-${String(start / perSheet + 1).padStart(2, "0")}.png`;
        const png = await sharp({ create: { width: 1800, height: Math.ceil(batch.length / 2) * cellHeight, channels: 4, background: "white" } }).composite(batch.map((i, n) => ({ input: i.input, left: (n % 2) * 900, top: Math.floor(n / 2) * cellHeight }))).png().toBuffer();
        writeFileSync(path.join(output, file), png);
        sheets.push({ path: file, kind, sha256: hash(png), pages: batch.map((i) => i.target.key), codes: [...new Set(batch.flatMap((i) => kind === "headers" ? i.target.codes : representativePages.get(i.target.key)))] });
      }
    }
  } finally { library.destroy(); }
  writeFileSync(manifestFile, JSON.stringify({ matches_sha256: hash(readFileSync(path.join(root, entity, "matches.json"))), status: "VISUAL_REVIEW_REQUIRED", source_files: documents.length, all_codes: selected.length, all_evidence: checks, evidence_pages: targets.length, representative_pages: representatives.length, targets, sheets }, null, 2));
  console.log(JSON.stringify({ status: "VISUAL_REVIEW_REQUIRED", codes: selected.length, evidence: checks, pages: targets.length, sheets: sheets.length, output }));
  return;
}
writeFileSync(path.join(output, "mapping-preview.json"), JSON.stringify(preview, null, 2));
writeFileSync(path.join(output, "selected-evidence.json"), JSON.stringify({ status: "VISUAL_REVIEW_REQUIRED", mappings: selected }, null, 2));
const require = createRequire(new URL("../hwp-parser/package.json", import.meta.url));
const { PDFiumLibrary } = require("@hyzyla/pdfium"), sharp = require("sharp");
const library = await PDFiumLibrary.init(), images = [], targets = [];
try {
  for (const mapping of selected) {
    const d = mapping.evidence[0].document;
    const pdf = await library.loadDocument(readFileSync(path.join(root, state.downloads[d.document_id].path)));
    const rendered = await pdf.getPage(d.page - 1).render({ scale: 1.5, render: async ({ data, width, height }) => sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer() });
    const file = mapping.department_code + "-p" + d.page + ".png";
    writeFileSync(path.join(output, file), Buffer.from(rendered.data));
    images.push(await sharp(rendered.data).resize({ width: 850 }).png().toBuffer());
    targets.push({ code: mapping.department_code, name: mapping.department_name, document: d.document_id, page: d.page, file });
    pdf.destroy();
  }
  let height = 0; const overlays = [];
  for (const input of images) { overlays.push({ input, left: 0, top: height }); height += (await sharp(input).metadata()).height; }
  await sharp({ create: { width: 850, height, channels: 4, background: "white" } }).composite(overlays).png().toFile(path.join(output, "source-pages.png"));
} finally { library.destroy(); }
const result = { pass: true, source_files: documents.length, all_candidate_codes_checked: report.mappings.length, all_candidate_evidence_checked: checks, selected_codes: selected.length, selected_evidence: selected.reduce((n, m) => n + m.evidence.length, 0), existing_entries_preserved: baseline.mappings.length, targets, publication: "NONE; preview only, manual visual review required" };
writeFileSync(path.join(output, "verification.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
