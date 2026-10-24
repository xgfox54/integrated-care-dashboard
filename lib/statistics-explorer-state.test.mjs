import assert from "node:assert/strict";
import test from "node:test";
import { filterStatisticsGroups, readStatisticsView, writeStatisticsView } from "./statistics/explorer-state.ts";
import { statisticsCatalog, verifiedStatistics } from "./statistics/catalog.ts";
import { statisticsComparisonGroups } from "./statistics/comparison.ts";

test("공유 URL은 상세·비교·출처 조건을 복원하고 기존 지도·검색 조건을 보존한다", () => {
  const params = new URLSearchParams("id=kosis%3Abasic-livelihood&q=수급&cat=사회보장&page=2&region=제주특별자치도&measure=children&basis=share");
  const view = { provider: "kosis", regional: true, series: "row-3", from: "2024", to: "2025", comparison: { dataset: "kosis:basic-livelihood", group: "row-2", regions: ["row-2", "row-5", "row-53"], from: "2024", to: "2025" } };
  writeStatisticsView(params, view);
  assert.deepEqual(readStatisticsView(params), view);
  assert.equal(params.get("q"), "수급");
  assert.equal(params.get("cat"), "사회보장");
  assert.equal(params.get("page"), "2");
  assert.equal(params.get("region"), "제주특별자치도");
  assert.equal(params.get("measure"), "children");
  assert.equal(params.get("basis"), "share");
  writeStatisticsView(params, { provider: "", regional: false, series: "", from: "", to: "", comparison: null });
  assert.equal(params.has("compare_regions"), false);
  assert.equal(params.has("provider"), false);
  assert.equal(params.has("series"), false);
  assert.equal(params.get("region"), "제주특별자치도");
});

test("URL의 기본 선택과 명시적 지역 미선택을 구분하고 잘못된 값을 제외한다", () => {
  const empty = readStatisticsView(new URLSearchParams("compare_dataset=kosis%3Abasic-livelihood&compare_regions="));
  assert.deepEqual(empty.comparison.regions, []);
  const defaults = readStatisticsView(new URLSearchParams("compare_dataset=kosis%3Abasic-livelihood"));
  assert.equal(defaults.comparison.regions, null);
  const invalid = readStatisticsView(new URLSearchParams("provider=unknown&regional=true&series=%3Cscript%3E&from=2025-13&to=abcd&compare_dataset=%3Cscript%3E"));
  assert.deepEqual(invalid, { provider: "", regional: false, series: "", from: "", to: "", comparison: null });
  const bounded = readStatisticsView(new URLSearchParams("compare_dataset=kosis%3Abasic-livelihood&compare_regions=row-1,row-1,row-2,row-3,row-4,row-5&compare_from=2026-09"));
  assert.deepEqual(bounded.comparison.regions, ["row-1", "row-2", "row-3", "row-4"]);
  assert.equal(bounded.comparison.from, "2026-09");
});

test("출처·지역 비교·분야·검색어를 함께 적용하고 같은 자료의 목록 출처를 구분한다", () => {
  const catalog = statisticsCatalog();
  const datasets = new Map();
  for (const row of catalog) if (row.dataset_id && !datasets.has(row.dataset_id)) datasets.set(row.dataset_id, row);
  const groups = [...datasets.values()].map(item => ({ item, sources: catalog.filter(row => row.dataset_id === item.dataset_id), comparison_available: Boolean(statisticsComparisonGroups(verifiedStatistics(item.dataset_id).dataset).length) }));
  const comparable = filterStatisticsGroups(groups, "", "", "kosis", true);
  assert.deepEqual(new Set(comparable.map(group => group.item.dataset_id)), new Set(["kosis:basic-livelihood", "kosis:disability-health", "kosis:near-poor-families", "kosis:disability-sports"]));
  assert.equal(filterStatisticsGroups(groups, "", "", "index", true).length, 0);
  assert.equal(filterStatisticsGroups(groups, "", "", "population", true).length, 4);
  const basic = comparable.find(group => group.item.dataset_id === "kosis:basic-livelihood");
  assert.deepEqual(filterStatisticsGroups(groups, "KOSIS 기초생활", basic.item.category, "kosis", true).map(group => group.item.dataset_id), ["kosis:basic-livelihood"]);
  assert.equal(filterStatisticsGroups(groups, "존재하지않는통계", "", "kosis", true).length, 0);
  assert.ok(filterStatisticsGroups(groups, "지표누리 API", "", "index").every(group => group.sources.some(row => row.data_provider === "index")));
});
