import assert from "node:assert/strict";
import test from "node:test";
import { database } from "./press-test-support.mjs";
import { fiscalCatalog, snapshotSummary } from "./fiscal/query.ts";
import { parseBudgetRequest } from "./fiscal/public.ts";
import { availableBudgetParts, BUDGET_PARTS, budgetPartOf } from "./fiscal/parts.ts";
import { budgetFiltersPath, budgetResultPath, EMPTY_BUDGET_FILTERS } from "../components/budget/budget-paths.ts";

function adapter(sqlite) {
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
  });
  return { prepare: (sql) => statement(sql) };
}

function seed() {
  const { sqlite } = database();
  sqlite.prepare("INSERT INTO fiscal_entity VALUES ('e1', 'LOFIN', '1', '서귀포시', '4900000', '제주', '', 0, 0)").run();
  const project = sqlite.prepare("INSERT INTO fiscal_project VALUES (?, '2026', 'e1', '100', '일반회계', ?, ?, ?, ?, '분야', ?, '부문', 0, 0)");
  const observation = sqlite.prepare("INSERT INTO fiscal_observation (observation_id, fiscal_project_id, run_id, reference_date, source_exe_ymd, current_budget_raw, current_budget_krw, public_expenditure_raw, public_expenditure_krw, amount_problems, source_amount_unit, unit_verification, normalization_rule_id, contract_version, created_at) VALUES (?, ?, 'run1', '2026-10-04', '20261003', '1000', '1000', '500', '500', '[]', 'KRW', 'UNVERIFIED_IN_SCOPE', 'rule', 'contract', 0)");
  const member = sqlite.prepare("INSERT INTO fiscal_snapshot_member VALUES ('s1', ?, ?)");
  const rows = [
    // 노인복지과(4005298): 노인 2·보건의료 1. 주민복지과(4005060): 기초생활 1·옛 부문 084 1·일반공공행정 1.
    ["p1", "4005298", "001", "경로당 운영", "080", "08C"],
    ["p2", "4005298", "002", "노인일자리", "080", "08C"],
    ["p3", "4005298", "003", "치매 검진", "090", "091"],
    ["p4", "4005060", "004", "기초생활 지원", "080", "081"],
    ["p5", "4005060", "005", "옛 보육 부문", "080", "084"],
    ["p6", "4005060", "006", "청사 관리", "010", "011"],
  ];
  for (const [id, department, code, name, field, part] of rows) {
    project.run(id, department, code, name, field, part);
    observation.run("o" + id, id);
    member.run(id, "o" + id);
  }
  return adapter(sqlite);
}

test("세부 예산분야는 운영자가 정한 11개 부문을 순서대로 쓰고 사회복지·보건 분야에 묶인다", () => {
  assert.deepEqual(BUDGET_PARTS.map((part) => part.code), ["081", "082", "086", "087", "088", "089", "08A", "08B", "08C", "08D", "091"]);
  assert.equal(budgetPartOf("08c")?.name, "노인");
  assert.equal(budgetPartOf("091")?.mode, "health");
  assert.equal(budgetPartOf("084"), undefined);
});

test("part 조건: 분야와 맞는 부문만 받고, 모르는 부문·분야 불일치·중복은 거절한다", () => {
  const ok = parseBudgetRequest(new URLSearchParams({ mode: "social_welfare", part: "08c" }));
  assert.equal(ok.ok && ok.request.part, "08C");
  assert.equal(parseBudgetRequest(new URLSearchParams({ mode: "health", part: "091" })).ok, true);
  assert.equal(parseBudgetRequest(new URLSearchParams({ mode: "social_welfare", part: "091" })).ok, false);
  assert.equal(parseBudgetRequest(new URLSearchParams({ mode: "social_welfare", part: "084" })).ok, false);
  assert.equal(parseBudgetRequest(new URLSearchParams("mode=social_welfare&part=08C&part=08B")).ok, false);
  const none = parseBudgetRequest(new URLSearchParams({ mode: "social_welfare" }));
  assert.equal(none.ok && none.request.part, "");
});

test("부문 목록은 고른 부서에 사업이 있는 부문만 보이고, 목록 밖 원천 부문(084)은 빠진다", async () => {
  const db = seed();
  const fields = ["080", "090"];
  const countsOf = async (filter) => new Map((await fiscalCatalog(db, "s1", "classification", { fieldCodes: fields, ...filter })).map((row) => [String(row.part_code), Number(row.project_count)]));
  assert.deepEqual(availableBudgetParts(await countsOf({ departmentCodes: ["4005298"] })).map((part) => [part.code, part.project_count]), [["08C", 2], ["091", 1]]);
  assert.deepEqual(availableBudgetParts(await countsOf({ departmentCodes: ["4005060"] })).map((part) => part.code), ["081"]);
  assert.deepEqual(availableBudgetParts(await countsOf({})).map((part) => part.code), ["081", "08C", "091"]);
});

test("부문을 고르면 합계·목록이 그 부문 사업만 센다", async () => {
  const db = seed();
  const summary = await snapshotSummary(db, "s1", { fieldCodes: ["080"], partCodes: ["08C"] });
  assert.equal(summary.matching_rows, 2);
  assert.equal(summary.current_budget_krw, "2000");
  assert.equal((await snapshotSummary(db, "s1", { fieldCodes: ["080"] })).matching_rows, 4);
});

test("조회 주소는 부문을 싣고, 조건 목록 주소는 부문과 무관하다", () => {
  const selected = { ...EMPTY_BUDGET_FILTERS, department: "4005298", part: "08C" };
  assert.equal(new URL("https://example.test" + budgetResultPath(selected)).searchParams.get("part"), "08C");
  assert.equal(new URL("https://example.test" + budgetResultPath(EMPTY_BUDGET_FILTERS)).searchParams.has("part"), false);
  assert.equal(budgetFiltersPath(selected), budgetFiltersPath({ ...selected, part: "" }));
});
