// 예산서(편성 단계 문서) 반입·공개·조회·단계 비교(작업지시서 v5 §22.7·22.8, T90·T91·T104).
// 실제 마이그레이션을 적용한 SQLite에 지방재정365 표본(제주본청 통합돌봄 1·2)을 공개한 뒤, 같은 재정주체의 본예산·1회 추경 예산서를 반입한다.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { buildBudgetPack } from "../factory/budget/build-budget-pack.mjs";
import { buildDocumentPack } from "../factory/release/pack-builder.mjs";
import { activeRevisions, lineSubtree, revisionOutline } from "./fiscal/budget-documents.ts";
import { advanceRun, readScope, setScopeApproval, startRun } from "./fiscal/collect.ts";
import { compareBudgetPeriods, findBudgetProjects, getFiscalCatalog } from "./mcp/fiscal.ts";
import { activateImport, approveImport, beginImport, blockSource, CHUNK_MAX_BYTES, finalizeImport, putChunk, readImport, restoreImport } from "./imports/store.ts";
import { database } from "./press-test-support.mjs";

const NOW = 1_791_200_000;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const anySubject = async (ids) => new Set(ids);
const make = (payload, options) => ({ data: payload, ...options });

async function seedFiscal(db) {
  const row = (index, dept, budget) => ({
    fyr: "2026", wa_laf_cd: "4900000", wa_laf_hg_nm: "제주", laf_cd: "4900000", laf_hg_nm: "제주본청", acnt_dv_cd: "100", acnt_dv_nm: "일반회계",
    dept_cd: dept, dbiz_cd: "65000002007300" + index, dbiz_nm: "통합돌봄 " + index, exe_ymd: "20261003", bdg_cash_amt: budget, ep_amt: 1000000,
    bdg_ntep: 0, capep: budget, sggep: 0, etc_amt: 0, cpl_amt: budget, fld_cd: "080", fld_nm: "사회복지", ane_part_cd: "082", part_nm: "노인", padm_laf_cd: "6500000",
  });
  const body = JSON.stringify({ QWGJK: [{ head: [{ list_total_count: 2 }, { RESULT: { CODE: "INFO-000" } }] }, { row: [row(1, "4005301", 3539300000), row(2, "3005407", 120000000)] }] });
  const deps = { fetcher: async () => ({ status: 200, headers: { get: () => "application/json" }, text: async () => body }), now: () => NOW, newId: () => "run-b", apiKey: null };
  const scope = await readScope(db, "qwgjk:integrated-care-name");
  await advanceRun(db, await startRun(db, scope, "2026-10-03", "manual", deps), deps);
  await setScopeApproval(db, "qwgjk:integrated-care-name", true, NOW);
  return (await db.prepare("SELECT fiscal_project_id, name FROM fiscal_project ORDER BY name").all()).results;
}

/** 추출기 결과 모양의 작은 예산서: 부서 → 정책 → 단위 → 세부사업(통합돌봄 1·2) → 편성목 → 통계목 → 부기. */
function extraction({ detail1, detail2, previous1 = null, change1 = null, header = "예산액|전년도예산액|비교증감", mutate = (lines) => lines }) {
  const fmt = (value) => value.toLocaleString("en-US");
  const line = (line_no, parent_line_no, level, name, amount, extra = {}) => ({
    line_no, parent_line_no, level, code: null, name, formula_text: null, amount_thousand_krw: amount === null ? null : fmt(amount), amount_basis: "source_cell", funding: [],
    evidence: { page: 1, block_id: "b:" + sha(name).slice(0, 16), table_id: "t:" + sha("t").slice(0, 16), row: line_no }, checks: {}, ...extra,
  });
  const total = detail1 + detail2;
  const lines = [
    line(1, null, "department", "노인복지과", total, { funding: [{ source: "national", label: "국", amount_thousand_krw: fmt(total - 500) }, { source: "municipal", label: "시", amount_thousand_krw: "500" }], checks: { children_sum: "match", funding_sum: "match" } }),
    line(2, 1, "policy", "노인복지 증진", total, { checks: { children_sum: "match" } }),
    line(3, 2, "unit", "지역사회 통합돌봄", total, { checks: { children_sum: "match" } }),
    line(4, 3, "detail_project", "통합돌봄 1", detail1, { previous_amount_thousand_krw: previous1 === null ? null : fmt(previous1), change_amount_thousand_krw: change1 === null ? null : (change1 < 0 ? "△" : "") + fmt(Math.abs(change1)), checks: { children_sum: "match", ...(previous1 === null ? {} : { side_columns: "match" }) } }),
    line(5, 4, "object_group", "민간이전", detail1, { code: "307", checks: { children_sum: "match" } }),
    line(6, 5, "object", "민간경상사업보조", detail1, { code: "02", checks: { children_sum: "match" } }),
    line(7, 6, "item", "통합돌봄 1", detail1 - 300, { formula_text: fmt((detail1 - 300) * 1000) + "원", checks: { formula: "match" } }),
    line(8, 6, "item", "방문 의료 연계", 300, { formula_text: "300,000원", checks: { formula: "match" } }),
    line(9, 3, "detail_project", "통합돌봄 2", detail2, { checks: { children_sum: "match" } }),
    line(10, 9, "object_group", "운영비", detail2, { code: "201", checks: { children_sum: "match" } }),
    line(11, 10, "object", "사무관리비", detail2, { code: "01", checks: {} }),
  ];
  return { extractor_version: "budget-lines-1.1.0", amount_columns: [header], lines: mutate(lines), problems: [], summary: {} };
}

