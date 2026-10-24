import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { database } from "./press-test-support.mjs";
import { statisticsCatalog, verifiedStatistics } from "./statistics/catalog.ts";
import { INDEX_API_SERIES } from "./statistics/index-verified-data.ts";
import { readCurrentStatistics, readCurrentStatisticsSnapshots, POPULATION_SCOPE, publishedResults } from "./statistics/store.ts";

test("전체 인구수는 연령층 합계가 아닌 원문 총인구로 전국과 모든 시도를 제공한다", () => {
  const original = readFileSync(new URL("../docs/statistics/population-2026-09/mois-age-202609.web.txt", import.meta.url), "utf8");
  const rows = [...original.matchAll(/^L\d+: (\d{10})\s*\|\s*([^|]+)\|\s*([\d,]+)/gm)];
  const result = verifiedStatistics("population:total");
  assert.equal(rows.length, 17);
  assert.deepEqual(result.dataset.periods, ["2026-09"]);
  for (const [, code, , raw] of rows) {
    const point = result.dataset.series.find(series => series.region.code === code).points[0];
    assert.equal(point.value, Number(raw.replaceAll(",", "")));
    assert.equal(point.value, point.total_population);
    assert.equal(point.status, "VALUE");
  }
  assert.ok(statisticsCatalog().some(item => item.dataset_id === result.dataset.id && item.data_available));
});

test("전체 인구수는 기존 3종 게시본의 새 기준월과 총인구를 즉시 공유하고 저장본을 바꾸지 않는다", async t => {
  const db = database();
  t.after(() => db.sqlite.close());
  const datasets = ["population:middle-aged", "population:older", "population:children"].map(id => {
    const result = verifiedStatistics(id);
    return { ...result, revision: "next-month", checked_at: "2026-11-01T00:00:00Z", available_periods: ["2026-10"], dataset: {
      ...result.dataset, periods: ["2026-10"], population: { ...result.dataset.population, reference_date: "2026-10-31" },
      series: result.dataset.series.map(series => ({ ...series, points: series.points.map(point => ({ ...point, period: "2026-10", total_population: 123456 })) })),
    } };
  });
  const row = { scope_id: POPULATION_SCOPE, result_json: JSON.stringify(datasets), revision: "next-month", latest_period: "2026-10" };
  assert.equal(publishedResults(row).length, 3);
  db.sqlite.prepare("INSERT INTO statistics_refresh_scope (scope_id, result_json, revision, latest_period, last_success_at, next_check_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(POPULATION_SCOPE, row.result_json, row.revision, row.latest_period, Date.parse("2026-11-01T00:00:00Z"), Date.parse("2026-11-02T00:00:00Z"), 0);
  const result = await readCurrentStatistics(db, "population:total");
  assert.deepEqual(result.dataset.periods, ["2026-10"]);
  assert.equal(result.dataset.population.reference_date, "2026-10-31");
  assert.equal(result.revision, "next-month");
  assert.equal(result.refresh_error, null);
  assert.ok(result.dataset.series.every(series => series.points[0].value === 123456));
  assert.equal((await readCurrentStatisticsSnapshots(db)).find(item => item.dataset.id === "population:total").dataset.series[0].points[0].value, 123456);
  assert.equal(db.sqlite.prepare("SELECT result_json FROM statistics_refresh_scope WHERE scope_id = ?").get(POPULATION_SCOPE).result_json, row.result_json);
});

test("연결된 지표누리 API의 모든 데이터셋에 조회 가능한 통계항목이 있다", () => {
  const catalog = statisticsCatalog();
  for (const id of Object.keys(INDEX_API_SERIES)) {
    assert.ok(catalog.some(item => item.dataset_id === id && item.data_provider === "index" && item.data_available), id);
  }
});
