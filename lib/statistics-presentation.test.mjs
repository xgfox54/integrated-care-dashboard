import assert from "node:assert/strict";
import test from "node:test";
import { verifiedStatistics } from "./statistics/catalog.ts";
import { adjacentPeriods, invalidStatisticRange, populationComposition, statisticChange, statisticChartKind, statisticNationalPoint, statisticPointsInRange, statisticRegionRows, usablePoint } from "./statistics/presentation.ts";

const point = (period, value, status = "VALUE") => ({ period, value, raw: String(value ?? "-"), status });

test("연 단위 공유 주소의 종료연도에 같은 연도의 월별 자료를 포함한다", () => {
  const points = [point("2025-12", 8), point("2026-09", 9), point("2027-01", 10)];
  assert.deepEqual(statisticPointsInRange(points, "2026", "2026").map(row => row.value), [9]);
  assert.equal(invalidStatisticRange("2026-09", "2026"), false);
  assert.equal(invalidStatisticRange("2026-09", "2026-08"), true);
  assert.deepEqual(statisticPointsInRange(points, "2026-09", "2026-08"), []);
});

test("공개 가능한 시점 수에 맞는 차트만 선택하고 숨긴 수치를 복원하지 않는다", () => {
  assert.equal(statisticChartKind([point("2023", 15, "CONFIDENTIAL"), point("2024", 0), point("2025", 10, "MISSING")]), "single");
  assert.equal(statisticChartKind([point("2024", 0), point("2025", 10, "PROVISIONAL")]), "columns");
  assert.equal(statisticChartKind([point("2023", -1), point("2024", 0), point("2025", 10, "ESTIMATE")]), "line");
  assert.equal(statisticChartKind([point("2025", NaN)]), "empty");
});

test("연속된 연·월만 직전 기간으로 비교하며 0·음수 분모로 증감률을 만들지 않는다", () => {
  assert.equal(adjacentPeriods("2025-12", "2026-01"), true);
  assert.equal(adjacentPeriods("2025-13", "2026-01"), false);
  assert.equal(statisticChange([point("2023", 10), point("2025", 12)], "명"), null);
  assert.equal(statisticChange([point("2024", 10), point("2025", 12, "CONFIDENTIAL")], "명"), null);
  assert.equal(statisticChange([point("2024", 0), point("2025", 12)], "명").rate, null);
  assert.equal(statisticChange([point("2024", -10), point("2025", 12)], "명").rate, null);
});

test("실제 기초생활보장 수급자 수와 비율 차이를 원단위에서 계산한다", () => {
  const dataset = verifiedStatistics("kosis:basic-livelihood").dataset;
  const series = dataset.series.find(row => row.id === "row-1");
  const change = statisticChange([point("2024", 2673485), series.points.at(-1)], series.unit);
  assert.equal(change.difference, 163221);
  assert.ok(Math.abs(change.rate - 6.10517885) < 0.001);
  const percent = statisticChange([point("2024", 20), point("2025", 21)], "%");
  assert.equal(percent.percentPoints, true);
  assert.equal(percent.difference, 1);
});

test("100% 구성비는 같은 시점의 유효한 총인구가 있을 때만 계산한다", () => {
  const dataset = verifiedStatistics("population:middle-aged").dataset;
  const series = dataset.series.find(row => row.id === dataset.highlight_series_id);
  const latest = series.points.at(-1);
  const composition = populationComposition(dataset, series, latest);
  assert.ok(composition.share > 0 && composition.share < 100);
  assert.equal(populationComposition(dataset, series, { ...latest, total_population: 0 }), null);
  assert.equal(populationComposition(dataset, series, { ...latest, total_population: latest.value - 1 }), null);
  assert.equal(populationComposition(dataset, series, { ...latest, total_population: undefined }), null);
  assert.equal(populationComposition({ ...dataset, population: undefined }, series, latest), null);
});

test("지역 순위는 전국 합계·미수록 시군구를 만들지 않고 원자료 지역값만 쓴다", () => {
  const dataset = verifiedStatistics("population:middle-aged").dataset;
  const national = dataset.series.find(row => row.id === dataset.highlight_series_id);
  const rows = statisticRegionRows(dataset, national, "2026-09");
  assert.equal(rows.length, 16);
  assert.ok(!rows.some(row => row.name === "전국" || row.name === "서귀포시"));
  const jeju = rows.find(row => row.name.startsWith("제주"));
  assert.equal(jeju.value, 271775);
  const local = dataset.series.find(row => row.id === jeju.id);
  assert.equal(statisticNationalPoint(dataset, local, "2026-09").value, 20073399);
  assert.equal(statisticNationalPoint(dataset, national, "2026-09"), null);
  assert.ok(statisticRegionRows(dataset, national, "2025-09").every(row => row.value === null));
});

test("결측 값에 숫자가 남아도 요약·순위·변화율에 공개하지 않는다", () => {
  const dataset = structuredClone(verifiedStatistics("kosis:basic-livelihood").dataset);
  const national = dataset.series.find(row => row.id === "row-1");
  const local = dataset.series.find(row => row.id === "row-52");
  local.points = [point("2025", 99999, "CONFIDENTIAL")];
  assert.equal(usablePoint(local.points[0]), false);
  assert.equal(statisticRegionRows(dataset, national, "2025").find(row => row.id === local.id).value, null);
  assert.equal(statisticChange([point("2024", 15), ...local.points], "명"), null);
});
