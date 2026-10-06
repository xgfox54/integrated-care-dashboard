import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBudgetPack } from "./build-budget-pack.mjs";
import { extractBudgetLines } from "./extract-budget-lines.mjs";
import { validateBudgetPack } from "../../lib/imports/budget-pack.ts";
import { readZip } from "../../lib/imports/zip.ts";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const compact = text => text.replace(/\s+/g, "");
const SOURCES = [
  ["imsil", "imsil", "department-bulk-imsil-2026.json", "전북특별자치도"],
  ["bulk", "yongin", "department-bulk-2026.json", "경기도"],
  ["expanded", "gapyeong", "department-bulk-expanded-2026.json", "경기도"],
];

export function detailHolds(extracted) {
  const holds = [...extracted.problems];
  for (const line of extracted.lines) {
    const add = code => holds.push({ code, line_no: line.line_no, where: line.evidence });
    if (line.amount_thousand_krw === null) add("MISSING_AMOUNT");
    if (line.checks.funding_sum === "partial_or_mismatch") add("FUNDING_SUM_REVIEW");
    if (line.checks.name_fragment_rejoined === "unplaced_no_evidence") add("NAME_FRAGMENT_REVIEW");
    if (line.checks.formula === "not_computable") add("FORMULA_NOT_COMPUTABLE");
    if (line.checks.children_sum === "incomplete") add("CHILDREN_INCOMPLETE");
  }
  if (!extracted.lines.some(line => line.level === "item")) holds.push({ code: "NO_DETAIL_ITEMS" });
  return holds;
}

export function checkRanges(ranges, pageCount) {
  let next = 1;
  for (const range of ranges) {
    if (range.first !== next || range.last < range.first || range.pageCount !== pageCount) return false;
    next = range.last + 1;
  }
  return next === pageCount + 1;
}

