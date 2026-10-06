import test from "node:test";
import assert from "node:assert/strict";
import { officialAttachments, organisationDepartments } from "../department-corpus.mjs";

const config = { adapter: "official-single-general-pdf", index_url: "https://city.go.kr/budget", index_required_text: ["2026년", "본예산"], account_row_label: "일반회계세출", attachment_label: "일반회계 세출 사업명세서", attachment_url: "https://city.go.kr/2026/general.pdf", expected_documents: 1, account_code: "100", department_toc: { url: "https://city.go.kr/2026/organisation.pdf", label: "조직별세출총괄표" } };
const html = '2026년 본예산 <table><tr><th>일반회계세출</th><td><a href="/2026/general.pdf">일반회계 세출 사업명세서</a></td></tr><tr><th>기타특별회계세출</th><td><a href="/2026/special.pdf">기타특별회계 세출 사업명세서</a></td></tr></table><a href="/2026/organisation.pdf">조직별세출총괄표</a>';

test("labeled attachment inventory requires exact account section, complete list and names", () => {
  const profile = { adapter: "official-labeled-li-index", index_url: "https://city.go.kr/budget", index_required_text: ["2026년 본예산"], account_section_label: "일반회계", document_section_label: "부서별 세출예산사업명세서", account_end_label: "특별회계", account_code: "100", expected_documents: 2, attachments: [{ url: "https://city.go.kr/download?fileSid=1", label: "주민복지과", toc_names: ["주민복지과"] }, { url: "https://city.go.kr/download?fileSid=2", label: "읍면", toc_names: [] }] };
  const fixture = '2026년 본예산 <h4>일반회계</h4><h5>부서별 세출예산사업명세서</h5><ul><li><span>주민복지과</span><a href="/download?fileSid=1">다운로드</a></li><li><span>읍면</span><a href="/download?fileSid=2">다운로드</a></li></ul><h4>특별회계</h4>';
  const documents = officialAttachments(fixture, profile);
  assert.equal(documents.length, 2);
  assert.deepEqual(documents[0].toc_names, ["주민복지과"]);
  assert.deepEqual(documents[1].toc_names, []);
  for (const changed of [fixture.replace("일반회계", "다른회계"), fixture.replace("주민복지과", "여성가족과"), fixture.replace("fileSid=2", "fileSid=3"), fixture.replace("/download?fileSid=1", "https://other.go.kr/download?fileSid=1"), fixture.replace('<li><span>읍면</span><a href="/download?fileSid=2">다운로드</a></li>', ""), fixture.replace("<h5>", "<h4>특별회계</h4><h5>")]) assert.throws(() => officialAttachments(changed, profile));
});

test("whole general-account PDF inventory requires its official row, exact URL and independent organisation summary", () => {
  assert.equal(officialAttachments(html, config)[0].url, config.attachment_url);
  for (const changed of [html.replace("2026년", "2025년"), html.replace("일반회계세출", "특별회계세출"), html.replace("/2026/general.pdf", "https://other.go.kr/general.pdf"), html.replace("/2026/organisation.pdf", "/2025/organisation.pdf"), html.replace("</table>", '<tr><th>일반회계세출</th><td><a href="/2026/general.pdf">일반회계 세출 사업명세서</a></td></tr></table>')]) assert.throws(() => officialAttachments(changed, config));
  assert.throws(() => officialAttachments("<!--" + html + "-->", config), /SCOPE/);
});

test("organisation summary verifies year, adopted stage, unit and table before accepting names", () => {
  const parsed = { blocks: [{ parsed_text_verbatim: "2026년도 본예산 일반회계,기타특별회계 전체 【 조직별 】 (단위:천원)" }], tables: [{ table_id: "t", cells: [{ anchor_row: 0, anchor_col: 2, parsed_text_verbatim: "예산액" }, { anchor_row: 2, anchor_col: 1, parsed_text_verbatim: "복지정책과" }, { anchor_row: 3, anchor_col: 1, parsed_text_verbatim: "사회복지과" }, { anchor_row: 4, anchor_col: 1, parsed_text_verbatim: "사회복지과" }] }] };
  assert.deepEqual(organisationDepartments(parsed, "2026").names, ["복지정책과", "사회복지과"]);
  assert.equal(organisationDepartments(parsed, "2026").locations.사회복지과.row, 3);
  for (const text of ["2025년도 본예산 조직별 (단위:천원)", "2026년도 예산안 조직별 (단위:천원)", "2026년도 본예산 조직별 (단위:백만원)"]) assert.throws(() => organisationDepartments({ ...parsed, blocks: [{ parsed_text_verbatim: text }] }, "2026"), /SCOPE/);
  assert.throws(() => organisationDepartments({ ...parsed, tables: [] }, "2026"), /EMPTY/);
});
