import assert from "node:assert/strict";
import test from "node:test";
import { budgetFiltersPath, budgetNationalPath, EMPTY_BUDGET_FILTERS } from "../components/budget/budget-paths.ts";
import { budgetDepartmentValue, selectBudgetDepartment } from "../components/budget/budget-selection.ts";

test("national totals never inherit local query conditions", () => {
  const selected = { ...EMPTY_BUDGET_FILTERS, date: "2026-09-01", region: "4900000", entity: "admin:4900000:4", department: "4005298", account: "100", q: "복지", page: 9 };
  assert.equal(budgetNationalPath(selected), budgetNationalPath(EMPTY_BUDGET_FILTERS));
  assert.equal(new URL("https://example.test" + budgetNationalPath({ ...selected, mode: "health" })).searchParams.get("mode"), "health");
});

test("account catalog depends on department but not selected account, search or page", () => {
  const selected = { ...EMPTY_BUDGET_FILTERS, department: "4005298" };
  assert.equal(new URL("https://example.test" + budgetFiltersPath(selected)).searchParams.get("department"), "4005298");
  assert.equal(budgetFiltersPath({ ...selected, account: "300", q: "검색", page: 7 }), budgetFiltersPath(selected));
});

test("department-only selection fills its verified region and institution without applying the query", () => {
  const department = { code: "3005060", fiscal_entity_name: "제주본청", entity_id: "admin:4900000:3", region_code: "4900000", project_count: 8 };
  const current = { ...EMPTY_BUDGET_FILTERS, q: "복지", account: "300" };
  assert.deepEqual(selectBudgetDepartment(current, department), { ...current, region: "4900000", entity: "admin:4900000:3", department: "3005060", account: "" });
  assert.equal(current.entity, "");
  assert.notEqual(budgetDepartmentValue(department), budgetDepartmentValue({ ...department, entity_id: "lofin:laf:1111000" }));
});

test("all departments clears stale account but preserves selected institution", () => {
  const current = { ...EMPTY_BUDGET_FILTERS, region: "4900000", entity: "admin:4900000:4", department: "4005298", account: "100" };
  assert.deepEqual(selectBudgetDepartment(current, undefined), { ...current, department: "", account: "" });
});
