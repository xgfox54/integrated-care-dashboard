import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { officialAttachments, organisationDepartments, pageUnitVerified } from "../department-corpus.mjs";
import { departmentTocRange } from "../bulk-departments.mjs";
import { budgetDepartmentLabel } from "../../../components/budget/budget-departments.ts";

const profile = JSON.parse(readFileSync(new URL("../configs/department-bulk-bucheon-2026.json", import.meta.url))).entities[0];
const link = (label, file) => `<li>${label} <span class="btns"><a class="btn_s btn_co02" href="/docs/budget/depth1_1/2026/depth/${file}" target="_blank" title="파일 다운로드"><i class="down02">다운로드</i></a></span></li>`;
const fixture = [
  '<nav class="tab_ty tab_box"><ul class="tab_list"><li class="on"><a href="/site/homepage/menu/viewMenu?menuid=168002001020001"><span>2026</span></a></li><li><a href="/site/homepage/menu/viewMenu?menuid=168002001019001"><span>2025</span></a></li></ul></nav>',
  '<nav class="tab_ty02"><ul class="tab_list"><li class="on"><a href="/site/homepage/menu/viewMenu?menuid=168002001020001">본예산</a></li><li><a href="/site/homepage/menu/viewMenu?menuid=168002001020002">1회추경예산</a></li></ul></nav>',
  '<h4 class="t_tit">0. 본예산(안)</h4><a href="/docs/budget/depth1_1/2026/depth/budget_open.pdf">전체파일 다운로드</a>',
  '<h4 class="t_tit">Ⅲ. 세입세출 예산</h4><ul class="link_list01">',
  link("3. 세입세출총괄표(일반회계, 기타특별회계)", "3_3.pdf"),
  link("5. 세입예산사업명세서(일반회계)", "3_5.pdf"),
  link("6. 세출예산사업명세서(일반회계)", "3_6.pdf"),
  '</ul><h4 class="t_tit">Ⅳ. 기타특별회계 예산서</h4>',
  link("1. 기타특별회계 예산서 세출", "4_1.pdf"),
].join("");

test("Bucheon accepts only the adopted 2026 general expenditure statement and its organisation summary", () => {
  const docs = officialAttachments(fixture, profile);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].url, profile.attachment_url);
  assert.equal(docs[0].account_code, "100");
  assert.equal(docs[0].account_basis, "official_index_general_account_section");
  for (const changed of [
    fixture.replace('<li class="on"><a href="/site/homepage/menu/viewMenu?menuid=168002001020001"><span>2026', '<li class="on"><a href="/site/homepage/menu/viewMenu?menuid=168002001020001"><span>2025'),
    fixture.replace('<li class="on"><a href="/site/homepage/menu/viewMenu?menuid=168002001020001">본예산</a></li><li>', '<li><a href="/site/homepage/menu/viewMenu?menuid=168002001020001">본예산</a></li><li class="on">'),
    fixture.replace("Ⅲ. 세입세출 예산", "Ⅲ. 세입세출 예산(안)"),
    fixture.replace("3_6.pdf", "4_1.pdf"),
    fixture.replace(link("6. 세출예산사업명세서(일반회계)", "3_6.pdf"), ""),
    fixture.replace(link("6. 세출예산사업명세서(일반회계)", "3_6.pdf"), link("6. 세출예산사업명세서(일반회계)", "3_6.pdf").repeat(2)),
    fixture.replace(link("3. 세입세출총괄표(일반회계, 기타특별회계)", "3_3.pdf"), ""),
    fixture.replaceAll("/depth1_1/2026/", "/depth1_1/2025/"),
  ]) assert.throws(() => officialAttachments(changed, profile));
  assert.throws(() => officialAttachments(fixture, { ...profile, attachment_url: "https://other.go.kr/3_6.pdf" }));
  assert.throws(() => officialAttachments(fixture, { ...profile, fiscal_year: "2025" }));
});

test("Bucheon organisation range covers only the general-account organisation pages", () => {
  assert.deepEqual(departmentTocRange(profile.department_toc), { first: 21, last: 25 });
});

test("bureau-level health centres keep their divisions; single-unit health centres, libraries and the council stay out", () => {
  const rows = [["", "공원관리과"], ["", "상동도서관"], ["직속기관", ""], ["부천시보건소", ""], ["", "건강정책과"], ["", "건강증진과"], ["", "감염병관리과"], ["", "소사보건소"], ["", "오정보건소"], ["의회사무국", ""], ["", "의회사무국"], ["", "원미구사회복지과"]];
  const cells = [{ anchor_row: 0, anchor_col: 2, parsed_text_verbatim: "예산액" }];
  rows.forEach(([bureau, unit], i) => { cells.push({ anchor_row: i + 2, anchor_col: 0, parsed_text_verbatim: bureau }, { anchor_row: i + 2, anchor_col: 1, parsed_text_verbatim: unit }); });
  const parsed = { blocks: [{ parsed_text_verbatim: "2026년도 본예산 일반회계 【조직별】 (단위:천원)" }], tables: [{ table_id: "t", cells }] };
  assert.deepEqual(organisationDepartments(parsed, "2026", "일반회계").names, ["공원관리과", "건강정책과", "건강증진과", "감염병관리과", "원미구사회복지과"]);
});

test("Bucheon labels include health-centre divisions and stay with Bucheon", () => {
  const name = profile.fiscal_entity_name;
  for (const [code, label] of [["1041002", "복지정책과"], ["1031001", "돌봄지원과"], ["2110010", "건강정책과"], ["1106001", "건강증진과"], ["2009028", "원미구사회복지과"], ["1049001", "청년청소년과"]]) {
    assert.equal(budgetDepartmentLabel(name, code), `${label} (${code})`);
    assert.notEqual(budgetDepartmentLabel("경기수원시", code), `${label} (${code})`);
  }
  for (const held of ["2009007", "2011006", "1005035", "1042003"]) assert.match(budgetDepartmentLabel(name, held), /명칭 미확인/u);
});

test("a missing unit label is accepted only for the visually confirmed page, file and department", () => {
  const document = { id: "general-account", sha256: profile.unit_visual_confirmations[0].raw_sha256 };
  const header = "부서:청년청소년과정책:청소년역량강화";
  assert.equal(pageUnitVerified(profile, document, 324, header, "청년청소년과"), true);
  assert.equal(pageUnitVerified(profile, document, 325, header, "청년청소년과"), false);
  assert.equal(pageUnitVerified(profile, { ...document, sha256: "a".repeat(64) }, 324, header, "청년청소년과"), false);
  assert.equal(pageUnitVerified(profile, document, 324, "부서:회계과", "회계과"), false);
  assert.equal(pageUnitVerified(profile, document, 324, "부서:회계과", "청년청소년과"), false);
  assert.equal(pageUnitVerified({ ...profile, unit_visual_confirmations: undefined }, document, 324, header, "청년청소년과"), false);
  assert.equal(pageUnitVerified(profile, document, 999, header + "(단위:천원)", "청년청소년과"), true);
});
