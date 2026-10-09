import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { officialAttachments, organisationDepartments, verifiedAccountChapter, matchCorpus } from "../department-corpus.mjs";
import { explicitPageDepartment } from "../match-departments.mjs";
import { budgetDepartmentLabel } from "../../../components/budget/budget-departments.ts";

const profile = JSON.parse(readFileSync(new URL("../configs/department-bulk-hwaseong-2026.json", import.meta.url))).entities[0];
const row = (year, mseq, stage, general = true) => (year ? `<tr><td rowspan="4">${year}년</td>` : "<tr>") + `<td><a href="javascript:YeOpenView('${mseq}');">${stage}</a></td><td><a href="javascript:OpenDown('${mseq}','1-1');">다운로드</a></td><td>${general ? `<a href="javascript:OpenDown('${mseq}','2-1');">다운로드</a>` : ""}</td></tr>`;
const head = "<caption>예산서공개</caption><thead><tr><th>연도</th><th>예산구분</th><th>예산규모</th><th>일반회계</th><th>기타특별회계</th><th>공기업특별회계</th></tr></thead>";
const form = '<form name="OpenDown" action="YeDown.jsp" method="post"><input type="hidden" name="money_search_csrf" value="ab"><input name="mseq"/></form>';
const fixture = head + row("2026", "15426", "본예산") + row(null, "15431", "1회추경") + row("2025", "15231", "본예산") + form;

test("Hwaseong selects only the 2026 adopted general-account download", () => {
  const docs = officialAttachments(fixture, profile);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].account_basis, "verified_pdf_account_chapter");
  for (const changed of [
    fixture.replace("15426", "15999"),
    fixture.replace(row("2026", "15426", "본예산"), row("2026", "15426", "본예산", false)),
    fixture.replace("2026년", "2027년"),
    fixture.replace('method="post"', 'method="get"'),
    fixture.replace("<th>일반회계</th>", "<th>기타</th>"),
  ]) assert.throws(() => officialAttachments(changed, profile));
});

test("department header glued to the policy line is read; names containing 정책 are kept", () => {
  assert.equal(explicitPageDepartment([{ parsed_text_verbatim: "실국: 기획조정실\t부서 : 스마트도시과정책: IT기반" }]), "스마트도시과");
  assert.equal(explicitPageDepartment([{ parsed_text_verbatim: "부서 : 주택정책과" }]), "주택정책과");
  assert.equal(explicitPageDepartment([{ parsed_text_verbatim: "부서: 청년청소년정책과 정책: 청소년" }]), "청년청소년정책과");
});

test("organisation summary drops 읍면동 and the council but keeps bureau-level health-centre divisions", () => {
  const units = [["화성시동탄보건소", ""], ["", "동탄보건행정과"], ["", "동탄건강증진과"], ["읍면동", ""], ["", "봉담읍"], ["", "매송면"], ["", "동탄9동"], ["의회사무국", ""], ["", "의정담당관"], ["", "언론담당관"]];
  const cells = [{ anchor_row: 0, anchor_col: 2, parsed_text_verbatim: "예산액" }];
  units.forEach(([a, b], i) => cells.push({ anchor_row: i + 2, anchor_col: 0, parsed_text_verbatim: a }, { anchor_row: i + 2, anchor_col: 1, parsed_text_verbatim: b }));
  const parsed = { blocks: [{ parsed_text_verbatim: "세출예산사업명세서 2026년도 본예산 일반회계 (단위:천원)" }], tables: [{ table_id: "t", cells }] };
  assert.deepEqual(organisationDepartments(parsed, "2026", "일반회계", profile.department_toc).names, ["동탄보건행정과", "동탄건강증진과", "언론담당관"]);
});

test("image-only cover and divider are accepted only from the pinned visual reading", () => {
  const scope = profile.pdf_account_scope, doc = { sha256: scope.raw_sha256 };
  const blocks = [{ page: 1, parsed_text_verbatim: "" }, { page: 383, parsed_text_verbatim: "세출예산사업명세서 2026년도 본예산 전체 일반회계" }, { page: 1469, parsed_text_verbatim: "-1467-" }, { page: 1471, parsed_text_verbatim: "공공폐수처리시설특별회계" }];
  assert.deepEqual(verifiedAccountChapter(doc, { blocks }, profile, "2026"), { first: 383, last: 1468 });
  assert.throws(() => verifiedAccountChapter(doc, { blocks: blocks.filter((b) => b.page !== 1471) }, profile, "2026"));
  assert.throws(() => verifiedAccountChapter(doc, { blocks: blocks.map((b) => b.page === 1469 ? { ...b, parsed_text_verbatim: "세출예산사업명세서 일반회계" } : b) }, profile, "2026"));
  assert.throws(() => verifiedAccountChapter({ sha256: "a".repeat(64) }, { blocks }, profile, "2026"));
});

test("the adopted book cannot name later district codes, but current ehojo evidence can", () => {
  const item = (id, code, name, amount) => ({ fiscal_project_id: id, fiscal_year: "2026", reference_date: "2026-10-02", fiscal_entity: { name: "경기화성시" }, department_code: code, account: { code: "100" }, name, current_budget_krw: amount });
  const doc = (name, amount) => ({ fiscal_year: "2026", fiscal_entity_name: "경기화성시", account_code: "100", name, amount_krw: amount, department_name: "영유아보육과", department_basis: "explicit_same_page_header_and_official_index" });
  const result = matchCorpus([item("a", "2006001", "가", "1000"), item("b", "2006001", "나", "2000")], [doc("가", "1000"), doc("나", "2000")], profile);
  assert.equal(result.mappings.length, 0);
  assert.equal(result.held[0].reason, "code_created_after_adopted_book");
  assert.equal(budgetDepartmentLabel("경기화성시", "1002004"), "영유아보육과 (1002004)");
  assert.equal(budgetDepartmentLabel("경기화성시", "2127001"), "동탄구보건행정과 (2127001)");
  assert.equal(budgetDepartmentLabel("경기화성시", "2006001"), "동탄구가정보육과 (2006001)");
});

