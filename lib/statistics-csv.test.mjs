import { test } from "node:test";
import assert from "node:assert/strict";
import { statisticsCsv } from "./statistics/csv.ts";
import { verifiedStatistics } from "./statistics/catalog.ts";

test("CSV preserves negative numeric cells and protects untrusted text", () => {
  const source = verifiedStatistics("stat:2764");
  const series = source.dataset.series.find(row => row.points.some(p => p.period === "2022" && p.value === -795518));
  const result = { ...source, dataset: { ...source.dataset, title: "=1+1", series: [{ ...series, label: "@SUM(1,2)" }] } };
  const csv = statisticsCsv(result, series.id, ["2022"]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes(',"-795518",'));
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"\'@SUM(1,2)"'));
  assert.equal(csv.split("\r\n").length, 2);
  assert.equal(statisticsCsv(result, "missing", ["2022"]), null);
});

test("CSV keeps missing values empty and quotes multiline source text", () => {
  const source = verifiedStatistics("stat:2760");
  const series = { ...source.dataset.series[0], label: '표 "항목"\n둘째 줄', points: [{ period: "2025", value: null, raw: "-", status: "MISSING" }] };
  const csv = statisticsCsv({ ...source, dataset: { ...source.dataset, series: [series] } }, series.id, ["2025"]);
  assert.ok(csv.includes('"표 ""항목""\n둘째 줄"'));
  assert.ok(csv.includes('"2025","","\'-"'));
  assert.ok(csv.includes('"자료 없음"'));
});
