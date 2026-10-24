import assert from "node:assert/strict";
import test from "node:test";
import { database } from "./press-test-support.mjs";
import { verifiedStatistics, statisticsCatalog } from "./statistics/catalog.ts";
import { STATISTICS_HIGHLIGHTS, STATISTICS_HIGHLIGHT_IDS, statisticsYearChange } from "./statistics/highlights.ts";
import { readCurrentStatisticsSnapshots } from "./statistics/store.ts";

test("복지·돌봄 대표지표는 중복 없는 KOSIS 8종이며 원표의 정확한 항목과 단위를 가리킨다", () => {
  // Given eight configured representative measures and the official catalog.
  const catalog = statisticsCatalog();
  const expected = [
    ["kosis:basic-livelihood", "전국 / 계", "명"], ["kosis:older-facilities", "총계 / 시설수", "개소"],
    ["kosis:registered-disabled", "합계 / 계", "명"], ["kosis:long-term-care-insurance", "합계 / 계", "명"],
    ["kosis:childcare-users", "어린이집 보육아동 현황 · 합계", "명"], ["kosis:protected-children", "보호대상아동 발생수", "명"],
    ["kosis:national-pension", "계 / 합계 / 계 / 수급자수", "명"], ["kosis:social-expenditure", "재원별 / 공공지출", "%"],
  ];
  // When the configured cards are resolved against verified datasets.
  const actual = STATISTICS_HIGHLIGHTS.map(card => {
    const result = verifiedStatistics(card.dataset_id);
    const series = result.dataset.series.find(row => row.id === card.series_id);
    assert.ok(catalog.some(row => row.dataset_id === card.dataset_id && row.data_available));
    if (card.related) assert.ok(catalog.some(row => row.dataset_id === card.related.dataset_id && row.data_provider === "index"));
    return [card.dataset_id, series.label, series.unit];
  });
  // Then no facility count, percentage subtotal or unrelated population metric substitutes for the named card.
  assert.equal(STATISTICS_HIGHLIGHT_IDS.size, 8);
  assert.deepEqual(actual, expected);
  assert.match(STATISTICS_HIGHLIGHTS.find(card => card.dataset_id === "kosis:long-term-care-insurance").scope, /등급외 포함/);
  assert.match(STATISTICS_HIGHLIGHTS.find(card => card.dataset_id === "kosis:national-pension").scope, /일시금 포함/);
});

test("대표지표와 선택 통계는 같은 D1 발행값을 읽고 무관한 KOSIS 전체 자료를 초기 응답에 싣지 않는다", async t => {
  // Given a new valid childcare publication and a separate selected KOSIS dataset.
  const db = database(); t.after(() => db.sqlite.close());
  const baseline = structuredClone(verifiedStatistics("kosis:childcare-users"));
  baseline.revision = "highlight-fixture";
  baseline.checked_at = "2026-10-17T01:00:00Z";
  const correctedPoint = baseline.dataset.series.find(row => row.id === "row-9").points.at(-1);
  correctedPoint.value = 900001;
  correctedPoint.raw = "900,001";
  db.sqlite.prepare("INSERT INTO statistics_refresh_scope(scope_id,result_json,revision,latest_period,last_success_at,next_check_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .run(baseline.dataset.id, JSON.stringify([baseline]), baseline.revision, baseline.dataset.periods.at(-1), Date.parse(baseline.checked_at), Date.parse("2026-10-18T01:00:00Z"), 0);
  // When initial cards and a selected non-highlight dataset are read.
  const results = await readCurrentStatisticsSnapshots(db, Date.parse("2026-10-17T02:00:00Z"), "kosis:single-parent-survey");
  const kosis = results.filter(result => result.dataset.kosis);
  // Then all eight current card datasets and the selected dataset are present exactly once, with the corrected live value.
  assert.equal(kosis.length, 9);
  assert.deepEqual(new Set(kosis.map(result => result.dataset.id)), new Set([...STATISTICS_HIGHLIGHT_IDS, "kosis:single-parent-survey"]));
  const current = results.find(result => result.dataset.id === baseline.dataset.id);
  assert.equal(current.dataset.series.find(row => row.id === "row-9").points.at(-1).value, 900001);
  assert.equal(current.revision, "highlight-fixture");
});

test("비율의 %p와 수치의 증감률을 구분하고 결측·비연속 연도·0 분모에서는 변화율을 만들지 않는다", () => {
  // Given consecutive observed values with explicit original units.
  const series = (unit, from, to, first = "2024", last = "2025") => ({ id: "fixture", label: "fixture", source_label: "fixture", unit,
    points: [{ period: first, value: from, raw: String(from), status: from === null ? "MISSING" : "VALUE" }, { period: last, value: to, raw: String(to), status: to === null ? "MISSING" : "VALUE" }] });
  // When annual changes are calculated.
  const changes = [statisticsYearChange(series("%", 10, 12)), statisticsYearChange(series("명", 10, 12)), statisticsYearChange(series("%", 0, 2))];
  // Then rates use percentage points; missing or incomparable values never become zero growth.
  assert.deepEqual(changes, [{ value: 2, unit: "%p" }, { value: 20, unit: "%" }, { value: 2, unit: "%p" }]);
  for (const row of [series("명", 0, 12), series("명", 10, null), series("명", null, 12), series("%", 10, 12, "2021", "2024"), series("명", 10, 12, "2025-01", "2025-02")]) assert.equal(statisticsYearChange(row), null);
});
