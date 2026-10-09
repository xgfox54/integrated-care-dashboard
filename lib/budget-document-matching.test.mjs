import assert from "node:assert/strict";
import test from "node:test";
import { documentLinksForProjects, revisionOutline } from "./fiscal/budget-documents.ts";
import { squashName } from "./fiscal/budget-document-matching.ts";
import { DEPARTMENTS, matchingDatabase, PROJECT_CODES, publishMatchingBook } from "./budget-document-match-support.mjs";

test("전남광주 통합 기관 사업명 끝의 옛 시·도 표시만 떼고 대조한다", () => {
  assert.equal(squashName("보훈단체 운영활성화 (전남)"), squashName("보훈단체 운영활성화"));
  assert.equal(squashName("돌봄 지원（광주）"), squashName("돌봄 지원"));
  assert.notEqual(squashName("전남 청년 지원"), squashName("청년 지원"), "이름 안의 지역명은 그대로 둔다");
  assert.notEqual(squashName("지원사업 (서울)"), squashName("지원사업"), "다른 괄호 표시는 떼지 않는다");
});

test("동명 사업은 검증된 부서와 사업코드가 일치하는 공개 행만 대조한다", async () => {
  // Given: 같은 사업명, 서로 다른 구청·사업코드·금액.
  const db = await matchingDatabase();
  const revision = await publishMatchingBook(db);
  // When
  const outline = await revisionOutline(db, revision);
  // Then
  const project = outline.lines.find((line) => line.level === "detail_project");
  assert.equal(project.api_comparison.api?.department_code, "3005040");
  assert.equal(project.api_comparison.api?.fiscal_project_id, "fp:2026:4129000:100:3005040:4050000200730487");
  assert.equal(project.api_comparison.api?.current_budget_krw, "1000000");
  assert.equal(project.api_comparison.relation, "same_within_display_rounding");
  assert.equal(project.amount_krw, "1000000");
});

test("지출자료에서 예산서로 연결할 때 다른 구청의 동명 예산서를 붙이지 않는다", async () => {
  // Given
  const db = await matchingDatabase();
  const revision = await publishMatchingBook(db);
  const projects = (await db.prepare("SELECT * FROM fiscal_project ORDER BY department_code").all()).results;
  // When
  const links = await documentLinksForProjects(db, projects);
  // Then
  assert.deepEqual((links.get(projects[0].fiscal_project_id) ?? []).map((link) => link.document_revision_id), [revision]);
  assert.deepEqual(links.get(projects[1].fiscal_project_id) ?? [], []);
});

for (const [name, annotations] of [
  ["다른 구청 코드", [`부서코드 ${DEPARTMENTS[1]} · 세부사업코드 ${PROJECT_CODES[1]}`]],
  ["없는 사업코드", [`부서코드 ${DEPARTMENTS[0]} · 세부사업코드 4050000200739999`]],
  ["상충하는 코드 주석", [`부서코드 ${DEPARTMENTS[0]} · 세부사업코드 ${PROJECT_CODES[0]}`, `부서코드 ${DEPARTMENTS[1]} · 세부사업코드 ${PROJECT_CODES[1]}`]],
]) {
  test(`코드 근거가 ${name}일 때 이름만으로 대신 연결하지 않는다`, async () => {
    // Given
    const db = await matchingDatabase({ projectCount: 1 });
    const revision = await publishMatchingBook(db, { annotations });
    // When
    const outline = await revisionOutline(db, revision);
    // Then
    assert.equal(outline.lines.find((line) => line.level === "detail_project").api_comparison.api, null);
  });
  test(`코드 근거가 ${name}일 때 역방향 예산서 링크도 붙이지 않는다`, async () => {
    // Given
    const db = await matchingDatabase({ projectCount: 1 });
    await publishMatchingBook(db, { annotations });
    const projects = (await db.prepare("SELECT * FROM fiscal_project").all()).results;
    // When
    const links = await documentLinksForProjects(db, projects);
    // Then
    assert.equal(links.size, 0);
  });
}

test("코드 주석이 없는 기존 예산서도 검증된 부서가 다른 동명 사업은 연결하지 않는다", async () => {
  // Given
  const db = await matchingDatabase();
  await publishMatchingBook(db, { annotations: [] });
  const projects = (await db.prepare("SELECT * FROM fiscal_project ORDER BY department_code").all()).results;
  // When
  const links = await documentLinksForProjects(db, projects);
  // Then
  assert.equal(links.get(projects[0].fiscal_project_id)?.length, 1);
  assert.deepEqual(links.get(projects[1].fiscal_project_id) ?? [], []);
});

test("같은 부서의 동명 사업도 사업코드가 다르면 정확한 코드 하나만 대조한다", async () => {
  // Given
  const db = await matchingDatabase({ departmentCodes: ["3005040", "3005040"] });
  const revision = await publishMatchingBook(db);
  // When
  const outline = await revisionOutline(db, revision);
  // Then
  const compared = outline.lines.find((line) => line.level === "detail_project").api_comparison;
  assert.equal(compared.api?.source_project_code, "4050000200730487");
  assert.equal(compared.api?.current_budget_krw, "1000000");
});

test("사업코드 없는 기존 문서의 같은 부서 내 동명 사업은 모호함을 유지한다", async () => {
  // Given
  const db = await matchingDatabase({ departmentCodes: ["3005040", "3005040"] });
  const revision = await publishMatchingBook(db, { annotations: [] });
  // When
  const outline = await revisionOutline(db, revision);
  // Then
  const compared = outline.lines.find((line) => line.level === "detail_project").api_comparison;
  assert.equal(compared.api, null);
  assert.equal(compared.relation, "ambiguous_name_in_api");
  assert.equal(compared.api_candidates.length, 2);
});
