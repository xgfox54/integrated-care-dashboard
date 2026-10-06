import test from "node:test";
import assert from "node:assert/strict";
import { budgetDepartmentFilterLabel, budgetDepartmentLabel } from "../../../components/budget/budget-departments.ts";

test("real 4005100 evidence resolves only the verified entity, year and date", () => {
  assert.equal(budgetDepartmentLabel("제주본청", "4005100", "2026", "2026-10-04"), "서귀포시노인복지과 (4005100)");
  for (const args of [["다른기관", "4005100", "2026", "2026-10-04"], ["제주본청", "4005100", "2025", "2026-10-04"], ["제주본청", "4005100", "2026", "2026-10-05"], ["제주본청", "1027001", "2026", "2026-10-04"]]) assert.match(budgetDepartmentLabel(...args), /명칭 미확인/u);
});
test("filter uses actual entity observation date, never the global newest date", () => {
  const jeju = { fiscal_entity: { name: "제주본청" }, fiscal_year: "2026", reference_date: "2026-10-04" };
  const other = { fiscal_entity: { name: "다른기관" }, fiscal_year: "2026", reference_date: "2026-10-05" };
  assert.equal(budgetDepartmentFilterLabel("제주본청", "4005100", [other, jeju]), "서귀포시노인복지과 (4005100)");
  assert.match(budgetDepartmentFilterLabel("제주본청", "4005100", [other]), /명칭 미확인/u);
  assert.match(budgetDepartmentFilterLabel("제주본청", "4005100", [jeju, { ...jeju, reference_date: "2026-10-05" }]), /명칭 미확인/u);
});
