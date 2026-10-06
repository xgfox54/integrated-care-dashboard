import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { officialAttachments, organisationDepartments } from "../department-corpus.mjs";

const profile = JSON.parse(readFileSync(new URL("../configs/department-bulk-imsil-org-2026.json", import.meta.url))).entities[0];
const li = (label, url) => '<li><span>' + label + '</span><a href="' + url + '">다운로드</a></li>';
const html = '2026년 본예산 ' + li(profile.department_toc.label, profile.department_toc.url) +
  '<h4>일반회계</h4><h5>부서별 세출예산사업명세서</h5><ul>' +
  profile.attachments.map(a => li(a.label, a.url)).join('') + '</ul><h4>특별회계</h4>';

test("임실 독립 조직표는 공식 목록의 정확한 label/url 단일 일치만 허용한다", () => {
  assert.equal(officialAttachments(html, profile).length, 27);
  for (const changed of [
    html.replace(profile.department_toc.label, "조직별 세출총괄표(특별)"),
    html.replace("fileSid=94783", "fileSid=94784"),
    html + li(profile.department_toc.label, profile.department_toc.url),
  ]) assert.throws(() => officialAttachments(changed, profile), /OFFICIAL_DEPARTMENT_TOC_MISSING/);
  assert.throws(() => officialAttachments(html, { ...profile, department_toc: { ...profile.department_toc, url: "https://other.go.kr/94783.pdf" } }), /OFFICIAL_DEPARTMENT_TOC_MISSING/);
});

test("임실 일반회계 조직표는 실·읍면을 읽고 특별회계 혼합·다른 연도를 거부한다", () => {
  const parsed = { blocks: [{ parsed_text_verbatim: "2026년도 본예산 일반회계 전체 조직별 (단위:천원)" }], tables: [{ table_id: "toc", cells: [
    { anchor_row: 0, anchor_col: 2, parsed_text_verbatim: "예산액" },
    ...["기획감사실", "행정지원실", "임실읍", "청웅면", "총계"].map((name, i) => ({ anchor_row: i + 2, anchor_col: 1, parsed_text_verbatim: name })),
  ] }] };
  assert.deepEqual(organisationDepartments(parsed, "2026", "일반회계").names, ["기획감사실", "행정지원실", "임실읍", "청웅면"]);
  for (const text of ["2026년도 본예산 특별회계 조직별 (단위:천원)", "2026년도 본예산 일반회계,기타특별회계 조직별 (단위:천원)", "2025년도 본예산 일반회계 조직별 (단위:천원)"]) {
    assert.throws(() => organisationDepartments({ ...parsed, blocks: [{ parsed_text_verbatim: text }] }, "2026", "일반회계"), /MISMATCH/);
  }
});
