import test from "node:test";
import assert from "node:assert/strict";
import { explicitPageDepartment, matchDepartments } from "../match-departments.mjs";

const api = (name, extra = {}) => ({ project_id: name, fiscal_year: "2026", reference_date: "2026-10-04", fiscal_entity_name: "제주본청", account_code: "100", department_code: "4005100", name, amount_krw: "123000", ...extra });
const doc = (name, extra = {}) => ({ fiscal_year: "2026", fiscal_entity_name: "제주본청", account_code: "100", department_name: "서귀포시노인복지과", name, amount_krw: "123000", ...extra });
const run = (a = {}, d = {}) => matchDepartments([api("사업가"), api("사업나", a)], [doc("사업가"), doc("사업나", d)]);

test("P1: missing or contradictory page header never inherits the previous department", () => {
  assert.equal(explicitPageDepartment([{ parsed_text_verbatim: "부서: 제주시우도면" }]), "제주시우도면");
  assert.equal(explicitPageDepartment([{ parsed_text_verbatim: "정책: 문화사업" }]), null);
  assert.equal(explicitPageDepartment([{ parsed_text_verbatim: "부서: 제주시일도1동\n정책: 행정운영" }]), "제주시일도1동");
  assert.equal(explicitPageDepartment([{ parsed_text_verbatim: "부서: 민속자연사박물관" }, { parsed_text_verbatim: "부서: 축산생명연구원" }]), null);
});

test("two independent exact positive amounts resolve without mutating API values", () => {
  const rows = [api("사업가"), api("사업 나")], before = structuredClone(rows);
  const result = matchDepartments(rows, [doc("사업가"), doc("사업나")]);
  assert.equal(result.mappings.length, 1);
  assert.equal(result.mappings[0].evidence.length, 2);
  assert.deepEqual(rows, before);
});
test("one won difference, account/entity/year mismatch and missing/zero amount never resolve", () => {
  for (const change of [{ amount_krw: "123001" }, { amount_krw: null }, { amount_krw: "0" }, { account_code: "200" }, { fiscal_year: "2025" }, { fiscal_entity_name: "다른기관" }]) assert.equal(run(change).mappings.length, 0);
});
test("a duplicate in any official volume or source project is ambiguous", () => {
  assert.equal(matchDepartments([api("사업가"), api("사업나")], [doc("사업가"), doc("사업가", { department_name: "다른부서" }), doc("사업나")]).mappings.length, 0);
  assert.equal(matchDepartments([api("사업가"), api("사업나"), api("사업나", { project_id: "중복" })], [doc("사업가"), doc("사업나")]).mappings.length, 0);
});
test("conflicting department names block the whole code", () => {
  const result = run({}, { department_name: "서귀포시주민복지과" });
  assert.equal(result.mappings.length, 0);
  assert.equal(result.held[0].reason, "conflicting_departments");
});
test("punctuation, revision suffixes and single evidence are not inferred", () => {
  assert.equal(matchDepartments([api("사업(가)"), api("사업나")], [doc("사업가"), doc("사업나")]).mappings.length, 0);
  assert.equal(matchDepartments([api("사업가"), api("사업나(전환)")], [doc("사업가"), doc("사업나")]).mappings.length, 0);
  assert.equal(matchDepartments([api("사업가")], [doc("사업가")]).mappings.length, 0);
});
