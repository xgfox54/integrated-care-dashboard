import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";

import { EMPTY_FILTERS } from "./dataset.ts";
import { toXlsx, xlsxFileName } from "./dataset-xlsx.ts";
import { dashboardXlsxUrl } from "./dashboard-url.ts";

const row = {
  sido: "강원특별자치도", sigungu: "강릉시", category: "일상생활돌봄", subcategory: "안부확인",
  name: "=1+1", description: "방문 & 상담\n둘째 줄 <지원>", target: "00123", detailTarget: "",
  provider: "복지기관", type: "지역특화",
};

const unescape = (value) => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");
async function readSheet(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const workbook = await zip.file("xl/workbook.xml").async("string");
  const sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
  const rows = [...sheet.matchAll(/<row r="\d+">([\s\S]*?)<\/row>/g)].map((match) => [...match[1].matchAll(/<c r="[A-Z]+\d+" t="inlineStr"><is><t xml:space="preserve">([\s\S]*?)<\/t><\/is><\/c>/g)].map((cell) => unescape(cell[1])));
  return { zip, workbook, sheet, rows };
}

test("XLSX contains the ordered export columns and preserves text cells", async () => {
  const { zip, workbook, sheet, rows } = await readSheet(await toXlsx([row, { ...row, name: "두 번째 사업" }]));
  for (const part of ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml"]) assert.ok(zip.file(part), part);
  assert.match(workbook, /<sheet name="검색결과" sheetId="1" r:id="rId1"\/>/);
  assert.deepEqual(rows, [
    ["시도", "시군구", "대분류", "중분류", "사업명", "사업내용", "지원대상", "세부대상자", "제공기관", "사업구분"],
    Object.values(row),
    Object.values({ ...row, name: "두 번째 사업" }),
  ]);
  assert.doesNotMatch(sheet, /<f>/, "수식 칸을 만들지 않는다");
  assert.match(sheet, /<autoFilter ref="A1:J3"\/>/);
  assert.equal((sheet.match(/<col /g) ?? []).length, 10);
});

test("empty XLSX remains a valid workbook with column headers", async () => {
  const { rows } = await readSheet(await toXlsx([]));
  assert.equal(rows.length, 1);
});

test("XLSX drops control characters that XML cannot store", async () => {
  const { rows } = await readSheet(await toXlsx([{ ...row, description: "앞\u0001뒤" }]));
  assert.equal(rows[1][5], "앞뒤");
});

test("XLSX URL retains every search filter and sort without a page limit", () => {
  const filters = { ...EMPTY_FILTERS, sido: "강원특별자치도", sigungu: "강릉시", category: "일상생활돌봄", subcategory: "안부확인", type: "지역특화", keyword: "돌봄", sort: "name", targetGroup: "elderly" };
  const url = new URL(dashboardXlsxUrl(filters), "https://example.test");
  assert.equal(url.pathname, "/api/dataset/export/xlsx");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    sido: filters.sido, sigungu: filters.sigungu, category: filters.category, subcategory: filters.subcategory,
    type: filters.type, q: filters.keyword, sort: filters.sort, target_group: filters.targetGroup,
  });
  assert.equal(xlsxFileName(filters, new Date(2026, 9, 15)), "전국통합돌봄_사업현황_강릉시_20261015.xlsx");
});
