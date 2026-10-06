// 예산서 반입 묶음(welfare-budget-document-v1) 만들기. 로컬 전용(작업지시서 v5 §22.7·22.9).
// ID·내용 지문 규칙은 서버 검사기(lib/imports/budget-pack.ts)의 함수를 그대로 써서 두 쪽 결과가 항상 같다.
// 사용: node factory/budget/build-budget-pack.mjs <config.json> <출력 폴더>
//   config: { artifact_id, producer_run_id, documents: [{ document_id, lines_json, parse_dir, title, issuer, issuer_sido, issuer_sigungu,
//             fiscal_entity_id, fiscal_year, page_url, file_url, retrieved_at, rights_basis, stage, supplementary_round, stage_basis,
//             account_code, account_name, scope_text, previous_column }] }
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { BUDGET_IMPORT_FORMAT, BUDGET_SCHEMA_VERSION, budgetContentDigestOf, lineIdOf, revisionIdOf } from "../../lib/imports/budget-pack.ts";
import { zipStored } from "../../lib/platform/zip-writer.ts";

const encoder = new TextEncoder();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonl = (rows) => encoder.encode(rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
const FORMAT = { pdf: "PDF", hwp: "HWP5", hwp5: "HWP5", hwpx: "HWPX", hwp3: "HWP3", hwpml: "HWPML", docx: "DOCX", xls: "XLS", xlsx: "XLSX" };
/** 추출기의 머리 행 이름(예: 「예산액|전년도예산액|비교증감」) → 열 목록. */
const columnsOf = (headers) => (headers?.[0] ?? "예산액").split("|").filter(Boolean);

export async function buildBudgetPack(config, readJson = (file) => JSON.parse(readFileSync(file, "utf8"))) {
  const documents = [];
  const revisions = [];
  const lines = [];
  const validation = {};
  for (const input of config.documents) {
    const extracted = readJson(input.lines_json);
    const parse = readJson(path.join(input.parse_dir, "manifest.json"));
    if (extracted.problems?.length) throw new Error(input.document_id + ": 추출 문제 " + extracted.problems.length + "건이 남아 있어 묶지 않습니다.");
    const format = FORMAT[String(parse.detected_format).toLowerCase()];
    if (!format) throw new Error(input.document_id + ": 형식 " + parse.detected_format + "은 예산서 묶음에 넣지 않습니다.");
    documents.push({
      document_id: input.document_id, source_version_id: parse.source_version_id, title: input.title, issuer: input.issuer, issuer_sido: input.issuer_sido,
      issuer_sigungu: input.issuer_sigungu ?? "", fiscal_entity_id: input.fiscal_entity_id ?? null, fiscal_year: String(input.fiscal_year), page_url: input.page_url ?? null,
      file_url: input.file_url ?? null, retrieved_at: input.retrieved_at, raw_sha256: parse.raw_sha256, format, parse_id: parse.parse_id,
      parser: parse.parser.name + " " + parse.parser.package_version, extractor_version: extracted.extractor_version, rights_basis: input.rights_basis,
    });
    const round = input.stage === "adopted_supplementary" ? input.supplementary_round : null;
    const revisionId = await revisionIdOf(input.document_id, input.stage, round, parse.raw_sha256);
    revisions.push({
      revision_id: revisionId, document_id: input.document_id, stage: input.stage, supplementary_round: round, stage_basis: input.stage_basis, unit: "thousand_krw",
      account_code: input.account_code, account_name: input.account_name, scope_text: input.scope_text, amount_columns: columnsOf(extracted.amount_columns), previous_column: input.previous_column,
    });
    for (const line of extracted.lines) {
      lines.push({
        line_id: await lineIdOf(revisionId, line.line_no), revision_id: revisionId, line_no: line.line_no, parent_line_no: line.parent_line_no, level: line.level,
        code: line.code ?? null, name: line.name, formula_text: line.formula_text ?? null, amount_thousand_krw: line.amount_thousand_krw,
        previous_amount_thousand_krw: line.previous_amount_thousand_krw ?? null, change_amount_thousand_krw: line.change_amount_thousand_krw ?? null,
        amount_basis: line.amount_basis ?? null, funding: line.funding.map((item) => ({ source: item.source, label: item.label, amount_thousand_krw: item.amount_thousand_krw })),
        page: line.evidence?.page ?? null, table_id: line.evidence?.table_id ?? null, block_id: line.evidence?.block_id ?? null, row_index: line.evidence?.row ?? null,
        checks: line.checks ?? {}, annotations: line.annotations ?? [],
      });
    }
    validation[revisionId] = { extractor: extracted.extractor_version, summary: extracted.summary };
  }
  const files = [
    { path: "data/budget/documents.jsonl", bytes: jsonl(documents), records: documents.length },
    { path: "data/budget/revisions.jsonl", bytes: jsonl(revisions), records: revisions.length },
    { path: "data/budget/lines.jsonl", bytes: jsonl(lines), records: lines.length },
  ];
  const manifest = {
    format: BUDGET_IMPORT_FORMAT, artifact_id: config.artifact_id, created_at: config.created_at ?? new Date().toISOString(), producer_run_id: config.producer_run_id,
    modules_present: ["budget_documents"], module_schema_versions: { budget_documents: BUDGET_SCHEMA_VERSION }, document_ids: documents.map((item) => item.document_id),
    files: files.map((file) => ({ path: file.path, size: file.bytes.length, sha256: sha256(file.bytes), records: file.records })),
    content_digest: await budgetContentDigestOf(documents, revisions, lines), validation,
  };
  const zip = zipStored([{ path: "manifest.json", bytes: encoder.encode(JSON.stringify(manifest, null, 2)) }, ...files.map(({ path: file, bytes }) => ({ path: file, bytes }))]);
  return { zip, sha256: sha256(zip), manifest, counts: { documents: documents.length, revisions: revisions.length, lines: lines.length } };
}

if (process.argv[1] && process.argv[1].endsWith("build-budget-pack.mjs")) {
  const [configPath, outDir] = process.argv.slice(2);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const result = await buildBudgetPack(config);
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, config.artifact_id + ".zip");
  writeFileSync(file, result.zip);
  writeFileSync(file + ".sha256", result.sha256 + "  " + path.basename(file) + "\n");
  console.log(JSON.stringify({ file, sha256: result.sha256, bytes: result.zip.length, counts: result.counts }, null, 1));
}
