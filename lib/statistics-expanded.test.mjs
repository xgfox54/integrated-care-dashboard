import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { database } from "./press-test-support.mjs";
import { statisticsCatalog, verifiedStatistics } from "./statistics/catalog.ts";
import { indexApiTables, parseIndexApi, mergeIndexApiTables } from "./statistics/index-api.ts";
import { INDEX_EXPANDED_DATASETS } from "./statistics/index-expanded-data.ts";
import { RETIRED_STATISTICS_IDS } from "./statistics/index-verified-data.ts";
import { runStatisticsRefresh } from "./statistics/background.ts";
import { statisticsCsv } from "./statistics/csv.ts";
import { STATISTICS_DATASETS } from "./statistics/catalog.ts";
import { statisticsSourceDate } from "./statistics/source-date.ts";
import { claimStatisticsWorker, releaseStatisticsWorker, readCurrentStatistics, currentStatisticsStatus, STATISTICS_DAY } from "./statistics/store.ts";
const fixtures = JSON.parse(readFileSync(new URL("./statistics/fixtures/index-expanded.json", import.meta.url)));
const NOW = Date.parse("2026-10-11T13:00:00Z");
const rowsFor = code => fixtures.find(row => row.table_code === code).rows;
test("출생아 수는 천명이고 합계출산율은 가임여성 1명당 명으로 구분한다", () => {
  const result = verifiedStatistics("stat:1428");
  const births = result.dataset.series.find(series => series.source_label === "출생아 수");
  const fertility = result.dataset.series.find(series => series.source_label === "합계 출산율");
  assert.equal(births.unit, "천명");
  assert.equal(births.points.find(point => point.period === "2020").value, 272.3);
  assert.equal(fertility.unit, "가임여성 1명당 명");
  assert.equal(fertility.points.find(point => point.period === "2023").value, 0.721);
  assert.equal(result.dataset.highlight_series_id, fertility.id);
  const csv = statisticsCsv(result, births.id, ["2020"]);
  assert.match(csv, /천명/);
  assert.doesNotMatch(csv, /가임여성/);
});
test("새 지표 16종의 실제 19개 API 표와 수치·단위를 대조한다", () => {
  assert.equal(INDEX_EXPANDED_DATASETS.length, 16);
  assert.ok(statisticsCatalog().filter(row => row.kind !== "portal").every(row => row.data_available));
  for (const expected of INDEX_EXPANDED_DATASETS.filter(dataset => !RETIRED_STATISTICS_IDS.has(dataset.id))) {
    const parts = indexApiTables(expected).map(table => parseIndexApi(JSON.stringify(rowsFor(table.table_code)), table, NOW));
    const result = mergeIndexApiTables(expected, parts);
    assert.deepEqual(result.periods, expected.periods, expected.id);
    assert.deepEqual(result.series.map(s => s.unit), expected.series.map(s => s.unit), expected.id);
    for (const s of result.series) {
      const saved = expected.series.find(row => row.id === s.id);
      assert.deepEqual(s.points.map(p => [p.period,p.raw,p.value]), saved.points.map(p => [p.period,p.raw,p.value]), expected.id + ":" + s.id);
    }
  }
  assert.equal(verifiedStatistics("stat:A0007").dataset.series[0].points.find(p => p.period === "2023").status, "MISSING");
  assert.deepEqual(verifiedStatistics("stat:1409").dataset.periods, ["2017","2020","2023"]);
  assert.equal(verifiedStatistics("stat:1441"), null);
  assert.match(verifiedStatistics("stat:2769").dataset.series.find(s => s.label.includes("모성사망비")).unit, /10만/);
});
test("복합 표는 누락·다른 주기·중복 표를 합쳐 저장하지 않는다", () => {
  const expected = verifiedStatistics("stat:2770").dataset, tables = indexApiTables(expected);
  const first = parseIndexApi(JSON.stringify(rowsFor(tables[0].table_code)), tables[0], NOW);
  assert.throws(() => mergeIndexApiTables(expected, [first]), /확인/);
  assert.throws(() => mergeIndexApiTables(expected, [first,first]), /확인/);
  const changed = structuredClone(rowsFor(tables[1].table_code)); changed[0]["주기코드"] = "M";
  assert.throws(() => parseIndexApi(JSON.stringify(changed), tables[1], NOW), /확인/);
});
test("관리자 선택 범위만 확인하고 복합 표를 하나의 D1 게시본으로 저장한다", async t => {
  const db = database(); t.after(() => db.sqlite.close());
  await claimStatisticsWorker(db, NOW, "setup"); await releaseStatisticsWorker(db, "setup");
  db.sqlite.prepare("UPDATE statistics_refresh_scope SET next_check_at = ?").run(NOW + STATISTICS_DAY);
  db.sqlite.prepare("UPDATE statistics_refresh_worker SET host_state_json = ?").run(JSON.stringify({"https://www.index.go.kr":{api_enabled:true,next_request_at:0}}));
  let clock = NOW; const calls = [];
  const result = await runStatisticsRefresh(db, {now:()=>clock,sleep:async ms=>{clock+=ms},scopeId:"stat:2770",force:true,timeoutMs:100,maxSteps:1,readIndexKey:async()=>"fixture-key",
    fetcher:async url=>{const code=new URL(url).searchParams.get("statsCode");calls.push(code);return Response.json(rowsFor(code))}});
  assert.equal(result.completed,1); assert.deepEqual(calls,["277002","277003"]);
  const current = await readCurrentStatistics(db,"stat:2770",{},clock);
  assert.equal(current.state,"CACHED"); assert.equal(current.dataset.series.length,32);
  assert.doesNotMatch(JSON.stringify(current),/fixture-key|idntfcId/);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM statistics_refresh_scope WHERE last_success_at IS NOT NULL").get().n,1);
  await assert.rejects(runStatisticsRefresh(db,{scopeId:"report:child-abuse",force:true}),/SOURCE_NOT_ALLOWED/);
});
test("공식 보고서 8종은 관측연도·단위를 제공하며 API 자동 확인에서 제외한다",async t=>{
  const db=database();t.after(()=>db.sqlite.close());
  const reports=statisticsCatalog().filter(row=>row.dataset_id?.startsWith("report:"));
  assert.equal(reports.length,8);
  for(const item of reports){
    const result=await readCurrentStatistics(db,item.dataset_id,{},NOW);
    assert.ok(result.dataset.series.some(s=>s.points.some(p=>p.value!==null)),item.title);
    assert.equal(result.auto_refresh,undefined);
    assert.ok(result.dataset.official_report.published_at);
    assert.match(result.dataset.source_url,/^https:\/\/(?:www\.mohw\.go\.kr|nikom\.or\.kr|(?:m|www)\.korea\.kr)\//);
  }
  const status=await currentStatisticsStatus(db);
  assert.equal(status.automatic_refresh.table_count,35);
  assert.ok(status.datasets.filter(row=>row.id.startsWith("report:")).every(row=>row.refresh_mode==="verified_snapshot"));
});

test("복지통계는 사이트 확인일 대신 원자료 갱신·공표일을 제공한다", () => {
  for (const dataset of STATISTICS_DATASETS) assert.match(statisticsSourceDate(dataset)?.date ?? "", /^\d{4}-\d{2}-\d{2}$/, dataset.id);
  assert.deepEqual(statisticsSourceDate(STATISTICS_DATASETS.find(row => row.id === "stat:2762")), { kind: "updated", label: "원자료 갱신", date: "2026-08-21" });
  assert.deepEqual(statisticsSourceDate(STATISTICS_DATASETS.find(row => row.id === "stat:2760")), { kind: "updated", label: "원자료 갱신", date: "2026-07-31" });
  assert.deepEqual(statisticsSourceDate(STATISTICS_DATASETS.find(row => row.id === "report:lonely-death")), { kind: "published", label: "원자료 공표", date: "2025-11-27" });
  assert.equal(statisticsSourceDate(STATISTICS_DATASETS.find(row => row.id === "kosis:foster-adoption"))?.date, "2026-08-21");
  assert.equal(statisticsSourceDate(STATISTICS_DATASETS.find(row => row.id === "population:older"))?.label, "자료 기준일");
});
