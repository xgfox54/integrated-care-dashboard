import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { officialAttachments, organisationDepartments, documentRows } from "./department-corpus.mjs";
import { completeDepartment } from "./build-detail-department.mjs";
import { extractBudgetLines } from "./extract-budget-lines.mjs";
import { buildBudgetPack } from "./build-budget-pack.mjs";
import { readZip } from "../../lib/imports/zip.ts";
import { validateBudgetPack } from "../../lib/imports/budget-pack.ts";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const compact = text => String(text ?? "").replace(/\s/gu, "");
const write = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");

export function completeDepartmentPages(parsed, audit, name) {
  const pages = audit.filter(row => row.department === name);
  assert.ok(pages.length && pages.every(row => row.verified), "all source department pages must be verified, including continuation pages");
  const selected = new Set(pages.map(row => row.page));
  const first = Math.min(...selected), last = Math.max(...selected);
  assert.equal(selected.size, last - first + 1, "department pages must be contiguous; never skip damaged pages");
  const blocks = parsed.blocks.filter(block => selected.has(block.page));
  assert.ok([...selected].every(page => blocks.some(block => block.page === page)), "every audited department page must have original blocks");
  const ids = new Set(blocks.filter(block => block.table_id).map(block => block.table_id));
  const tables = parsed.tables.filter(table => ids.has(table.table_id));
  assert.equal(tables.length, ids.size, "every source table must be preserved");
  return { blocks, tables, page_range: { first, last } };
}