function packConfig(artifactId, documentId, stage, round, previousColumn, raw) {
  return {
    artifact_id: artifactId, producer_run_id: "test", created_at: "2026-10-05T00:00:00Z",
    documents: [{
      document_id: documentId, lines_json: "lines:" + documentId, parse_dir: "parse:" + documentId, title: "시험 예산서 " + documentId, issuer: "제주특별자치도",
      issuer_sido: "제주특별자치도", issuer_sigungu: "", fiscal_entity_id: "lofin:laf:4900000", fiscal_year: "2026", page_url: "https://www.jeju.go.kr/budget", file_url: null,
      retrieved_at: raw.retrieved_at, rights_basis: "시험", stage, supplementary_round: round, stage_basis: "시험 문서 제목", account_code: "100", account_name: "일반회계",
      scope_text: "노인복지과", previous_column: previousColumn,
    }],
  };
}

async function built(config, extracted, raw) {
  const id = config.documents[0].document_id;
  const files = {
    ["lines:" + id]: extracted,
    ["parse:" + id + "/manifest.json"]: { source_version_id: "sv-" + sha(raw.name).slice(0, 12), raw_sha256: sha(raw.name), parse_id: "p_" + sha(raw.name).slice(0, 32), detected_format: "pdf", parser: { name: "kordoc", package_version: "4.18.13" } },
  };
  return buildBudgetPack(config, (file) => files[file.split("\\").join("/")]);
}

async function upload(db, pack) {
  const total = Math.ceil(pack.zip.length / CHUNK_MAX_BYTES);
  const { row } = await beginImport(db, { artifactId: pack.manifest.artifact_id, archiveSha256: pack.sha256, sizeBytes: pack.zip.length, totalChunks: total }, NOW);
  for (let index = 0; index < total; index += 1) await putChunk(db, row.import_id, index, pack.zip.subarray(index * CHUNK_MAX_BYTES, (index + 1) * CHUNK_MAX_BYTES), NOW);
  return row.import_id;
}

async function publish(db, pack, at = NOW) {
  const id = await upload(db, pack);
  const staged = await finalizeImport(db, id, anySubject, at);
  assert.equal(staged.status, "staged", staged.report_json);
  await approveImport(db, id, pack.sha256, at + 1);
  return { id, row: await activateImport(db, id, anySubject, at + 2), report: JSON.parse(staged.report_json) };
}

const ADOPTED = { name: "adopted-2026", retrieved_at: "2026-10-05T01:00:00Z" };
const SUPP = { name: "supp1-2026", retrieved_at: "2026-10-05T02:00:00Z" };

