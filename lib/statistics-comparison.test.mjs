import assert from "node:assert/strict";
import test from "node:test";
import { KOSIS_DATASETS } from "./statistics/kosis.ts";
import { verifiedStatistics } from "./statistics/catalog.ts";
import { comparisonPeriods, comparisonPoint, defaultComparisonRegions, statisticsComparisonGroups } from "./statistics/comparison.ts";

test("지역 비교는 확인된 네 KOSIS 표의 같은 항목·단위만 묶는다", () => {
  const actual = KOSIS_DATASETS.flatMap(dataset => {
    const groups = statisticsComparisonGroups(dataset);
    return groups.length ? [[dataset.id, groups.length]] : [];
  });
  assert.deepEqual(actual, [["kosis:disability-health", 1], ["kosis:basic-livelihood", 3], ["kosis:near-poor-families", 12], ["kosis:disability-sports", 6]]);
  for (const dataset of KOSIS_DATASETS) for (const group of statisticsComparisonGroups(dataset)) {
    assert.equal(group.regions[0].name, "전국");
    assert.equal(new Set(group.regions.map(row => row.name)).size, group.regions.length);
    assert.deepEqual(new Set(group.regions.map(row => row.series.unit)), new Set([group.unit]));
    assert.deepEqual(new Set(group.regions.map(row => row.series.source_url)), new Set([group.source_url]));
    assert.equal(defaultComparisonRegions(group).length, 2);
    assert.match(group.regions.find(row => row.series.id === defaultComparisonRegions(group)[0]).name, /^제주/);
  }
});

test("기초생활보장 계·일반·시설과 차상위 월별 자료를 합산하거나 섞지 않는다", () => {
  const basic = statisticsComparisonGroups(verifiedStatistics("kosis:basic-livelihood").dataset);
  assert.deepEqual(basic.map(group => [group.label, group.regions.length]), [["계", 18], ["일반수급자", 18], ["시설수급자", 18]]);
  assert.equal(defaultComparisonRegions(basic[0])[0], "row-52");
  assert.ok(!defaultComparisonRegions(basic[0]).includes("row-1"));
  const months = statisticsComparisonGroups(verifiedStatistics("kosis:near-poor-families").dataset);
  assert.deepEqual(months.map(group => group.label), Array.from({ length: 12 }, (_, i) => `${i + 1}월`));
  assert.ok(months.every(group => group.regions.every(row => row.series.label.endsWith(` / ${group.label}`))));
});

test("장애인 통계는 전체와 거주지역별의 대응을 확인하고 성별·연령·다른 척도를 제외한다", () => {
  const health = statisticsComparisonGroups(verifiedStatistics("kosis:disability-health").dataset)[0];
  assert.equal(health.regions.length, 18);
  assert.equal(health.unit, "%");
  assert.equal(health.regions[0].series.label, "전체 / 계 / 수검률");
  assert.ok(health.regions.slice(1).every(row => row.series.label.startsWith("거주지역별 / ")));
  const sports = statisticsComparisonGroups(verifiedStatistics("kosis:disability-sports").dataset);
  assert.equal(sports.find(group => group.label === "평균(5점 만점)").unit, "점");
  assert.ok(sports.filter(group => group.label !== "평균(5점 만점)").every(group => group.unit === "%"));
});

test("다른 표·단위와 불명확한 중복 지역은 비교 집합에 들어가지 않는다", () => {
  const dataset = structuredClone(verifiedStatistics("kosis:basic-livelihood").dataset);
  dataset.series = dataset.series.filter(row => ["row-1", "row-52"].includes(row.id));
  assert.equal(statisticsComparisonGroups(dataset).length, 1);
  dataset.series[1].unit = "천명";
  assert.equal(statisticsComparisonGroups(dataset).length, 0);
  dataset.series[1].unit = "명";
  dataset.series[1].source_url = "https://kosis.kr/another-table";
  assert.equal(statisticsComparisonGroups(dataset).length, 0);
  dataset.series[1].source_url = dataset.source_url;
  dataset.series.push({ ...dataset.series[1], id: "duplicate" });
  assert.equal(statisticsComparisonGroups(dataset).length, 0);
  dataset.series.pop();
  dataset.kosis.tables[0].national_only = true;
  assert.equal(statisticsComparisonGroups(dataset).length, 0);
});

test("최신 API 수치를 그대로 비교하며 결측·비공개·잠정·추정 상태를 보존한다", () => {
  const dataset = structuredClone(verifiedStatistics("kosis:basic-livelihood").dataset);
  const source = dataset.series.find(row => row.id === "row-52");
  source.points = [
    { period: "2021", value: 90001, raw: "90001", status: "VALUE" },
    { period: "2022", value: null, raw: "-", status: "MISSING" },
    { period: "2023", value: 999, raw: "X", status: "CONFIDENTIAL" },
    { period: "2024", value: 90004, raw: "90004p", status: "PROVISIONAL" },
    { period: "2025", value: 90005, raw: "90005e", status: "ESTIMATE" },
  ];
  const series = statisticsComparisonGroups(dataset)[0].regions.find(row => row.name === "제주특별자치도").series;
  assert.equal(comparisonPoint(series, "2021").value, 90001);
  assert.equal(comparisonPoint(series, "2022").value, null);
  assert.equal(comparisonPoint(series, "2023").value, null);
  assert.equal(comparisonPoint(series, "2024").status, "PROVISIONAL");
  assert.equal(comparisonPoint(series, "2025").status, "ESTIMATE");
  assert.deepEqual(comparisonPoint(series, "2020"), { period: "2020", value: null, raw: "", status: "MISSING" });
});

test("비교 기간은 역전 범위를 거부하고 누락된 연도도 결측으로 남긴다", () => {
  const group = statisticsComparisonGroups(verifiedStatistics("kosis:basic-livelihood").dataset)[0];
  const sparse = { ...group, regions: group.regions.slice(0, 2).map(row => ({ ...row, series: { ...row.series, points: ["2021", "2023", "2025"].map(period => ({ period, value: 10, raw: "10", status: "VALUE" })) } })) };
  assert.deepEqual(comparisonPeriods(sparse), ["2021", "2022", "2023", "2024", "2025"]);
  assert.deepEqual(comparisonPeriods(sparse, "2022", "2024"), ["2022", "2023", "2024"]);
  assert.deepEqual(comparisonPeriods(sparse, "2024", "2022"), []);
  assert.equal(comparisonPoint(sparse.regions[0].series, "2022").status, "MISSING");
});

test("인구 비교는 같은 연령의 전국·광역자료를 쓰고 시군구를 중복 집계하지 않는다", () => {
  for (const id of ["population:total", "population:middle-aged", "population:older", "population:children"]) {
    const result = verifiedStatistics(id);
    const groups = statisticsComparisonGroups(result.dataset);
    assert.equal(groups.length, 1);
    assert.ok(groups[0].regions.every(row => row.series.region.level !== "sigungu"));
    assert.equal(groups[0].regions.find(row => row.name === "전국").series.points.at(-1).value, result.dataset.series.find(row => row.region?.level === "national").points.at(-1).value);
    assert.equal(comparisonPeriods(groups[0]).length, 1);
    assert.equal(defaultComparisonRegions(groups[0]).length, 2);
  }
});
