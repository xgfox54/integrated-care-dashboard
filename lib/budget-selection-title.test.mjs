import assert from "node:assert/strict";
import test from "node:test";
import { budgetDepartmentName, formatBudgetLocalTitle } from "../components/budget/budget-departments.ts";

for (const [code, expected] of [["4005298", "서귀포시 장애인복지과"], ["4005100", "서귀포시 노인복지과"]]) {
  test(`selected department ${code} appears once after its administrative city`, () => {
    const name = budgetDepartmentName("제주본청", code);
    assert.ok(name);
    const title = formatBudgetLocalTitle("서귀포시", name);
    assert.equal(title, expected);
  });
}

test("all departments retain only the selected region title", () => {
  const title = formatBudgetLocalTitle("서귀포시", "");
  assert.equal(title, "서귀포시");
});

test("a department without a regional prefix retains its full name", () => {
  const title = formatBudgetLocalTitle("용인시", "기흥구 사회복지과");
  assert.equal(title, "용인시 기흥구 사회복지과");
});

test("an unverified department remains explicitly identified by code", () => {
  const title = formatBudgetLocalTitle("서귀포시", "부서코드 9999999");
  assert.equal(title, "서귀포시 부서코드 9999999");
});