test("예산서 묶음은 서버 검산을 거쳐 승인·활성화된 단계만 공개되고, 세부사업 아래 편성목·부기·재원까지 조회된다", async () => {
  const db = database();
  await seedFiscal(db);
  const adopted = await built(packConfig("budgetdoc-test-adopted-a", "doc:budget-test-jeju-2026-adopted", "adopted_initial", null, "previous_year_budget", ADOPTED), extraction({ detail1: 3539300, detail2: 120000 }), ADOPTED);
  const id = await upload(db, adopted);
  const staged = await finalizeImport(db, id, anySubject, NOW);
  assert.equal(staged.status, "staged", staged.report_json);
  const report = JSON.parse(staged.report_json);
  const checks = Object.values(report.server_checks)[0];
  assert.deepEqual(checks.children_sum, { match: 8, mismatch: 0, incomplete: 0, partial_listing: 0 });
  assert.equal(checks.bugi_lines, 2);
  assert.equal(checks.bugi_same_name_as_parent, 1, "원문 Ο 부기 이름이 세부사업명과 같은 경우는 세기만 한다");
  assert.equal((await activeRevisions(db)).length, 0, "승인 전에는 공개되지 않는다");
  await approveImport(db, id, adopted.sha256, NOW + 1);
  assert.equal((await activateImport(db, id, anySubject, NOW + 2)).status, "active");

  const [revision] = await activeRevisions(db);
  assert.equal(revision.stage, "adopted_initial");
  const outline = await revisionOutline(db, revision.revision_id);
  assert.deepEqual(outline.lines.map((line) => line.level), ["department", "policy", "unit", "detail_project", "detail_project"]);
  const detail = outline.lines.find((line) => line.name === "통합돌봄 1");
  assert.equal(detail.amount_krw, "3539300000");
  assert.equal(detail.api_comparison.relation, "same_within_display_rounding", "문서 본예산(천원)과 API 예산현액(원)을 단위를 맞춰 대조한다");
  assert.equal(outline.lines.find((line) => line.name === "통합돌봄 2").api_comparison.relation, "same_within_display_rounding");
  assert.equal(outline.lines[0].funding.length, 2);
  assert.equal(outline.lines[0].funding_breakdown_complete, true);
  const subtree = await lineSubtree(db, revision.revision_id, detail.line_no);
  assert.deepEqual(subtree.lines.map((line) => line.level), ["detail_project", "object_group", "object", "item", "item"]);
  assert.equal(subtree.lines[3].bugi_name, "통합돌봄 1");
  assert.equal(subtree.lines[2].bugi_name, null, "부기명은 부기(Ο) 행에만 둔다");
});

test("본예산·1회 추경 단계 비교는 문서끼리만 하고, 추경 기정예산액과 본예산 금액이 같은지 알려 준다", async () => {
  const db = database();
  const projects = await seedFiscal(db);
  await publish(db, await built(packConfig("budgetdoc-test-adopted-b", "doc:budget-test-jeju-2026-adopted", "adopted_initial", null, "previous_year_budget", ADOPTED), extraction({ detail1: 3539300, detail2: 120000 }), ADOPTED));
  await publish(db, await built(packConfig("budgetdoc-test-supp1-b", "doc:budget-test-jeju-2026-supp1", "adopted_supplementary", 1, "pre_revision_budget", SUPP), extraction({ detail1: 3600000, detail2: 120000, previous1: 3539300, change1: 60700, header: "예산액|기정예산액|비교증감" }), SUPP), NOW + 10);
  const revisions = await activeRevisions(db);
  const left = revisions.find((row) => row.stage === "adopted_initial");
  const right = revisions.find((row) => row.stage === "adopted_supplementary");
  assert.equal(right.supplementary_round, 1);
  const ids = projects.map((project) => project.fiscal_project_id);

  const result = await compareBudgetPeriods(db, { project_selection: { fiscal_project_ids: ids }, left: { fiscal_year: 2026, document_revision_id: left.revision_id }, right: { fiscal_year: 2026, document_revision_id: right.revision_id }, comparison_basis: "document_stage" }, make);
  assert.equal(result.data.comparable, true);
  assert.match(result.data.stage_relation, /본예산\(의결\) → 제1회 추가경정예산\(의결\)/);
  const first = result.data.items.find((item) => item.name === "통합돌봄 1");
  assert.equal(first.change_thousand_krw, 60700);
  assert.equal(first.right.pre_revision_amount_thousand_krw, "3,539,300");
  assert.equal(first.left_equals_right_pre_revision, true, "추경 문서의 기정예산액 = 본예산 금액");
  assert.equal(result.data.items.find((item) => item.name === "통합돌봄 2").change_thousand_krw, 0);

  await assert.rejects(compareBudgetPeriods(db, { project_selection: { fiscal_project_ids: ids }, left: { fiscal_year: 2026, document_revision_id: left.revision_id }, right: { fiscal_year: 2026, observation_date: "2026-10-03" }, comparison_basis: "document_stage" }, make),
    (error) => error.code === "DOCUMENT_REVISION_REQUIRED", "문서 단계 금액과 기준일 현액을 한 비교로 묶지 않는다");
  await assert.rejects(compareBudgetPeriods(db, { project_selection: { fiscal_project_ids: ids }, left: { fiscal_year: 2026 }, right: { fiscal_year: 2026 }, comparison_basis: "document_stage" }, make), (error) => error.code === "DOCUMENT_REVISION_REQUIRED");
  await assert.rejects(compareBudgetPeriods(db, { project_selection: { fiscal_project_ids: ids }, left: { fiscal_year: 2025, document_revision_id: left.revision_id }, right: { fiscal_year: 2026, document_revision_id: right.revision_id }, comparison_basis: "document_stage" }, make), (error) => error.code === "INPUT_CONFLICT");
  await assert.rejects(compareBudgetPeriods(db, { project_selection: { fiscal_project_ids: ids }, left: { fiscal_year: 2026, document_revision_id: left.revision_id }, right: { fiscal_year: 2026, document_revision_id: right.revision_id }, comparison_basis: "same_reference_date" }, make), (error) => error.code === "MIXED_BASIS");

  const found = await findBudgetProjects(db, { fiscal_year: 2026, mode: "integrated_care", fiscal_entity_id: "lofin:laf:4900000" }, make);
  const links = found.data.items.find((item) => item.name === "통합돌봄 1").budget_documents;
  assert.deepEqual(links.map((link) => link.stage).sort(), ["adopted_initial", "adopted_supplementary"]);
  assert.ok(links.every((link) => /^brev-/.test(link.document_revision_id) && /^bl-/.test(link.budget_line_id)));
  assert.equal(found.data.items[0].current_budget_krw !== undefined, true, "API 예산현액은 그대로 둔다");
  assert.ok(found.warnings.some((warning) => warning.includes("budget_documents")));
});

