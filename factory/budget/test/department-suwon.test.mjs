import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { officialAttachments, verifiedAccountChapter, documentRows } from "../department-corpus.mjs";
import { budgetDepartmentFilterLabel, budgetDepartmentLabel } from "../../../components/budget/budget-departments.ts";

const profile = JSON.parse(readFileSync(new URL("../configs/department-bulk-suwon-2026.json", import.meta.url))).entities[0];
const row = (title = profile.attachment_label, year = "2026", url = profile.attachment_url) => `<tr><td>${year}</td><td>일반 · 특별회계</td><td class="p-subject">${title}</td><td><a href="${url}">PDF보기</a></td></tr>`;
test("Suwon index selects the adopted budget and rejects supplementary, gender, wrong-year, duplicate and changed attachments", () => {
  const fixture = row("2026년도 제1회 일반 및 특별회계 세입·세출 추가경정 예산서") + row("2026년도 성인지예산서") + row();
  assert.equal(officialAttachments(fixture, profile)[0].account_basis, "verified_pdf_account_chapter");
  for (const changed of [row(profile.attachment_label, "2025"), row("2026년도 제1회 일반 및 특별회계 세입·세출 추가경정 예산서"), row() + row(), row(profile.attachment_label, "2026", "https://other.go.kr/file.pdf")]) assert.throws(() => officialAttachments(changed, profile));
});
const document = { ...officialAttachments(row(), profile)[0], sha256: profile.pdf_account_scope.raw_sha256, toc_names: ["복지정책과"] };
const boundary = [
  { page: 1, parsed_text_verbatim: "2026년도 예산서 2025. 12. 19. 제397회 수원시의회 본회의 의결" },
  { page: 49, parsed_text_verbatim: "4. 일 반 회 계" },
  { page: 1108, parsed_text_verbatim: "5. 기 타 특 별 회 계" }
];
test("mixed-account PDF boundaries and cover evidence are pinned and fail closed", () => {
  assert.deepEqual(verifiedAccountChapter(document, { blocks: boundary }, profile, "2026"), { first: 49, last: 1107 });
  assert.throws(() => verifiedAccountChapter({ ...document, sha256: "a".repeat(64) }, { blocks: boundary }, profile, "2026"));
  for (let i = 0; i < boundary.length; i++) assert.throws(() => verifiedAccountChapter(document, { blocks: boundary.filter((_, at) => at !== i) }, profile, "2026"));
  assert.throws(() => verifiedAccountChapter(document, { blocks: boundary }, profile, "2025"));
});
test("special-account rows cannot contaminate the general-account match corpus", () => {
  const statement = "부서: 복지정책과 정책: 복지 단위: 지원 (단위:천원)";
  const tables = [200, 1142].map(page => ({ table_id: "t" + page, logical_columns: 4, cells: [{ anchor_row: 0, anchor_col: 0, parsed_text_verbatim: "부서 정책 세부사업" }, { anchor_row: 1, anchor_col: 0, parsed_text_verbatim: "사업" }, { anchor_row: 1, anchor_col: 1, parsed_text_verbatim: "1,000" }] }));
  const blocks = [...boundary, ...[200, 1142].map(page => ({ page, parsed_text_verbatim: statement, table_id: "t" + page }))];
  const result = documentRows(document, { blocks, tables }, profile, "2026");
  assert.deepEqual(result.rows.map(r => r.page), [200]);
  assert.equal(result.rows[0].department_name, "복지정책과");
});

test("Suwon labels retain district identity and require the exact entity/year/observation", () => {
  const observation = { fiscal_entity: { name: profile.fiscal_entity_name }, fiscal_year: "2026", reference_date: "2026-10-02" };
  for (const [code, name] of [["1025020", "복지정책과"], ["1025055", "돌봄정책과"], ["4005040", "권선구사회복지과"], ["6005040", "영통구사회복지과"]]) {
    assert.equal(budgetDepartmentFilterLabel(profile.fiscal_entity_name, code, [observation]), `${name} (${code})`);
    for (const args of [["경기성남시", code, "2026", "2026-10-02"], [profile.fiscal_entity_name, code, "2025", "2026-10-02"], [profile.fiscal_entity_name, code, "2026", "2026-10-04"]]) {
      if (args[0] === "경기성남시") assert.notEqual(budgetDepartmentLabel(...args), `${name} (${code})`, "same code in another city must not inherit Suwon's mapping");
      else assert.match(budgetDepartmentLabel(...args), /명칭 미확인/u);
    }
    assert.match(budgetDepartmentFilterLabel(profile.fiscal_entity_name, code, [observation, { ...observation, reference_date: "2026-10-04" }]), /명칭 미확인/u);
  }
});
