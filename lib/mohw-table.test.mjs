import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseSynapPreviewLocation,
  parseSynapTablePage,
  synapPageCount,
} from "./mohw-table.ts";

const fixtureUrl = (name) => new URL(`./fixtures/mohw/${name}`, import.meta.url);
const collapse = (value) => value.replace(/\s+/g, "");

function context(documentId, pageNumber = 1) {
  return {
    documentId,
    sido: "테스트도",
    sigungu: "테스트군",
    detailUrl: "https://www.mohw.go.kr/test",
    updatedDate: "2026-06",
    pageNumber,
  };
}

test("Given a Synap preview redirect When parsed Then page XML URLs stay on MOHW", () => {
  const location = parseSynapPreviewLocation(
    "https://www.mohw.go.kr/synap/doc.html?fn=202607242012226881.pdf&rs=/upload/result/202609/",
  );

  assert.equal(location.indexUrl, "https://www.mohw.go.kr/upload/result/202609/202607242012226881.pdf.xml");
  assert.equal(
    location.pageUrl(3),
    "https://www.mohw.go.kr/upload/result/202609/202607242012226881.pdf.files/202607242012226881.pdf_3.xml",
  );
  assert.equal(synapPageCount("<index><pdf_cnt>8</pdf_cnt></index>"), 8);
});

test("Given the official Jungnang page When parsed Then table cells become service fields", async () => {
  const xml = await readFile(fixtureUrl("jungnang-page1.xml"), "utf8");
  const rows = parseSynapTablePage(xml, context("0084:1489600:1"));

  assert.ok(rows.length >= 10);
  assert.equal(collapse(rows[0].name), "장기요양재택의료센터시범사업");
  assert.equal(collapse(rows[0].target), "장기요양수급자");
  assert.equal(collapse(rows[0].provider), "건강보험공단");
  assert.equal(rows[0].type, "전국");
});

test("Given the official Jeju page When parsed Then split serial numbers anchor rows", async () => {
  const xml = await readFile(fixtureUrl("jeju-page1.xml"), "utf8");
  const rows = parseSynapTablePage(xml, context("0084:1489830:1"));

  assert.ok(rows.length >= 5);
  assert.equal(collapse(rows[0].name), "장기요양재택의료센터");
  assert.equal(rows[0].serial, "1-1-1");
  assert.match(collapse(rows[0].description), /다학제팀이수급자가정을방문/);
});

test("Given an official table without a serial column When parsed Then the first column anchors rows", async () => {
  const xml = await readFile(fixtureUrl("yesan-page1.xml"), "utf8");
  const rows = parseSynapTablePage(xml, context("0084:1489300:1"));

  assert.ok(rows.length >= 12);
  assert.match(collapse(rows[0].name), /^방문의료지원사업\(장기요양재택의료센터\)/);
  assert.equal(collapse(rows[0].category), "보건의료");
  assert.match(collapse(rows[0].provider), /예산경희한의원/);
});