test("묶음이 적은 검산이 서버 계산과 다르거나 추경 차수가 없으면 거절한다", async () => {
  const db = database();
  await seedFiscal(db);
  const lying = await built(packConfig("budgetdoc-test-lying-a", "doc:budget-test-jeju-2026-lying", "adopted_initial", null, "previous_year_budget", ADOPTED),
    extraction({ detail1: 3539300, detail2: 120000, mutate: (lines) => lines.map((line) => (line.line_no === 6 ? { ...line, amount_thousand_krw: "9" } : line)) }), ADOPTED);
  const rejected = await finalizeImport(db, await upload(db, lying), anySubject, NOW);
  assert.equal(rejected.status, "rejected");
  assert.ok(JSON.parse(rejected.report_json).problems.some((problem) => problem.code === "DECLARED_CHECK_DISAGREES"));

  const noRound = await built(packConfig("budgetdoc-test-noround-a", "doc:budget-test-jeju-2026-noround", "adopted_supplementary", null, "pre_revision_budget", SUPP), extraction({ detail1: 1, detail2: 1 }), SUPP);
  const noRoundRow = await finalizeImport(db, await upload(db, noRound), anySubject, NOW);
  assert.ok(JSON.parse(noRoundRow.report_json).problems.some((problem) => problem.code === "SUPPLEMENTARY_ROUND_INVALID"));

  const config = packConfig("budgetdoc-test-noentity-a", "doc:budget-test-jeju-2026-noentity", "adopted_initial", null, "previous_year_budget", ADOPTED);
  config.documents[0].fiscal_entity_id = "lofin:laf:1234567";
  const unknown = await finalizeImport(db, await upload(db, await built(config, extraction({ detail1: 1, detail2: 1 }), ADOPTED)), anySubject, NOW);
  assert.ok(JSON.parse(unknown.report_json).problems.some((problem) => problem.code === "FISCAL_ENTITY_UNKNOWN"));
});

