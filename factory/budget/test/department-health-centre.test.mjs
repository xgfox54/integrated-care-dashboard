import test from "node:test";
import assert from "node:assert/strict";
import exclusions from "../../../lib/fiscal/department-exclusions.json" with { type: "json" };
import { budgetDepartmentLabel, budgetDepartmentName } from "../../../components/budget/budget-departments.ts";

// 2026-10-09 운영자 지시: 보건소 본소는 화면에 포함하고, 행정표준코드상 하위 과가 있으면 부서명에 함께 표시한다.
test("main health centres are shown with their official sub-departments", () => {
  assert.equal(budgetDepartmentLabel("강원양구군", "1105120"), "보건소(보건정책과·건강증진과) (1105120)");
  assert.equal(budgetDepartmentName("경기평택시", "1110010"), "송탄보건소(보건사업과·건강증진과)");
  assert.equal(budgetDepartmentName("전남광주해남군", "1105010"), "보건소", "no 과 under the centre: plain name");
  assert.equal(budgetDepartmentName("강원양구군", "1105110"), null, "other codes of the same county stay unnamed");
});

test("only health branch offices remain excluded from the budget screen", () => {
  const keys = new Set(exclusions.departments.map((d) => d.fiscal_entity_name + "|" + d.department_code));
  for (const key of ["강원양구군|1105120", "경기평택시|1105010", "충남홍성군|1105010", "제주본청|1105120"]) assert.equal(keys.has(key), false, key);
  for (const key of ["경기군포시|1105011", "대구달서구|1105011", "경기하남시|1105017"]) assert.equal(keys.has(key), true, key);
  assert.equal(exclusions.departments.some((d) => /보건소$/u.test(d.department_name) && !/보건지소$/u.test(d.department_name)), false);
});
test("Jeju administrative-city health centre departments show their official health-centre affiliation", () => {
  assert.equal(budgetDepartmentLabel("제주본청", "1105110"), "서귀포보건소 보건행정과 (1105110)");
  assert.equal(budgetDepartmentLabel("제주본청", "4005300"), "서귀포보건소 건강증진과 (4005300)");
  assert.equal(budgetDepartmentLabel("제주본청", "1105100"), "제주보건소 보건행정과 (1105100)");
  assert.equal(budgetDepartmentLabel("제주본청", "3005408"), "제주보건소 건강증진과 (3005408)");
  assert.equal(budgetDepartmentLabel("제주본청", "1105130"), "서귀포보건소 동부보건소 (1105130)");
  assert.equal(budgetDepartmentLabel("제주본청", "1045040"), "보건정책과 (1045040)", "province departments keep their own name");
});
test("district health-centre departments are reachable from their administrative district", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync(new URL("../../../drizzle/0091_admin_district_health_centres.sql", import.meta.url), "utf8");
  assert.match(sql, /dept_prefix = '3,1105010,1105056,1105060' WHERE unit_id = 'admin:4111000:3' AND dept_prefix = '3'/u, "수원 장안구보건소 3개 과");
  assert.match(sql, /'admin:4411000:2007'/u, "천안 서북구보건소 보건정책과");
  for (const shared of ["1113005", "1114005", "1105010' WHERE unit_id = 'admin:4511000"]) assert.equal(sql.includes(shared), false, "창원·마산보건소와 전주시보건소는 시 단위로 둔다");
  assert.equal(budgetDepartmentLabel("충남천안시", "1102001"), "서북구보건소 보건정책과 (1102001)");
});
