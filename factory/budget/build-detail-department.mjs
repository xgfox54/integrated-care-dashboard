import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBudgetPack } from "./build-budget-pack.mjs";
import { detailHolds } from "./build-detail-corpus.mjs";
import { extractBudgetLines } from "./extract-budget-lines.mjs";
import { readZip } from "../../lib/imports/zip.ts";
import { validateBudgetPack } from "../../lib/imports/budget-pack.ts";

const json = file => JSON.parse(readFileSync(file, "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const write = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");

export function completeDepartment(extracted, name, sourceProblems = []) {
  const roots = extracted.lines.filter(line => line.level === "department" && line.name === name);
  assert.equal(roots.length, 1, "department name must identify exactly one source root");
  const root = roots[0];
  const index = extracted.lines.indexOf(root);
  const nextRoot = extracted.lines.findIndex((line, at) => at > index && line.level === "department");
  const lines = extracted.lines.slice(index, nextRoot < 0 ? undefined : nextRoot);
  const included = new Set([root.line_no]);
  assert.equal(root.parent_line_no, null);
  for (const line of lines.slice(1)) {
    assert.ok(included.has(line.parent_line_no), "every selected row must descend from the complete department");
    included.add(line.line_no);
  }
  assert.equal(root.checks.children_sum, "match", "the source department total must include all policy children");
  const first = Math.min(...lines.map(line => line.evidence.page));
  const last = Math.max(...lines.map(line => line.evidence.page));
  const problems = [...extracted.problems, ...sourceProblems].filter(problem => {
    const page = problem.where?.page ?? problem.page;
    if (problem.line_no !== undefined) return included.has(problem.line_no);
    return page === undefined || (page >= first && page <= last);
  });
  const result = { ...extracted, lines, problems, summary: { lines: lines.length,
    by_level: lines.reduce((counts, line) => (counts[line.level] = (counts[line.level] ?? 0) + 1, counts), {}),
    scope: "complete_department_within_attachment", source_department_line_no: root.line_no, first_page: first, last_page: last } };
  const holds = detailHolds(result);
  assert.deepEqual(holds, [], "the entire selected department must pass without deleting any descendants or checks");
  return result;
}

export function assertDepartmentSourceEquality(candidate, original, name, sourceProblems = []) {
  assert.deepEqual(candidate, completeDepartment(original, name, sourceProblems), "DEPARTMENT_SOURCE_SUBTREE_CHANGED");
}

export async function buildDetailDepartment(reportFile, outDir, sourceId, departmentName) {
  assert.equal(existsSync(outDir), false, "use a new output directory");
  const report = json(reportFile);
  const source = report.documents.find(document => document.id === sourceId);
  assert.ok(source && source.status === "HELD", "only explicitly scoped held attachments are supported");
  const audit = json(report.input_integrity);
  for (const input of audit) assert.equal(sha(readFileSync(input.file)), input.sha256, "original input hash changed: " + input.file);
  const provenance = json(path.join(source.evidence_dir, "provenance.json"));
  const originalBlocks = provenance.parsedInputs.flatMap(input => json(path.join(input.directory, "document.json")).blocks);
  const originalTables = provenance.parsedInputs.flatMap(input => readFileSync(path.join(input.directory, "tables.jsonl"), "utf8").trim().split("\n").map(JSON.parse));
  assert.deepEqual(json(path.join(source.evidence_dir, "document.json")).blocks, originalBlocks);
  assert.deepEqual(readFileSync(path.join(source.evidence_dir, "tables.jsonl"), "utf8").trim().split("\n").map(JSON.parse), originalTables);
  assert.equal(sha(readFileSync(source.raw_file)), source.raw_sha256);
  const full = extractBudgetLines(source.evidence_dir);
  assert.deepEqual(full, json(source.lines_json), "source report must be rebuilt with the current extractor first");
  const selected = completeDepartment(full, departmentName, source.problems);
  const entity = json(source.official_config).entities.find(item => item.id === source.entity);
  assert.ok(provenance.header_departments.includes(departmentName));
  const sourceManifest = json(path.join(source.evidence_dir, "manifest.json"));
  const suffix = sourceId + "-dept-" + sha(departmentName).slice(0, 12);
  const scopeText = `${departmentName} 전체 부서 계층. 원문 첨부파일 ${source.label} 중 PDF ${selected.summary.first_page}–${selected.summary.last_page}쪽만 포함. 다른 부서는 제외.`;
  mkdirSync(outDir, { recursive: true });
  const linesPath = path.join(outDir, "lines.json");
  write(linesPath, selected);
  write(path.join(outDir, "manifest.json"), sourceManifest);
  const config = { artifact_id: "budget-detail-" + suffix, producer_run_id: "budget-detail-welfare-20261006", created_at: provenance.retrieved_at,
    documents: [{ document_id: "doc:budget-" + suffix, lines_json: linesPath, parse_dir: outDir,
      title: "2026년도 본예산 일반회계 세출예산 사업명세서 - " + departmentName + " (부서 전체·첨부파일 일부)", issuer: entity.publisher,
      issuer_sido: source.entity.startsWith("imsil") ? "전북특별자치도" : "경기도", issuer_sigungu: entity.publisher, fiscal_entity_id: entity.fiscal_entity_id,
      fiscal_year: "2026", page_url: source.index_url, file_url: source.source_url, retrieved_at: provenance.retrieved_at,
      rights_basis: "공식 누리집 공개 예산서의 구조화된 금액·계층·근거 위치. 원문 파일 미포함.", stage: entity.stage, supplementary_round: null,
      stage_basis: "공식 2026년 본예산 일반회계 첨부파일 목록 및 세출예산사업명세서 표 머리", account_code: entity.account_code, account_name: entity.account_name,
      scope_text: scopeText, previous_column: "previous_year_budget" }] };
  const configPath = path.join(outDir, "config.json");
  write(configPath, config);
  // Server arithmetic alone cannot detect deletion of the only child; require the exact source subtree as well.
  assertDepartmentSourceEquality(json(linesPath), full, departmentName, source.problems);
  const built = await buildBudgetPack(config);
  const entries = await readZip(built.zip);
  const validation = await validateBudgetPack(entries, built.manifest);
  assert.equal(validation.ok, true, JSON.stringify(validation.problems));
  const bundle = path.join(outDir, config.artifact_id + ".zip");
  writeFileSync(bundle, built.zip);
  writeFileSync(bundle + ".sha256", built.sha256 + "  " + path.basename(bundle) + "\n");
  const saved = readFileSync(bundle);
  const savedEntries = await readZip(saved);
  const savedManifest = JSON.parse(new TextDecoder().decode(savedEntries.find(entry => entry.path === "manifest.json").bytes));
  const savedValidation = await validateBudgetPack(savedEntries, savedManifest);
  assert.equal(savedValidation.ok, true, JSON.stringify(savedValidation.problems));
  assert.equal(sha(saved), built.sha256);
  write(path.join(outDir, "server-validation.json"), { ok: true, counts: built.counts, checks: savedValidation.pack.checks });
  write(path.join(outDir, "provenance.json"), { ...provenance, selection: selected.summary, scope_text: scopeText, source_report: reportFile,
    source_attachment_status: source.status, source_attachment_problems: source.problems, preserved_original_line_numbers: true });
  const receipt = { status: "VALIDATED_PARTIAL_ATTACHMENT_COMPLETE_DEPARTMENT", source_id: sourceId, department: departmentName,
    scope_text: scopeText, source_report: reportFile, config: configPath, bundle, sha256: built.sha256, counts: built.counts,
    formulas: selected.lines.filter(line => line.formula_text).length, funding_rows: selected.lines.filter(line => line.funding.length).length,
    summary: selected.summary, validation: path.join(outDir, "server-validation.json"), problems: [],
    held_source_problems_preserved: source.problems.length };
  receipt.bundles = [{ id: suffix, config: configPath, bundle, sha256: built.sha256, counts: built.counts, validation: receipt.validation }];
  write(path.join(outDir, "report.json"), receipt);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [reportFile, outDir, sourceId, departmentName] = process.argv.slice(2);
  if (!departmentName) throw new Error("Usage: build-detail-department.mjs <corpus-report> <new-output-dir> <source-id> <exact-department-name>");
  console.log(JSON.stringify(await buildDetailDepartment(reportFile, outDir, sourceId, departmentName), null, 2));
}