export async function buildDetailCorpus(outDir) {
  if (existsSync(outDir)) throw new Error("OUTPUT_EXISTS: use a new output directory to preserve evidence");
  mkdirSync(outDir, { recursive: true });
  const inputs = new Map();
  const tracked = file => {
    const bytes = readFileSync(file);
    inputs.set(file, sha(bytes));
    return bytes;
  };
  const json = file => JSON.parse(tracked(file));
  const records = [];
  const bundles = [];
  for (const [folder, entityName, configFile, sido] of SOURCES) {
    const configPath = "factory/budget/configs/" + configFile;
    const entity = json(configPath).entities.find(item => item.id === entityName + "-2026");
    const root = `.omo/evidence/budget-department-${folder}-20261006/run/${entity.id}`;
    const documents = json(root + "/documents.json");
    if (documents.length !== entity.expected_documents || new Set(documents.map(document => document.id)).size !== documents.length) throw new Error("DOCUMENT_INVENTORY_INCOMPLETE_OR_DUPLICATED:" + entity.id);
    const state = json(root + "/state.json");
    const indexBytes = tracked(root + "/official-index.html");
    const html = indexBytes.toString("utf8").replaceAll("&amp;", "&");
    for (const document of documents) {
      const id = entity.id + "-" + document.id;
      const destination = path.join(outDir, id);
      mkdirSync(destination);
      const holds = [];
      const record = { id, entity: entity.id, label: document.label, status: "HELD", source_url: document.url,
        index_url: entity.index_url, official_config: configPath, problems: holds, evidence_dir: destination };
      records.push(record);
      try {
        const rawFile = root + "/raw/" + document.id + ".pdf";
        const raw = tracked(rawFile);
        const digest = sha(raw);
        record.raw_sha256 = digest;
        record.raw_file = rawFile;
        if (raw.subarray(0, 5).toString() !== "%PDF-" || digest !== document.sha256 || digest !== state.downloads[document.id]?.sha256) holds.push({ code: "RAW_HASH_MISMATCH" });
        const url = new URL(document.url);
        if (!html.includes(url.pathname + url.search) || sha(indexBytes) !== document.index_sha256 || !html.includes("2026")) holds.push({ code: "OFFICIAL_INDEX_MISMATCH" });
        if (state.downloads[document.id]?.url !== document.url) holds.push({ code: "DOWNLOAD_URL_MISMATCH" });
        if (entity.attachments && !entity.attachments.some(item => item.url === document.url && item.label === document.label)) holds.push({ code: "OFFICIAL_CONFIG_MISMATCH" });
        if (entity.attachment_url && entity.attachment_url !== document.url) holds.push({ code: "OFFICIAL_CONFIG_MISMATCH" });
        const blocks = [], tables = [], ranges = [], parsedInputs = [];
        for (const chunk of document.chunks) {
          if (chunk.includes("probe")) throw new Error("PROBE_IN_DOCUMENT_CHUNKS");
          const dir = root + "/parsed/" + chunk;
          const summary = json(dir + "/parse-summary.json");
          const normalized = json(dir + "/document.json");
          const chunkTables = tracked(dir + "/tables.jsonl").toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
          tracked(dir + "/raw-ir.json");
          ranges.push(summary);
          parsedInputs.push({ directory: dir, original_parse_id: normalized.parse_id, summary });
          if (summary.raw_sha256 !== digest || summary.bytes !== raw.length || summary.parser !== "kordoc") holds.push({ code: "PARSE_SOURCE_MISMATCH", chunk });
          for (const block of normalized.blocks) if (!Number.isInteger(block.page) || block.page < summary.first || block.page > summary.last) holds.push({ code: "SOURCE_PAGE_OUT_OF_RANGE", chunk, block_id: block.block_id });
          blocks.push(...normalized.blocks);
          tables.push(...chunkTables);
        }
        record.page_count = document.page_count;
        if (!checkRanges(ranges, document.page_count)) holds.push({ code: "PAGE_RANGE_GAP_OR_OVERLAP" });
        const blockIds = new Set(), tableIds = new Set();
        for (const block of blocks) { if (blockIds.has(block.block_id)) holds.push({ code: "DUPLICATE_BLOCK_ID", block_id: block.block_id }); blockIds.add(block.block_id); }
        for (const table of tables) { if (tableIds.has(table.table_id)) holds.push({ code: "DUPLICATE_TABLE_ID", table_id: table.table_id }); tableIds.add(table.table_id); }
        for (const block of blocks) if (block.type === "table" && !tableIds.has(block.table_id)) holds.push({ code: "TABLE_MISSING", table_id: block.table_id });
        for (const block of blocks) if (block.type !== "table" && (block.parsed_text_verbatim ?? "").trim() && !/^(부서\s*:|정책\s*:|단위\s*:|세출예산|2026년도|\(?단위\s*:|[-－]\s*\d+\s*[-－])/.test(block.parsed_text_verbatim)) holds.push({ code: "NON_TABLE_CONTENT_REVIEW", block_id: block.block_id, page: block.page, text: block.parsed_text_verbatim });
        for (const range of ranges) if (range.warnings.length || range.version !== ranges[0].version) holds.push({ code: "PARSER_WARNING_OR_VERSION_REVIEW", first: range.first, warnings: range.warnings });
        const sourceTitle = blocks.some(block => /2026.*본예산.*일반회계/.test(block.parsed_text_verbatim ?? ""));
        const linkedIndexTitle = entity.index_required_text.every(text => html.includes(text)) && html.includes("본예산") && html.includes("일반회계") && blocks.some(block => compact(block.parsed_text_verbatim ?? "") === "세출예산사업명세서");
        if (!sourceTitle && !linkedIndexTitle) holds.push({ code: "SOURCE_TITLE_NOT_CONFIRMED" });
        // The adapter identity describes this immutable composite; original kordoc IDs remain in provenance.
        const parseId = "p_" + sha(JSON.stringify({ adapter: "budget-detail-corpus-v1", digest, parsedInputs,
          documentHashes: document.chunks.map(chunk => inputs.get(root + "/parsed/" + chunk + "/document.json")),
          tableHashes: document.chunks.map(chunk => inputs.get(root + "/parsed/" + chunk + "/tables.jsonl")) })).slice(0, 32);
        const manifest = { detected_format: "pdf", raw_sha256: digest, source_version_id: "sv-" + digest,
          parse_id: parseId, parser: { name: "kordoc", package_version: ranges[0].version } };
        writeJson(path.join(destination, "document.json"), { parse_id: parseId, page_count: document.page_count, blocks });
        writeFileSync(path.join(destination, "tables.jsonl"), tables.map(table => JSON.stringify(table)).join("\n") + "\n");
        writeJson(path.join(destination, "manifest.json"), manifest);
        const extracted = extractBudgetLines(destination);
        holds.push(...detailHolds(extracted));
        const byTable = new Map(tables.map(table => [table.table_id, table]));
        const byBlock = new Map(blocks.map(block => [block.block_id, block]));
        for (const line of extracted.lines) {
          const evidence = line.evidence;
          if (!byTable.get(evidence.table_id)?.cells.some(cell => cell.anchor_row === evidence.row) || byBlock.get(evidence.block_id)?.page !== evidence.page) holds.push({ code: "LINE_PROVENANCE_MISMATCH", line_no: line.line_no });
        }
        const headerDepartments = [...new Set(blocks.flatMap(block => [...(block.parsed_text_verbatim ?? "").matchAll(/부서\s*:\s*([^\n]+)/g)].map(match => match[1].trim())))];
        const departments = extracted.lines.filter(line => line.level === "department").map(line => ({ name: line.name, line_no: line.line_no, page: line.evidence.page, amount: line.amount_thousand_krw }));
        for (const department of departments) if (!headerDepartments.some(name => compact(name) === compact(department.name))) holds.push({ code: "DEPARTMENT_HEADER_MISMATCH", department });
        for (const name of headerDepartments) if (!departments.some(department => compact(name) === compact(department.name))) holds.push({ code: "DEPARTMENT_NOT_EXTRACTED", name });
        record.departments = departments;
        record.summary = extracted.summary;
        record.formulas = extracted.lines.filter(line => line.formula_text).length;
        record.funding_rows = extracted.lines.filter(line => line.funding.length).length;
        record.lines_json = path.join(destination, "lines.json");
        writeJson(record.lines_json, extracted);
        writeJson(path.join(destination, "provenance.json"), { ...record, parse_id: parseId, adapter: "budget-detail-corpus-v1", parsedInputs,
          header_departments: headerDepartments, title_basis: sourceTitle ? "pdf_title" : "official_attachment_index_and_pdf_statement_heading", index_sha256: sha(indexBytes), retrieved_at: state.downloads[document.id]?.retrieved_at,
          note: "Original PDF page, table, block and row identifiers are unchanged. Composite parse_id is adapter-derived, not an original kordoc parse ID." });
        // Exclusion is explicit user-supplied published coverage, not inferred from matching labels.
        if (entityName === "yongin" && document.id === "3766-8") {
          record.status = "ALREADY_PUBLIC";
          record.exclusion_basis = "User confirmed existing 2026 social-welfare pack (1844 lines); preserve original document identity";
          continue;
        }
        if (holds.length) continue;
        const config = { artifact_id: "budget-detail-" + id, producer_run_id: "budget-detail-corpus-20261006", created_at: state.downloads[document.id].retrieved_at,
          documents: [{ document_id: "doc:budget-" + id, lines_json: record.lines_json, parse_dir: destination,
            title: "2026년도 본예산 일반회계 세출예산 사업명세서 - " + document.label, issuer: entity.publisher, issuer_sido: sido,
            issuer_sigungu: entity.publisher, fiscal_entity_id: entity.fiscal_entity_id, fiscal_year: "2026", page_url: entity.index_url, file_url: document.url,
            retrieved_at: state.downloads[document.id].retrieved_at, rights_basis: "지방자치단체 공식 누리집 공개 예산서. 구조화된 금액·계층·근거 위치만 제공하며 원문 파일은 포함하지 않음.",
            stage: entity.stage, supplementary_round: null, stage_basis: "공식 2026년 본예산 일반회계 공개 목록 및 원문 예산액·전년도예산액·비교증감 표 머리",
            account_code: entity.account_code, account_name: entity.account_name, scope_text: document.label + " (해당 공식 첨부파일 전체)", previous_column: "previous_year_budget" }] };
        record.config = path.join(destination, "config.json");
        writeJson(record.config, config);
        const built = await buildBudgetPack(config);
        const entries = await readZip(built.zip);
        const result = await validateBudgetPack(entries, built.manifest);
        const validationPath = path.join(destination, "server-validation.json");
        writeJson(validationPath, result.ok ? { ok: true, counts: built.counts, checks: result.pack.checks, sha256: built.sha256 } : result);
        if (!result.ok) { holds.push(...result.problems); continue; }
        const bundle = path.join(destination, config.artifact_id + ".zip");
        writeFileSync(bundle, built.zip);
        writeFileSync(bundle + ".sha256", built.sha256 + "  " + path.basename(bundle) + "\n");
        // Re-open the exact saved bytes; do not equate an in-memory pass with artifact verification.
        const saved = readFileSync(bundle);
        const savedEntries = await readZip(saved);
        const savedManifest = JSON.parse(new TextDecoder().decode(savedEntries.find(entry => entry.path === "manifest.json").bytes));
        const savedResult = await validateBudgetPack(savedEntries, savedManifest);
        if (sha(saved) !== built.sha256 || !savedResult.ok) throw new Error("SAVED_BUNDLE_INVALID");
        record.status = "VALIDATED";
        record.bundle = bundle;
        bundles.push({ id, config: record.config, bundle, sha256: built.sha256, counts: built.counts, validation: validationPath });
      } catch (error) { holds.push({ code: "PIPELINE_ERROR", message: error.message }); }
      finally { writeJson(path.join(destination, "result.json"), record); }
    }
  }
  const inputAudit = [...inputs].map(([file, before]) => ({ file, sha256: before, unchanged: sha(readFileSync(file)) === before }));
  writeJson(path.join(outDir, "input-integrity.json"), inputAudit);
  if (inputAudit.some(item => !item.unchanged)) throw new Error("INPUT_CHANGED_DURING_RUN");
  const report = { schema: "budget-detail-corpus-v1", invocation: "node --experimental-strip-types factory/budget/build-detail-corpus.mjs " + outDir,
    counts: { documents: records.length, validated: bundles.length, held: records.filter(record => record.status === "HELD").length,
      already_public: records.filter(record => record.status === "ALREADY_PUBLIC").length, lines: bundles.reduce((sum, bundle) => sum + bundle.counts.lines, 0) },
    bundles, documents: records, input_integrity: path.join(outDir, "input-integrity.json") };
  writeJson(path.join(outDir, "report.json"), report);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2];
  if (!outDir) throw new Error("Usage: node --experimental-strip-types factory/budget/build-detail-corpus.mjs <new-evidence-directory>");
  const report = await buildDetailCorpus(outDir);
  console.log(JSON.stringify({ report: path.join(outDir, "report.json"), counts: report.counts, bundles: report.bundles }, null, 2));
}
