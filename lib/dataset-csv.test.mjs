import assert from "node:assert/strict";
import test from "node:test";

import { toCsv } from "./dataset-csv.ts";

function row(name) {
  return {
    id: 1,
    serviceId: "service-1",
    sido: "서울특별시",
    sigungu: "종로구",
    category: "보건의료",
    subcategory: "방문진료",
    name,
    description: "설명",
    target: "대상",
    detailTarget: "",
    applicationMethod: "",
    provider: "기관",
    type: "지역특화",
    serial: "1",
    detailUrl: "",
    updatedDate: "",
    searchIndex: "",
  };
}

for (const value of [
  "=1+1",
  "+1+1",
  "-1+1",
  "@SUM(A1:A2)",
  "    =1+1",
  "\t=1+1",
  "\r=1+1",
  "\n=1+1",
  "\v=1+1",
  "\f=1+1",
  "\u00A0=1+1",
]) {
  test(`CSV neutralizes spreadsheet formula input ${JSON.stringify(value)}`, () => {
    const csv = toCsv([row(value)]);
    assert.ok(csv.includes(`"'${value.replaceAll('"', '""')}"`));
  });
}
