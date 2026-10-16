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
import { McpData } from "./mcp/data.ts";
import { handleMcpRequest } from "./mcp/server.ts";
import { ensureActiveBundle } from "./platform/bundle.ts";

const NOW = 1_791_200_000;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const anySubject = async (ids) => new Set(ids);
const make = (payload, options) => ({ data: payload, ...options });

async function seedFiscal(db, departments = ["1045020", "1045020"]) {
  const row = (index, dept, budget) => ({
    fyr: "2026", wa_laf_cd: "4900000", wa_laf_hg_nm: "제주", laf_cd: "4900000", laf_hg_nm: "제주본청", acnt_dv_cd: "100", acnt_dv_nm: "일반회계",
    dept_cd: dept, dbiz_cd: "65000002007300" + index, dbiz_nm: "통합돌봄 " + index, exe_ymd: "20261003", bdg_cash_amt: budget, ep_amt: 1000000,
    bdg_ntep: 0, capep: budget, sggep: 0, etc_amt: 0, cpl_amt: budget, fld_cd: "080", fld_nm: "사회복지", ane_part_cd: "082", part_nm: "노인", padm_laf_cd: "6500000",
  });
  const body = JSON.stringify({ QWGJK: [{ head: [{ list_total_count: 2 }, { RESULT: { CODE: "INFO-000" } }] }, { row: [row(1, departments[0], 3539300000), row(2, departments[1], 120000000)] }] });
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


async function publicBudgetCall(db, name, args = {}) {
  const response = await handleMcpRequest(new Request("https://dashboard.example/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }), new McpData(db, async () => new Map()), (error) => { console.error(error); });
  assert.equal(response.status, 200);
  const result = (await response.json()).result;
  assert.ok(result, name);
  return result;
}

async function independentBudget(db, artifact = "budget-mcp-independent", source = ADOPTED) {
  const config = packConfig(artifact, "doc:budget-independent", "adopted_initial", null, "previous_year_budget", source);
  config.documents[0].fiscal_entity_id = null;
  return built(config, extraction({ detail1: 3539300, detail2: 120000 }), source);
}

test("공개 MCP는 재정 snapshot 없이도 승인 예산서를 검색하고 부기·재원·출처를 끝까지 조회한다", async () => {
  const db = database();
  const pack = await independentBudget(db);
  const importId = await upload(db, pack);
  assert.equal((await finalizeImport(db, importId, anySubject, NOW)).status, "staged");
  assert.equal((await publicBudgetCall(db, "search_budget_lines")).structuredContent.data.items.length, 0, "승인 전 문서는 비공개");
  await approveImport(db, importId, pack.sha256, NOW + 1);
  await activateImport(db, importId, anySubject, NOW + 2);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM fiscal_snapshot").get().n, 0);
  const status = (await publicBudgetCall(db, "get_dataset_status")).structuredContent;
  assert.equal(status.data.fiscal.status, "UNAVAILABLE");
  assert.equal(status.data.budget_documents.status, "PARTIAL");
  assert.equal(status.data.budget_documents.lines, 11);
  assert.ok(status.components.budget_documents);
  const args = { query: "통합돌봄", fiscal_year: 2026, issuer_sido: "제주특별자치도", limit: 1 };
  const first = (await publicBudgetCall(db, "search_budget_lines", args)).structuredContent;
  assert.equal(first.data.items[0].amount_krw, "3539300000");
  assert.equal(first.coverage.total_count, 2);
  assert.ok(first.next_cursor);
  const second = (await publicBudgetCall(db, "search_budget_lines", { ...args, cursor: first.next_cursor })).structuredContent;
  assert.equal(second.data.items[0].name, "통합돌봄 2");
  assert.equal(second.next_cursor, null);
  const selected = first.data.items[0];
  const sharedSearch = (await publicBudgetCall(db, "search", { query: "통합돌봄" })).structuredContent;
  assert.ok(sharedSearch.results.some((row) => row.id === selected.budget_line_id));
  // 통합 검색의 예산서 후보는 질문의 지역·연도를 따르고, 다른 지역 예산서로 대신 채우지 않는다.
  const seogwipo = (await publicBudgetCall(db, "search", { query: "2026년 서귀포시 통합돌봄 예산" })).structuredContent;
  const seogwipoBudget = seogwipo.results.findIndex((row) => row.entity_type === "budget_line");
  assert.ok(seogwipoBudget >= 0 && seogwipoBudget <= 2, "서귀포시 질문은 상위 제주특별자치도 예산서를 3위 안에 둔다: " + JSON.stringify(seogwipo.results.map((row) => row.title)));
  const busan = (await publicBudgetCall(db, "search", { query: "부산 금정구 통합돌봄 예산" })).structuredContent;
  assert.equal(busan.results.filter((row) => row.entity_type === "budget_line").length, 0, JSON.stringify(busan.results.map((row) => row.title)));
  assert.ok(busan.warnings.some((warning) => warning.includes("요청 지역의 승인 예산서")));
  const otherYear = (await publicBudgetCall(db, "search", { query: "2024년 제주 통합돌봄 예산" })).structuredContent;
  assert.equal(otherYear.results.filter((row) => row.entity_type === "budget_line").length, 0, "요청 연도와 다른 예산서는 고르지 않는다");
  const sharedFetch = (await publicBudgetCall(db, "fetch", { id: selected.budget_line_id })).structuredContent;
  assert.equal(sharedFetch.metadata.root.amount_krw, "3539300000");
  assert.match(sharedFetch.text, /편성단계: 본예산/);
  assert.equal(sharedFetch.metadata.content_scope, "approved_budget_document_lines");

  let cursor;
  const rows = [];
  do {
    const result = (await publicBudgetCall(db, "get_budget_breakdown", { budget_line_id: selected.budget_line_id, document_revision_id: selected.document_revision_id, limit: 2, ...(cursor ? { cursor } : {}) })).structuredContent;
    assert.equal(result.coverage.total_count, 5);
    assert.equal(result.data.aggregation, "NOT_SUMMED_HIERARCHICAL_ROWS");
    assert.equal(result.data.revision.stage, "adopted_initial");
    assert.ok(!JSON.stringify(result).includes("api_comparison"));
    rows.push(...result.data.lines);
    cursor = result.next_cursor;
  } while (cursor);
  assert.deepEqual(rows.map((row) => row.level), ["detail_project", "object_group", "object", "item", "item"]);
  assert.equal(new Set(rows.map((row) => row.budget_line_id)).size, 5);
  assert.equal(rows.at(-1).formula_text, "300,000원");
  assert.equal(rows.at(-1).amount_krw, "300000");
  const source = (await publicBudgetCall(db, "get_sources", { subject_type: "budget_line", subject_id: rows.at(-1).budget_line_id })).structuredContent.data[0];
  assert.equal(source.document.source.page_url, "https://www.jeju.go.kr/budget");
  assert.ok(source.document.source.raw_sha256);
  assert.ok(source.locator.block_id);
  assert.equal(source.locator.physical_page_verified, false);
  const department = (await publicBudgetCall(db, "search_budget_lines", { level: "department" })).structuredContent.data.items[0];
  const funding = (await publicBudgetCall(db, "get_budget_breakdown", { budget_line_id: department.budget_line_id, limit: 1 })).structuredContent.data.root.funding;
  assert.deepEqual(funding.map((row) => row.label), ["국", "시"]);
  const catalog = (await publicBudgetCall(db, "get_fiscal_catalog", { catalog_type: "budget_document" })).structuredContent;
  assert.equal(catalog.data[0].document_revision_id, selected.document_revision_id);
  db.sqlite.prepare("UPDATE budget_line SET name = '노인복지정책 업무추진' WHERE line_id = ?").run(selected.budget_line_id);
  const sixTerms = (await publicBudgetCall(db, "search_budget_lines", { ...args, query: "노 인 복지 정책 업무 추진" })).structuredContent;
  assert.deepEqual(sixTerms.data.items.map((item) => item.budget_line_id), [selected.budget_line_id]);
  const missingSixth = (await publicBudgetCall(db, "search_budget_lines", { ...args, query: "노인 복지 정책 업무 추진 우주여행" })).structuredContent;
  assert.equal(missingSixth.coverage.total_count, 0, "여섯 번째 검색어도 반드시 일치해야 한다");
  assert.deepEqual(missingSixth.data.items, []);
  for (const literal of ["%", "_", "\\"]) {
    const escaped = (await publicBudgetCall(db, "search_budget_lines", { ...args, query: "노인 복지 정책 업무 추진 " + literal })).structuredContent;
    assert.equal(escaped.coverage.total_count, 0, "여섯 번째 검색어의 LIKE 특수문자는 문자 그대로 검색한다");
  }
});

test("예산서 공개본 pin·커서는 새 승인본을 섞지 않고 철회는 즉시 반영한다", async () => {
  const db = database();
  db.sqlite.prepare("INSERT INTO official_sync_run (id, trigger, status, started_at, completed_at) VALUES ('budget-knowledge', 'manual', 'succeeded', ?, ?)").run(NOW, NOW);
  await publish(db, await independentBudget(db, "budget-mcp-pinned-first"));
  await ensureActiveBundle(db, NOW + 3);
  const first = (await publicBudgetCall(db, "search_budget_lines", { limit: 1 })).structuredContent;
  const oldLine = first.data.items[0].budget_line_id;
  const newer = { name: "budget-pinned-new", retrieved_at: "2026-10-06T00:00:00Z" };
  await publish(db, await independentBudget(db, "budget-mcp-pinned-second", newer), NOW + 20);
  const between = (await publicBudgetCall(db, "search_budget_lines")).structuredContent;
  assert.equal(between.release_bundle_id, first.release_bundle_id);
  assert.equal(between.data.items.length, 0, "구판은 비활성이고 신판은 아직 이 공개본에 없음");
  assert.equal((await publicBudgetCall(db, "get_budget_breakdown", { budget_line_id: oldLine })).structuredContent.error.code, "NOT_FOUND");
  await ensureActiveBundle(db, NOW + 25);
  const current = (await publicBudgetCall(db, "search_budget_lines", { limit: 1 })).structuredContent;
  assert.notEqual(current.release_bundle_id, first.release_bundle_id);
  assert.notEqual(current.components.budget_documents, first.components.budget_documents);
  assert.equal((await publicBudgetCall(db, "search_budget_lines", { cursor: first.next_cursor, limit: 1 })).structuredContent.error.code, "CURSOR_STALE");
  assert.equal((await publicBudgetCall(db, "search_budget_lines", { release_bundle_id: first.release_bundle_id })).structuredContent.error.code, "BUNDLE_SUPERSEDED");
  const newLine = current.data.items[0].budget_line_id;
  await blockSource(db, "doc:budget-independent", "시험 공개 철회", NOW + 30);
  assert.equal((await publicBudgetCall(db, "get_sources", { subject_type: "budget_line", subject_id: newLine })).structuredContent.error.code, "NOT_FOUND");
  assert.equal((await publicBudgetCall(db, "get_dataset_status")).structuredContent.data.budget_documents.status, "UNAVAILABLE");
});

test("예산서 목록은 200개 이후도 조회하고 하위 내역은 1500행에서 조용히 잘리지 않는다", async () => {
  const db = database();
  await publish(db, await independentBudget(db, "budget-mcp-large"));
  const [revision] = await activeRevisions(db);
  db.sqlite.exec("BEGIN");
  for (let i = 0; i < 205; i++) {
    const id = "brev-pagination-" + String(i).padStart(3, "0");
    db.sqlite.prepare("INSERT INTO budget_revision SELECT import_id, ?, document_id, stage, supplementary_round, stage_basis, unit, account_code, account_name, scope_text, amount_columns, 0, checks_json FROM budget_revision WHERE import_id = ? AND revision_id = ?").run(id, revision.import_id, revision.revision_id);
    db.sqlite.prepare("INSERT INTO budget_active_revision SELECT ?, import_id, document_id, fiscal_entity_id, fiscal_year, stage, supplementary_round, retrieved_at, activated_at FROM budget_active_revision WHERE revision_id = ?").run(id, revision.revision_id);
  }
  for (let i = 0; i < 1505; i++) db.sqlite.prepare("INSERT INTO budget_line (import_id, line_id, revision_id, line_no, parent_line_no, level, name) VALUES (?, ?, ?, ?, 7, 'sub_item', ?)").run(revision.import_id, "bl-pagination-" + i, revision.revision_id, 20 + i, "산출항목 " + i);
  db.sqlite.prepare("UPDATE budget_revision SET line_count = 1516 WHERE import_id = ? AND revision_id = ?").run(revision.import_id, revision.revision_id);
  db.sqlite.exec("COMMIT");
  let cursor;
  const revisions = [];
  do {
    const result = (await publicBudgetCall(db, "get_fiscal_catalog", { catalog_type: "budget_document", limit: 50, ...(cursor ? { cursor } : {}) })).structuredContent;
    assert.equal(result.coverage.total_count, 206);
    revisions.push(...result.data);
    cursor = result.next_cursor;
  } while (cursor);
  assert.equal(new Set(revisions.map((row) => row.document_revision_id)).size, 206);
  const root = db.sqlite.prepare("SELECT line_id FROM budget_line WHERE import_id = ? AND revision_id = ? AND line_no = 7").get(revision.import_id, revision.revision_id);
  let count = 0;
  do {
    const result = (await publicBudgetCall(db, "get_budget_breakdown", { budget_line_id: root.line_id, limit: 50, ...(cursor ? { cursor } : {}) })).structuredContent;
    assert.equal(result.coverage.total_count, 1506);
    count += result.data.lines.length;
    cursor = result.next_cursor;
  } while (cursor);
  assert.equal(count, 1506);
});

test("문서 단계 비교는 이름이 하나뿐이어도 선택 행의 부서가 다른 상대 사업을 비교하지 않는다", async () => {
  const db = database();
  await seedFiscal(db);
  await publish(db, await built(packConfig("budget-dept-compare-left", "doc:budget-dept-left", "adopted_initial", null, "previous_year_budget", ADOPTED), extraction({ detail1: 3539300, detail2: 120000 }), ADOPTED));
  const extracted = extraction({ detail1: 3539400, detail2: 120000, mutate: (lines) => lines.map((line) => line.level === "department" ? { ...line, name: "다른부서" } : line) });
  await publish(db, await built(packConfig("budget-dept-compare-right", "doc:budget-dept-right", "adopted_supplementary", 1, "pre_revision_budget", SUPP), extracted, SUPP), NOW + 10);
  const revisions = await activeRevisions(db);
  const left = revisions.find((row) => row.stage === "adopted_initial");
  const right = revisions.find((row) => row.stage === "adopted_supplementary");
  const line = db.sqlite.prepare("SELECT line_id FROM budget_line WHERE import_id = ? AND revision_id = ? AND line_no = 4").get(left.import_id, left.revision_id);
  const result = (await publicBudgetCall(db, "compare_budget_periods", { comparison_basis: "document_stage", project_selection: { budget_line_ids: [line.line_id] }, left: { fiscal_year: 2026, document_revision_id: left.revision_id }, right: { fiscal_year: 2026, document_revision_id: right.revision_id } })).structuredContent;
  assert.equal(result.data.items[0].comparable, false);
  assert.ok(!("change_thousand_krw" in result.data.items[0]));
});


test("행정시 지역은 상위 재정주체의 검증된 부서코드 앞자리로만 예산을 좁힌다", async () => {
  const db = database();
  await seedFiscal(db, ["4005301", "1045020"]);
  db.sqlite.prepare("INSERT OR REPLACE INTO fiscal_region_mapping (mapping_id, fiscal_entity_id, region_id, relation, basis, verification_status) VALUES ('map:jeju', 'lofin:laf:4900000', 'region:제주특별자치도', 'jurisdiction', '시험', 'VERIFIED')").run();
  const found = await findBudgetProjects(db, { fiscal_year: 2026, mode: "integrated_care", region_id: "region:제주특별자치도|서귀포시" }, make);
  assert.deepEqual(found.data.items.map((item) => item.name), ["통합돌봄 1"], "도 본청 부서(1045020) 사업은 서귀포시 값으로 넣지 않는다");
  assert.ok(found.warnings.some((warning) => warning.startsWith("서귀포시는 ") && warning.includes("부서코드 앞자리")));
  await assert.rejects(findBudgetProjects(db, { fiscal_year: 2026, mode: "integrated_care", region_id: "region:제주특별자치도|가상시" }, make), (error) => error.code === "MAPPING_REQUIRED");
});

