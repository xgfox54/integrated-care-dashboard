import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildBudgetPack } from "../factory/budget/build-budget-pack.mjs";
import { advanceRun, readScope, setScopeApproval, startRun } from "./fiscal/collect.ts";
import { activateImport, approveImport, beginImport, CHUNK_MAX_BYTES, finalizeImport, putChunk } from "./imports/store.ts";
import { database } from "./press-test-support.mjs";

const NOW = 1_791_200_000;
const sha = (value) => createHash("sha256").update(value).digest("hex");
export const PROJECT_NAME = "부랑인 보호 및 지원";
export const PROJECT_CODES = ["4050000200730487", "4050000200730953"];
export const DEPARTMENTS = ["3005040", "4005040"];

export async function matchingDatabase({ projectCount = 2, departmentCodes = DEPARTMENTS } = {}) {
  const db = database();
  const rows = departmentCodes.slice(0, projectCount).map((dept, index) => ({
    fyr: "2026", wa_laf_cd: "4100000", wa_laf_hg_nm: "경기", laf_cd: "4129000", laf_hg_nm: "경기용인시", acnt_dv_cd: "100", acnt_dv_nm: "일반회계",
    dept_cd: dept, dbiz_cd: PROJECT_CODES[index], dbiz_nm: PROJECT_NAME, exe_ymd: "20261003", bdg_cash_amt: (index + 1) * 1_000_000, ep_amt: (index + 1) * 100_000,
    bdg_ntep: 0, capep: (index + 1) * 1_000_000, sggep: 0, etc_amt: 0, cpl_amt: (index + 1) * 1_000_000,
    fld_cd: "080", fld_nm: "사회복지", ane_part_cd: "081", part_nm: "기초생활보장", padm_laf_cd: "4050000",
  }));
  const body = JSON.stringify({ QWGJK: [{ head: [{ list_total_count: rows.length }, { RESULT: { CODE: "INFO-000" } }] }, { row: rows }] });
  const deps = { fetcher: async () => ({ status: 200, headers: { get: () => "application/json" }, text: async () => body }), now: () => NOW, newId: () => "match-run", apiKey: null };
  const scope = await readScope(db, "qwgjk:integrated-care-name");
  await advanceRun(db, await startRun(db, scope, "2026-10-03", "manual", deps), deps);
  await setScopeApproval(db, "qwgjk:integrated-care-name", true, NOW);
  return db;
}

export async function publishMatchingBook(db, options = {}) {
  const { id = "matching-book", annotations = [`부서코드 ${DEPARTMENTS[0]} · 세부사업코드 ${PROJECT_CODES[0]}`], department = "처인구 사회복지과" } = options;
  const documentId = "doc:budget-" + id;
  const line = (line_no, parent_line_no, level, name) => ({
    line_no, parent_line_no, level, code: null, name, formula_text: null, amount_thousand_krw: "1,000", amount_basis: "source_cell", funding: [],
    evidence: { page: 1, block_id: "b:" + sha(name).slice(0, 16), table_id: "t:" + sha(id).slice(0, 16), row: line_no }, checks: {}, annotations: level === "detail_project" ? annotations : [],
  });
  const extracted = { extractor_version: "budget-lines-1.1.0", amount_columns: ["예산액|전년도예산액|비교증감"], problems: [], summary: {}, lines: [
    line(1, null, "department", department), line(2, 1, "policy", "사회복지 증진"), line(3, 2, "unit", "사회복지 지원"),
    line(4, 3, "detail_project", PROJECT_NAME), line(5, 4, "object_group", "민간이전"), line(6, 5, "object", "민간경상사업보조"), line(7, 6, "item", "사업 운영"),
  ] };
  const config = { artifact_id: id, producer_run_id: "test", created_at: "2026-10-05T00:00:00Z", documents: [{
    document_id: documentId, lines_json: "lines", parse_dir: "parse", title: "부서별 시험 예산서", issuer: "용인시", issuer_sido: "경기도", issuer_sigungu: "용인시",
    fiscal_entity_id: "lofin:laf:4129000", fiscal_year: "2026", page_url: "https://www.yongin.go.kr/", file_url: null, retrieved_at: "2026-10-05T00:00:00Z",
    rights_basis: "시험", stage: "adopted_initial", supplementary_round: null, stage_basis: "시험", account_code: "100", account_name: "일반회계", scope_text: department, previous_column: "none",
  }] };
  const files = { lines: extracted, "parse/manifest.json": { source_version_id: "sv-" + sha(id).slice(0, 12), raw_sha256: sha(id), parse_id: "p_" + sha(id).slice(0, 32), detected_format: "pdf", parser: { name: "kordoc", package_version: "4.18.13" } } };
  const pack = await buildBudgetPack(config, (path) => files[path.split("\\").join("/")]);
  const totalChunks = Math.ceil(pack.zip.length / CHUNK_MAX_BYTES);
  const { row } = await beginImport(db, { artifactId: id, archiveSha256: pack.sha256, sizeBytes: pack.zip.length, totalChunks }, NOW);
  for (let index = 0; index < totalChunks; index += 1) await putChunk(db, row.import_id, index, pack.zip.subarray(index * CHUNK_MAX_BYTES, (index + 1) * CHUNK_MAX_BYTES), NOW);
  const staged = await finalizeImport(db, row.import_id, async (ids) => new Set(ids), NOW);
  assert.equal(staged.status, "staged", staged.report_json);
  await approveImport(db, row.import_id, pack.sha256, NOW + 1);
  await activateImport(db, row.import_id, async (ids) => new Set(ids), NOW + 2);
  return (await db.prepare("SELECT revision_id FROM budget_active_revision WHERE document_id = ?").bind(documentId).first()).revision_id;
}