test("문서 사실 활성화는 공개 중인 예산서 반입을 바꾸지 않고, 차단·되돌리기는 예산서에도 적용된다", async () => {
  const db = database();
  await seedFiscal(db);
  const adoptedA = await built(packConfig("budgetdoc-test-adopted-c", "doc:budget-test-jeju-2026-adopted", "adopted_initial", null, "previous_year_budget", ADOPTED), extraction({ detail1: 3539300, detail2: 120000 }), ADOPTED);
  const first = await publish(db, adoptedA);
  const knowledge = await buildDocumentPack({
    artifactId: "knowledge-test-0001", createdAt: "2026-10-05T00:00:00Z", producerRunId: "t", mappingVersion: "m1", baseSourceRunId: null,
    sources: [{ source_id: "doc:test-k", source_version_id: "sv-aaaaaaaa11", source_kind: "PUBLIC_NOTICE", title: "시험", issuer: "서귀포시", issuer_sido: "제주특별자치도", issuer_sigungu: "서귀포시", document_number: "", url: null, published_date: null, retrieved_at: "2026-10-05T00:00:00Z", raw_sha256: sha("k"), format: "HWP5", parse_id: "p_" + sha("k").slice(0, 32), parser: "kordoc@4.18.13", adapter_version: "a", locator_precision: "parsed_structural", page_mode: "layout", rights_basis: "시험" }],
    facts: [{ subject_id: "docprog:test-k", subject_label: "시험", subject_sido: "제주특별자치도", subject_sigungu: "서귀포시", predicate_id: "target_group", value_text: "시험 대상", unit: null, scope_text: null, source_version_id: "sv-aaaaaaaa11", reviewed_at: "2026-10-05T00:00:00Z", evidence: [{ block_id: "b:" + sha("k").slice(0, 16), ir_pointer: "/blocks/1", table_id: null, cell: null, layout_page_start: 1, quote: "시험 대상" }] }],
  });
  await publish(db, knowledge, NOW + 20);
  assert.equal((await readImport(db, first.id)).status, "active", "문서 사실 활성화가 예산서 반입을 superseded로 바꾸지 않는다");

  // 같은 문서를 새 원문으로 다시 반입하면 이전 단계는 공개 목록에서 빠지고(행은 보존), 되돌리면 다시 공개된다.
  const newer = { name: "adopted-2026-fixed", retrieved_at: "2026-10-06T00:00:00Z" };
  const second = await publish(db, await built(packConfig("budgetdoc-test-adopted-d", "doc:budget-test-jeju-2026-adopted", "adopted_initial", null, "previous_year_budget", newer), extraction({ detail1: 3539301, detail2: 120000 }), newer), NOW + 30);
  assert.equal((await readImport(db, first.id)).status, "superseded");
  assert.equal((await activeRevisions(db)).length, 1);
  await restoreImport(db, first.id, anySubject, NOW + 40);
  assert.equal((await readImport(db, first.id)).status, "active");
  assert.equal((await readImport(db, second.id)).status, "superseded");

  await blockSource(db, "doc:budget-test-jeju-2026-adopted", "시험 차단", NOW + 50);
  assert.equal((await activeRevisions(db)).length, 0, "차단한 예산서 문서는 공개 목록에서 빠진다");
  assert.equal((await readImport(db, first.id)).status, "superseded");
});

test("예산서 단계 목록은 재정 카탈로그로 찾고, 문서 비교는 예산서 행 ID나 세부사업명 검색어로도 고른다", async () => {
  const db = database();
  await seedFiscal(db);
  await publish(db, await built(packConfig("budgetdoc-test-adopted-e", "doc:budget-test-jeju-2026-adopted", "adopted_initial", null, "previous_year_budget", ADOPTED), extraction({ detail1: 3539300, detail2: 120000 }), ADOPTED));
  await publish(db, await built(packConfig("budgetdoc-test-supp1-e", "doc:budget-test-jeju-2026-supp1", "adopted_supplementary", 1, "pre_revision_budget", SUPP), extraction({ detail1: 3600000, detail2: 120000, previous1: 3539300, change1: 60700, header: "예산액|기정예산액|비교증감" }), SUPP), NOW + 10);
  const catalog = await getFiscalCatalog(db, { catalog_type: "budget_document", fiscal_year: 2026, fiscal_entity_id: "lofin:laf:4900000" }, make);
  assert.deepEqual(catalog.data.map((row) => row.stage_label).sort(), ["본예산(의결)", "제1회 추가경정예산(의결)"]);
  const [left, right] = ["adopted_initial", "adopted_supplementary"].map((stage) => catalog.data.find((row) => row.stage === stage).document_revision_id);
  const periods = { left: { fiscal_year: 2026, document_revision_id: left }, right: { fiscal_year: 2026, document_revision_id: right }, comparison_basis: "document_stage" };
  const byQuery = await compareBudgetPeriods(db, { project_selection: { detail_project_query: "통합돌봄" }, ...periods }, make);
  assert.deepEqual(byQuery.data.items.map((item) => [item.name, item.change_thousand_krw]), [["통합돌봄 1", 60700], ["통합돌봄 2", 0]]);
  const lineId = byQuery.data.items[0].left.budget_line_id;
  const byLine = await compareBudgetPeriods(db, { project_selection: { budget_line_ids: [lineId, "bl-unknown"] }, ...periods }, make);
  assert.equal(byLine.data.items[0].left_equals_right_pre_revision, true);
  assert.equal(byLine.data.items[1].comparable, false);
  await assert.rejects(compareBudgetPeriods(db, { project_selection: { detail_project_query: "통합돌봄", budget_line_ids: [lineId] }, ...periods }, make), (error) => error.code === "INPUT_INVALID", "고르는 방법은 하나만");
  await assert.rejects(compareBudgetPeriods(db, { project_selection: { detail_project_query: "통합돌봄" }, left: { fiscal_year: 2026 }, right: { fiscal_year: 2026 }, comparison_basis: "same_reference_date" }, make), (error) => error.code === "INPUT_INVALID", "검색어 고르기는 문서 단계 비교 전용");
});
