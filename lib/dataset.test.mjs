import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_FILTERS,
  expandCompactRows,
  filterRows,
  normalizeRows,
  serviceWikiHref,
  serviceWikiKey,
} from "./dataset.ts";

test("service categories keep the requested dashboard filter order", async () => {
  // Given
  const datasetModule = await import("./dataset.ts");

  // Then
  assert.deepEqual(datasetModule.SERVICE_CATEGORY_ORDER, [
    "건강관리예방",
    "일상생활돌봄",
    "보건의료",
    "주거복지",
    "장애지원",
    "요양",
    "기타",
  ]);
});

test("dictionary snapshot rows expand without changing service fields", () => {
  const rows = expandCompactRows({
    columns: ["serviceId", "sido", "name"],
    dictionaries: [
      ["0083:1489622:1:2:6"],
      ["강원특별자치도"],
      ["1촌돌봄단", "강릉愛밥상"],
    ],
    rows: [
      [0, 0, 0],
      [0, 0, 1],
    ],
  });

  assert.deepEqual(rows, [
    { serviceId: "0083:1489622:1:2:6", sido: "강원특별자치도", name: "1촌돌봄단" },
    { serviceId: "0083:1489622:1:2:6", sido: "강원특별자치도", name: "강릉愛밥상" },
  ]);
});

test("legacy Gwangju and Jeonnam rows filter through the current integrated region", () => {
  const rows = normalizeRows([
    { sido: "전남광주통합특별시", name: "현행 명칭 사업" },
    { sido: "광주광역시", name: "옛 광주 명칭 사업" },
    { sido: "전라남도", name: "옛 전남 명칭 사업" },
    { sido: "서울특별시", name: "다른 지역 사업" },
  ]);

  assert.deepEqual(
    rows.map((row) => row.sido),
    ["전남광주통합특별시", "전남광주통합특별시", "전남광주통합특별시", "서울특별시"],
  );

  const selected = filterRows(rows, {
    ...EMPTY_FILTERS,
    sido: "전남광주통합특별시",
  });
  assert.deepEqual(
    selected.map((row) => row.name),
    ["현행 명칭 사업", "옛 광주 명칭 사업", "옛 전남 명칭 사업"],
  );
});

test("service wiki links use stable official business identity", () => {
  const row = {
    serviceId: "0085:1489600:1:2:30",
    sido: "경기도",
    sigungu: "김포시",
    category: "일상생활돌봄",
    subcategory: "식사지원",
    name: "식사배달사업",
  };
  assert.equal(
    serviceWikiKey(row),
    "service:008514896001230|경기도|김포시|일상생활돌봄|식사지원|식사배달사업",
  );
  assert.match(serviceWikiHref(row), /^\/wiki\?service=service%3A/);
});

test("same-name services with the same source row keep distinct WIKI links", () => {
  const first = {
    serviceId: "0085:1489599:1:1:1",
    sido: "경기도",
    sigungu: "파주시",
    category: "보건의료",
    subcategory: "방문진료",
    name: "장기요양 재택의료센터 시범사업",
  };
  const second = { ...first, subcategory: "방문간호" };
  assert.notEqual(serviceWikiKey(first), serviceWikiKey(second));
  assert.notEqual(serviceWikiHref(first), serviceWikiHref(second));
});

test("stable WIKI links do not change when dataset row order changes", () => {
  const row = {
    serviceId: "0091:1489702:1:10:61",
    sido: "경상남도",
    sigungu: "진주시",
    category: "기타",
    subcategory: "퇴원환자연계",
    name: "퇴원환자 지역사회 연계",
  };
  assert.equal(serviceWikiKey({ ...row, id: 3 }), serviceWikiKey({ ...row, id: 9000 }));
});

test("official service metadata survives client normalization for exact citations", () => {
  const [row] = normalizeRows([{
    serviceId: "0091:1489702:1:10:61",
    sido: "경상남도",
    sigungu: "진주시",
    name: "퇴원환자 지역사회 연계",
    detailUrl: "https://www.mohw.go.kr/board.es?list_no=1489702",
    updatedDate: "2026-03",
    applicationMethod: "주소지 행정복지센터 방문",
  }]);

  assert.equal(row.serviceId, "0091:1489702:1:10:61");
  assert.equal(row.detailUrl, "https://www.mohw.go.kr/board.es?list_no=1489702");
  assert.equal(row.updatedDate, "2026-03");
  assert.equal(row.applicationMethod, "주소지 행정복지센터 방문");
});
