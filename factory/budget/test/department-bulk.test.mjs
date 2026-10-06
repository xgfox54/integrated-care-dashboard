import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { officialAttachments, documentRows, matchCorpus, mergeReviewed } from "../department-corpus.mjs";
import { validateApiPage } from "../bulk-departments.mjs";
import { budgetDepartmentLabel, budgetDepartmentFilterLabel } from "../../../components/budget/budget-departments.ts";

const config = { fiscal_entity_id: "entity", fiscal_entity_name: "Test city", account_code: "100", account_name: "일반회계", amount_unit: "천원", stage: "adopted_initial" };
const doc = { id: "d", url: "https://city.go.kr/budget.pdf", sha256: "abc", index_sha256: "def", toc_names: ["복지과"], account_code: "100", account_basis: "official_index_general_account_section" };
function parsed(header = "부서: 복지과 정책: 지원", page = 1, name = "사업A", amount = "1") {
  const id = "t" + page;
  return { blocks: [{ page, parsed_text_verbatim: header }, { page, parsed_text_verbatim: "회계: 일반회계 (단위:천원)" }, { page, table_id: id }], tables: [{ table_id: id, logical_columns: 4, cells: [{ anchor_row: 0, anchor_col: 0, parsed_text_verbatim: "부서 정책 세부사업" }, { anchor_row: 1, anchor_col: 0, parsed_text_verbatim: name }, { anchor_row: 1, anchor_col: 1, parsed_text_verbatim: amount }] }] };
}
const item = (id, name, amount = "1000") => ({ fiscal_project_id: id, fiscal_year: "2026", reference_date: "2026-10-02", fiscal_entity: { fiscal_entity_id: "entity", name: "Test city" }, department_code: "0000123", account: { code: "100" }, name, current_budget_krw: amount });

test("reviewed Yongin entries use the actual 2026-10-02 observation and never a different entity or newer date", () => {
  for (const [code, name] of [["1020020", "복지정책과"], ["1033003", "노인복지과"], ["1033007", "아동보육과"], ["1033010", "장애인복지과"], ["1033011", "복지정책과"]]) {
    assert.equal(budgetDepartmentLabel("경기용인시", code, "2026", "2026-10-02"), `${name} (${code})`);
    assert.match(budgetDepartmentLabel("경기용인시", code, "2026", "2026-10-04"), /미확인/u);
    assert.match(budgetDepartmentLabel("다른기관", code, "2026", "2026-10-02"), /미확인/u);
    assert.equal(budgetDepartmentFilterLabel("경기용인시", code, [{ fiscal_entity: { name: "제주본청" }, fiscal_year: "2026", reference_date: "2026-10-04" }, { fiscal_entity: { name: "경기용인시" }, fiscal_year: "2026", reference_date: "2026-10-02" }]), `${name} (${code})`);
  }
});

test("bulk page header never carries forward and official index cannot substitute a missing header", () => {
  const a = parsed(), b = parsed("정책: 지원", 2, "사업B");
  const result = documentRows(doc, { blocks: [...a.blocks, ...b.blocks], tables: [...a.tables, ...b.tables] }, config, "2026");
  assert.equal(result.rows[0].department_name, "복지과");
  assert.equal(result.rows[1].department_name, null);
  assert.equal(result.audit[1].reason, "missing_or_ambiguous_same_page_header");
  assert.equal(matchCorpus([item("a", "사업A"), item("b", "사업B")], result.rows).mappings.length, 0);
});

test("unknown headers remain in cross-volume uniqueness checks and cannot authorize a department", () => {
  const a = documentRows(doc, parsed(), config, "2026").rows;
  const duplicate = documentRows({ ...doc, id: "second" }, parsed("부서: 다른과 정책: 지원", 3), config, "2026").rows;
  const b = documentRows(doc, parsed("부서: 복지과 정책: 지원", 2, "사업B"), config, "2026").rows;
  assert.equal(matchCorpus([item("a", "사업A"), item("b", "사업B")], [...a, ...duplicate, ...b]).mappings.length, 0);
  assert.equal(matchCorpus([item("a", "사업A"), item("b", "사업B")], [...a, ...b]).mappings.length, 1);
});

test("account section, page amount unit, explicit heading and approved index are independently required", () => {
  for (const [header, account] of [["부서: 다른과", "회계: 일반회계 (단위:천원)"], ["부서: 복지과", "회계: 특별회계 (단위:천원)"], ["부서: 복지과", "회계: 일반회계 (단위:백만원)"]]) {
    const data = parsed(header); data.blocks[1].parsed_text_verbatim = account;
    assert.equal(documentRows(doc, data, config, "2026").rows[0].department_name, null);
  }
  assert.equal(documentRows({ ...doc, account_code: "200" }, parsed(), config, "2026").rows[0].department_name, null);
});

test("official attachment inventory fails closed on scope or completeness changes", () => {
  const c = { adapter: "yongin-official-attachment-index", index_url: "https://city.go.kr/budget", index_required_text: ["2026", "본예산"], resource_ids: ["1"], expected_documents: 1, account_code: "100" };
  const html = '2026 본예산 <h4>세출예산 사업명세서(일반회계)</h4><a href="/ND_resrceFileDownload.do?resrceSn=1&fileSn=2">국(복지과, 보건과)</a><h4>기타 특별회계</h4>';
  assert.deepEqual(officialAttachments(html, c)[0].toc_names, ["복지과", "보건과"]);
  assert.throws(() => officialAttachments(html.replace("2026", "2025"), c), /SCOPE/);
  assert.throws(() => officialAttachments(html, { ...c, expected_documents: 2 }), /INCOMPLETE/);
  assert.throws(() => officialAttachments(html.replace("/ND_", "https://other.go.kr/ND_"), c), /INCOMPLETE/);
});

test("API scope and snapshot drift block resumable page reuse", () => {
  const page = { snapshot: { complete: true, snapshot_id: "s1" }, total: 1, size: 20, items: [item("a", "사업A")] };
  validateApiPage(page, config, "2026");
  assert.throws(() => validateApiPage(page, config, "2025"), /SCOPE/);
  assert.throws(() => validateApiPage(page, config, "2026", "other-snapshot"), /SNAPSHOT_CHANGED/);
  assert.throws(() => validateApiPage({ ...page, snapshot: { complete: false } }, config, "2026"), /INCOMPLETE/);
});

test("review merge preserves existing Jeju entries verbatim, rejects conflicts, and requires explicit reviewed keys", () => {
  const existing = JSON.parse(readFileSync(new URL("../../../components/budget/budget-department-names.json", import.meta.url), "utf8"));
  const rows = [...documentRows(doc, parsed(), config, "2026").rows, ...documentRows(doc, parsed("부서: 복지과", 2, "사업B"), config, "2026").rows];
  const result = matchCorpus([item("a", "사업A"), item("b", "사업B")], rows);
  assert.deepEqual(mergeReviewed(existing, result.mappings, []), existing);
  const key = "Test city|2026|2026-10-02|0000123";
  const merged = mergeReviewed(existing, result.mappings, [key]);
  assert.deepEqual(merged.mappings.slice(0, existing.mappings.length), existing.mappings);
  assert.equal(merged.mappings.length, existing.mappings.length + 1);
  assert.throws(() => mergeReviewed(merged, [{ ...result.mappings[0], department_name: "충돌" }], [key]), /CONFLICT/);
});
