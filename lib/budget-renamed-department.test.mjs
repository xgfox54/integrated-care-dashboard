import assert from "node:assert/strict";
import test from "node:test";
import { budgetDocumentMatcher } from "./fiscal/budget-document-matching.ts";

const project = { fiscal_project_id: "fp:2026:4111000:100:1020055:3740000200730001", name: "사회단체 지원", department_code: "1020055", dbiz_code: "3740000200730001" };
const book = (departmentName) => [
  { line_no: 1, parent_line_no: null, level: "department", name: departmentName, annotations: [] },
  { line_no: 2, parent_line_no: 1, level: "detail_project", name: "사회단체 지원", annotations: ["부서코드 1020055 · 세부사업코드 3740000200730001"] },
];

test("예산서의 옛 부서명도 같은 부서코드면 같은 부서로 대조한다", () => {
  // Given: 예산서는 개편 전 이름(노동일자리정책과), 등록부는 현행 이름(노동일자리과)으로 같은 코드 1020055를 기록한다.
  const lines = book("노동일자리정책과");
  // When
  const result = budgetDocumentMatcher("경기수원시", lines)(lines[1], [project]);
  // Then
  assert.equal(result.basis, "department_and_project_code");
  assert.deepEqual(result.candidates.map((item) => item.fiscal_project_id), [project.fiscal_project_id]);
});

test("옛 부서명이라도 다른 부서코드 주석은 연결하지 않는다", () => {
  // Given
  const lines = book("노동일자리정책과");
  const conflicting = { ...lines[1], annotations: ["부서코드 1020030 · 세부사업코드 3740000200730001"] };
  // When
  const result = budgetDocumentMatcher("경기수원시", lines)(conflicting, [project]);
  // Then
  assert.equal(result.basis, "identity_conflict");
  assert.deepEqual(result.candidates, []);
});
