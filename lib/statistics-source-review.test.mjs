import assert from "node:assert/strict";
import test from "node:test";
import { database } from "./press-test-support.mjs";
import { claimStatisticsWorker, releaseStatisticsWorker, readCurrentStatistics, readCurrentStatisticsSnapshots } from "./statistics/store.ts";
import { verifiedStatistics } from "./statistics/catalog.ts";
import { reviewStatisticsSource } from "./statistics/source-review.ts";
import { filterStatistics } from "./statistics/read.ts";
import { parseIndexApi } from "./statistics/index-api.ts";
import { readFileSync } from "node:fs";
import { statisticsSourceDate } from "./statistics/source-date.ts";

test("2025년 출생 수치는 독립 확인한 2025년 확정통계 출처로 표시한다", () => {
  const result = verifiedStatistics("stat:1428");
  assert.match(result.dataset.source_name, /2025년 출생 통계/);
  assert.match(result.dataset.source_review.original_source_name, /2024년 출생통계/);
});
test("출생통계 공표일과 지표누리 갱신일을 분리한다", () => {
  const result = verifiedStatistics("stat:1428");
  assert.equal(result.dataset.source_review.reference.published_at, "2026-08-26");
  assert.equal(statisticsSourceDate(result.dataset).date, "2026-09-28");
});

test("검수 보강은 원래 수치·단위를 유지하고 중복 적용되지 않는다", () => {
  const result = verifiedStatistics("stat:1428");
  assert.deepEqual(reviewStatisticsSource(result), result);
  assert.equal(result.dataset.series.find(s => s.source_label === "출생아 수").points.at(-1).value, 254.341);
});
test("수치나 최신연도가 바뀌면 기존 확정자료를 재사용하지 않는다", () => {
  const base = verifiedStatistics("stat:1428");
  const changed = structuredClone(base);
  changed.dataset.series[0].points.at(-1).value = 255;
  const reviewed = reviewStatisticsSource(changed);
  assert.equal(reviewed.dataset.source_review.status, "SOURCE_YEAR_MISMATCH");
  assert.equal(reviewed.dataset.source_review.reference, undefined);
  assert.match(reviewed.dataset.source_name, /2024/);
  const future = structuredClone(base);
  for (const series of future.dataset.series) series.points.push({period:"2026",value:1,raw:"1",status:"VALUE"});
  assert.equal(reviewStatisticsSource(future).dataset.source_review.reference, undefined);
});
test("추계·결측 또는 잠정값을 확정통계로 보정하지 않는다", () => {
  const base = verifiedStatistics("stat:1428");
  const projection = structuredClone(base); projection.dataset.index_api.projection = true;
  assert.equal(reviewStatisticsSource(projection).dataset.source_review, undefined);
  const provisional = structuredClone(base); provisional.dataset.series[0].points.at(-1).status = "PROVISIONAL";
  assert.equal(reviewStatisticsSource(provisional).dataset.source_review.reference, undefined);
});
test("연도 필터는 원자료 갱신일과 검수된 공표일을 혼합하지 않는다", () => {
  const result = filterStatistics(verifiedStatistics("stat:1428"), {from_year:2025,to_year:2025,series_id:"api-2"});
  assert.deepEqual(result.dataset.periods, ["2025"]);
  assert.equal(result.dataset.source_review.reference.published_at, "2026-08-26");
  assert.equal(statisticsSourceDate(result.dataset).date, "2026-09-28");
});
test("API 재조회에는 이전 검수 메타데이터가 남지 않는다", () => {
  const base = verifiedStatistics("stat:1428");
  const fixtures = JSON.parse(readFileSync(new URL("./statistics/fixtures/index-expanded.json", import.meta.url)));
  const rows = fixtures.find(row => row.table_code === "142801").rows;
  const parsed = parseIndexApi(JSON.stringify(rows), base.dataset, Date.parse("2026-10-14"));
  assert.equal(parsed.source_review, undefined);
  assert.match(parsed.source_name, /2024년/);
});

test("저장된 기존 출처명도 웹·API·MCP 공통 읽기에서 보완한다", async t => {
 const db = database(); t.after(()=>db.sqlite.close());
 const now=Date.parse("2026-10-14T00:00:00Z");
 await claimStatisticsWorker(db,now,"review-test"); await releaseStatisticsWorker(db,"review-test");
 const stored=structuredClone(verifiedStatistics("stat:1428"));
 stored.dataset.source_name=stored.dataset.source_review.original_source_name;
 delete stored.dataset.source_review; stored.revision="fixture-source-review";
 db.sqlite.prepare("UPDATE statistics_refresh_scope SET result_json=?,revision=?,latest_period=?,last_success_at=?,next_check_at=? WHERE scope_id=?")
  .run(JSON.stringify([stored]),stored.revision,"2025",now,now+86400000,"stat:1428");
 const current=await readCurrentStatistics(db,"stat:1428",{},now);
 const web=(await readCurrentStatisticsSnapshots(db,now)).find(r=>r.dataset.id==="stat:1428");
 for(const result of [current,web]) {
  assert.match(result.dataset.source_name,/2025년 출생 통계/);
  assert.equal(result.dataset.source_review.reference.published_at,"2026-08-26");
  assert.ok(result.warnings.some(w=>w.includes("original_source_name")));
 }
 assert.deepEqual(JSON.parse(db.sqlite.prepare("SELECT result_json FROM statistics_refresh_scope WHERE scope_id=?").get("stat:1428").result_json),[stored]);
});
