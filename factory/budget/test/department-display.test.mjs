import test from "node:test";
import assert from "node:assert/strict";
import { budgetDepartmentLabel } from "../../../components/budget/budget-departments.ts";

test("a verified code keeps its name whatever the observation date; other entities and unverified codes stay unknown", () => {
  assert.equal(budgetDepartmentLabel("제주본청", "4005100"), "서귀포시노인복지과 (4005100)");
  for (const [entity, code] of [["다른기관", "4005100"], ["제주본청", "1027001"]]) assert.match(budgetDepartmentLabel(entity, code), /명칭 미확인/u);
});

test("departments split off after the adopted book show their current name (2026 제2회 추경 예산서)", () => {
  assert.equal(budgetDepartmentLabel("제주본청", "4005301"), "서귀포시통합돌봄과 (4005301)");
  assert.equal(budgetDepartmentLabel("제주본청", "4005281"), "서귀포시주민복지과 (4005281)");
  assert.equal(budgetDepartmentLabel("제주본청", "3005415"), "제주시통합돌봄과 (3005415)");
});

test("names are kept only for social-welfare/health departments of large organisations", async () => {
  const { pruneDepartmentNames } = await import("../prune-department-names.mjs");
  const entry = (entity, code, name) => ({ fiscal_entity_name: entity, department_code: code, department_name: name });
  const names = { schema: "s", rule: "r", mappings: [entry("A", "1", "복지정책과"), entry("A", "2", "총무과"), entry("A", "3", "동부보건소"), entry("A", "4", "건강증진과"), entry("A", "5", "덕산보건지소"), entry("B", "1", "체육진흥과")] };
  const { kept, removed } = pruneDepartmentNames(names, ["A|1", "A|3", "A|4", "A|5"]);
  assert.deepEqual(kept.mappings.map((m) => m.department_name), ["복지정책과", "동부보건소", "건강증진과"]);
  assert.equal(removed, 3, "총무과·보건지소·다른 기관 체육진흥과");
  assert.equal(budgetDepartmentLabel("제주본청", "4005284"), "서귀포보건소 서부보건소 (4005284)", "보건소 본소는 이름을 붙인다(2026-10-09 운영자 지시)");
});

