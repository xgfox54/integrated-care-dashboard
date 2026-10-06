import assert from "node:assert/strict";
import test from "node:test";
import { collectMohwDocumentServices } from "./mohw-preview.ts";

test("MOHW collection normalizes an explicit Gyeonggi type and leaves blank types unclassified", async (t) => {
  const types = ["경 기 도", "", "전국", "광역", "지역특화", "별도유형"];
  const cell = (value, column, y) => `<text l='${20 + column * 100}' t='${y}' w='60' h='12'>${value}</text>`;
  const headers = ["대분류", "중분류", "연번", "사업명", "사업내용", "지원대상", "제공기관", "유형"];
  const xml = `<document><page w="900" h="600">${headers.map((v, i) => cell(v, i, 20)).join("")}${types.map((type, i) =>
    ["요양", "방문요양", String(i + 1), `사업${i + 1}`, "지원 내용", "노인", "제공기관", type]
      .map((v, col) => cell(v, col, 80 + i * 70)).join("")
  ).join("")}</page></document>`;
  const preview = "https://www.mohw.go.kr/synap/doc.html?fn=test.pdf&rs=/upload/result/202610/";
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("attachPreview.es")) return { ok: true, url: preview, text: async () => "" };
    if (String(url).endsWith("test.pdf.xml")) return new Response("<index><pdf_cnt>1</pdf_cnt></index>");
    assert.ok(String(url).endsWith("test.pdf_1.xml"));
    return new Response(xml);
  });
  const rows = await collectMohwDocumentServices({
    documentId: "0085:1489618:1", province: "경기도", municipality: "가평군",
    title: "원문 사업구분", publishedAt: "2026-03-20", dataAsOf: "2026-04",
    detailUrl: "https://www.mohw.go.kr/board.es?list_no=1489618", downloadUrl: "", fileName: "test.pdf",
  });
  assert.deepEqual(rows.map((row) => row.type), ["광역", "미분류", "전국", "광역", "지역특화", "별도유형"]);
  assert.equal(rows.length, types.length);
});