export async function buildBulkDetail(root, configFile, entityId, output, names) {
  assert.equal(existsSync(output), false, "use a new output directory");
  const inputs = new Map();
  const tracked = file => { const bytes = readFileSync(file); inputs.set(file, sha(bytes)); return bytes; };
  const read = file => JSON.parse(tracked(file));
  const config = read(configFile), entity = config.entities.find(item => item.id === entityId);
  assert.ok(entity && entity.stage === "adopted_initial" && entity.account_name === "일반회계");
  assert.equal(entity.adapter, "suwon-adopted-mixed-account-pdf", "this detail adapter requires a verified mixed-account chapter profile");
  assert.equal(entity.region, "4100000", "issuer region must be independently configured");
  const directory = path.join(root, entityId), state = read(path.join(directory, "state.json"));
  assert.equal(state.status, "REVIEW_REQUIRED");
  assert.equal(state.config_sha256, inputs.get(configFile));
  for (const artifact of [state.index, state.department_toc, state.download_resolver, ...Object.values(state.downloads), ...Object.values(state.parses).flat()].filter(Boolean)) assert.equal(sha(tracked(path.join(root, artifact.path))), artifact.sha256);
  const documents = read(path.join(directory, "documents.json"));
  const index = officialAttachments(tracked(path.join(root, state.index.path)).toString("utf8"), entity);
  assert.equal(documents.length, index.length);
  const tocDirectory = path.join(directory, "parsed", "department-toc");
  const toc = { blocks: read(path.join(tocDirectory, "document.json")).blocks, tables: tracked(path.join(tocDirectory, "tables.jsonl")).toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse) };
  const organisation = organisationDepartments(toc, config.year, entity.department_toc.account_name);
  mkdirSync(output, { recursive: true });
  const records = [], bundles = [];
  for (const document of documents) {
    const indexed = index.find(item => item.id === document.id);
    assert.equal(document.url, indexed?.url);
    assert.equal(document.index_sha256, state.index.sha256);
    assert.deepEqual(document.toc_names, organisation.names);
    assert.equal(document.sha256, state.downloads[document.id]?.sha256);
    const blocks = [], tables = [], summaries = [];
    let next = 1;
    for (const chunk of document.chunks) {
      const dir = path.join(directory, "parsed", chunk), summary = read(path.join(dir, "parse-summary.json"));
      assert.equal(summary.first, next); assert.equal(summary.pageCount, document.page_count);
      assert.equal(summary.raw_sha256, document.sha256); assert.equal(summary.parser, "kordoc");
      next = summary.last + 1; summaries.push(summary);
      tracked(path.join(dir, "raw-ir.json"));
      const chunkBlocks = read(path.join(dir, "document.json")).blocks;
      assert.ok(chunkBlocks.every(block => Number.isInteger(block.page) && block.page >= summary.first && block.page <= summary.last));
      blocks.push(...chunkBlocks);
      tables.push(...tracked(path.join(dir, "tables.jsonl")).toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse));
    }
    assert.equal(next, document.page_count + 1);
    const parsed = { blocks, tables }, audit = documentRows(document, parsed, entity, config.year).audit;
    for (const name of names) {
      const record = { department: name, status: "HELD", document: document.id, problems: [] };
      records.push(record);
      try {
        const scope = completeDepartmentPages(parsed, audit, name);
        const warnings = summaries.flatMap(summary => summary.warnings.filter(warning => warning.page === undefined || (warning.page >= scope.page_range.first && warning.page <= scope.page_range.last)));
        assert.deepEqual(warnings, [], "parser warnings in the complete department need review");
        assert.ok(summaries.every(summary => summary.version === summaries[0].version));
        const id = entityId + "-dept-" + sha(name).slice(0, 12), destination = path.join(output, id);
        mkdirSync(destination);
        const parseId = "p_" + sha(JSON.stringify({ adapter: "bulk-detail-department-v1", raw: document.sha256, ranges: document.chunks, scope: scope.page_range, name })).slice(0, 32);
        const manifest = { detected_format: "pdf", raw_sha256: document.sha256, source_version_id: "sv-" + document.sha256, parse_id: parseId, parser: { name: "kordoc", package_version: summaries[0].version } };
        write(path.join(destination, "manifest.json"), manifest);
        write(path.join(destination, "document.json"), { parse_id: parseId, page_count: document.page_count, blocks: scope.blocks });
        writeFileSync(path.join(destination, "tables.jsonl"), scope.tables.map(table => JSON.stringify(table)).join("\n") + "\n");
        const extracted = extractBudgetLines(destination);
        write(path.join(destination, "extraction.json"), extracted);
        write(path.join(destination, "provenance.json"), { adapter: "bulk-detail-department-v1", config_file: configFile, source_raw_sha256: document.sha256, source_index_sha256: state.index.sha256, source_chunks: document.chunks, scope: scope.page_range, original_block_table_row_ids_preserved: true, organisation_location: organisation.locations[name] });
        const complete = completeDepartment(extracted, name);
        assert.deepEqual(complete.lines, extracted.lines, "every row on the department's original pages must be included");
        const location = organisation.locations[name];
        assert.ok(location, "department must exist in the independent organisation statement");
        const table = toc.tables.find(table => table.table_id === location.table_id);
        const amountColumn = table?.cells.find(cell => compact(cell.parsed_text_verbatim) === "예산액")?.anchor_col;
        const amount = table?.cells.find(cell => cell.anchor_row === location.row && cell.anchor_col === amountColumn)?.parsed_text_verbatim?.split("\n")[0].trim();
        assert.equal(compact(amount), compact(complete.lines[0].amount_thousand_krw), "department total must match the independent organisation statement");
        const linesFile = path.join(destination, "lines.json"); write(linesFile, complete);
        const scopeText = `${name} 전체 부서 계층. 원문 PDF ${scope.page_range.first}–${scope.page_range.last}쪽. 일반회계의 해당 부서만 포함하며 다른 부서·특별회계는 제외.`;
        const packConfig = { artifact_id: "budget-detail-" + id, producer_run_id: "budget-bulk-detail-20261006", created_at: state.downloads[document.id].retrieved_at,
          documents: [{ document_id: "doc:budget-" + id, lines_json: linesFile, parse_dir: destination, title: "2026년도 본예산 일반회계 세출예산 사업명세서 - " + name + " (부서 전체·첨부파일 일부)", issuer: entity.publisher,
            issuer_sido: "경기도", issuer_sigungu: entity.publisher, fiscal_entity_id: entity.fiscal_entity_id, fiscal_year: config.year,
            page_url: entity.index_url, file_url: document.url, retrieved_at: state.downloads[document.id].retrieved_at,
            rights_basis: "공식 누리집 공개 예산서의 구조화된 금액·계층·근거 위치. 원문 파일 미포함.", stage: entity.stage, supplementary_round: null,
            stage_basis: "공식 예산서 의결 표지·일반회계 장 경계·조직별 총괄표·동일 쪽 부서 표 머리 검증", account_code: entity.account_code, account_name: entity.account_name, scope_text: scopeText, previous_column: "previous_year_budget" }] };
        const configPath = path.join(destination, "config.json"); write(configPath, packConfig);
        const built = await buildBudgetPack(packConfig), bundle = path.join(destination, packConfig.artifact_id + ".zip");
        writeFileSync(bundle, built.zip); writeFileSync(bundle + ".sha256", built.sha256 + "  " + path.basename(bundle) + "\n");
        const saved = readFileSync(bundle), entries = await readZip(saved), savedManifest = JSON.parse(new TextDecoder().decode(entries.find(entry => entry.path === "manifest.json").bytes));
        const validation = await validateBudgetPack(entries, savedManifest);
        assert.equal(validation.ok, true, JSON.stringify(validation.problems)); assert.equal(sha(saved), built.sha256);
        const validationPath = path.join(destination, "server-validation.json"); write(validationPath, { ok: true, counts: built.counts, checks: validation.pack.checks });
        write(path.join(destination, "provenance.json"), { adapter: "bulk-detail-department-v1", config_file: configFile, source_raw_sha256: document.sha256, source_index_sha256: state.index.sha256, source_chunks: document.chunks, scope: scope.page_range, original_block_table_row_ids_preserved: true, organisation_location: location, scope_text: scopeText });
        record.status = "VALIDATED"; record.counts = built.counts; record.page_range = scope.page_range;
        bundles.push({ id, config: configPath, bundle, sha256: built.sha256, counts: built.counts, validation: validationPath });
      } catch (error) { record.problems.push({ code: "COMPLETE_DEPARTMENT_REVIEW_REQUIRED", message: error.message.slice(0, 500) }); }
    }
  }
  const integrity = [...inputs].map(([file, hash]) => ({ file, sha256: hash, unchanged: sha(readFileSync(file)) === hash }));
  assert.ok(integrity.every(input => input.unchanged)); write(path.join(output, "input-integrity.json"), integrity);
  const report = { schema: "bulk-detail-department-v1", documents: records, bundles, counts: { validated: bundles.length, held: records.filter(record => record.status === "HELD").length, lines: bundles.reduce((n, bundle) => n + bundle.counts.lines, 0) }, operational_import: "NOT_RUN; normal administrator login required" };
  write(path.join(output, "report.json"), report); return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, config, entity, output, ...names] = process.argv.slice(2);
  assert.ok(names.length, "Usage: root config entity new-output exact-department-names");
  const report = await buildBulkDetail(root, config, entity, output, names);
  console.log(JSON.stringify({ counts: report.counts, departments: report.documents.map(record => ({ name: record.department, status: record.status, problems: record.problems })) }));
}
