import test from "node:test";
import assert from "node:assert/strict";
import { budgetDepartmentLabel } from "../../../components/budget/budget-departments.ts";

test("reviewed current ehojo names replace older names without changing code identity", () => {
  for (const [entity, code, name] of [
    ["서울본청", "1016110", "중장년지원과"],
    ["서울본청", "1037020", "고령사회대응과"],
    ["서울본청", "1090001", "통합돌봄과"],
    ["서울송파구", "1020010", "복지돌봄과"],
    ["경기화성시", "1002006", "청년청소년과"],
    ["경기화성시", "1021001", "통합돌봄과"],
    ["인천연수구", "1015020", "노인장애인과"],
    ["대전서구", "1025010", "통합돌봄과"],
  ]) assert.equal(budgetDepartmentLabel(entity, code), `${name} (${code})`);
});

test("source conflicts without explicit official code proof remain unconfirmed", () => {
  for (const code of ["1020010", "1020053", "1105010", "1105011"]) {
    assert.match(budgetDepartmentLabel("대구동구", code), /명칭 미확인/u);
  }
});

test("Gumi's official code and independent 2026 amounts resolve the transferred-project conflict", () => {
  assert.equal(budgetDepartmentLabel("경북구미시", "1050030"), "노동일자리과 (1050030)");
  assert.equal(budgetDepartmentLabel("서울본청", "1092011"), "주택실 임대주택과 (1092011)");
});

test("Hongseong's independent positive book amounts resolve the childcare department, not generic overhead", () => {
  assert.equal(budgetDepartmentLabel("충남홍성군", "1008002"), "인구전략담당관 (1008002)");
  assert.notEqual(budgetDepartmentLabel("충남홍성군", "1008002"), "기업지원과 (1008002)");
  assert.match(budgetDepartmentLabel("다른기관", "1008002"), /명칭 미확인/u);
  assert.equal(budgetDepartmentLabel("충남홍성군", "1001001"), "충효예복지과 (1001001)");
});
