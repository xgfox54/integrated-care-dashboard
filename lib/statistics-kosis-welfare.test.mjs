import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { database } from "./press-test-support.mjs";
import { statisticsCatalog, statisticsStatus, searchStatistics, verifiedStatistics } from "./statistics/catalog.ts";
import { KOSIS_WELFARE_DIRECTORY } from "./statistics/kosis-welfare-directory.ts";
import { readCurrentStatistics, STATISTICS_SCOPE_IDS } from "./statistics/store.ts";
import { statisticsCsv } from "./statistics/csv.ts";

test("KOSIS 복지 원문 31종을 누락 없이 제공하고 파일 통계만 원문 안내로 구분한다", () => {
  const evidence = JSON.parse(readFileSync(new URL("../docs/statistics/kosis-welfare-directory-2026-10-16.json", import.meta.url)));
  const result = searchStatistics({ kind: "kosis", limit: 100 });
  assert.equal(result.total, 31);
  assert.deepEqual(result.items.map(row => row.title).sort(), evidence.items.map(row => row.title).sort());
  assert.equal(new Set(result.items.map(row => row.id)).size, 31);
  assert.equal(result.items.filter(row => row.data_available).length, 30);
  const file = result.items.find(row => row.title === "고령화연구패널조사");
  assert.equal(file.dataset_id, null);
  assert.equal(file.data_available, false);
  assert.match(file.description, /파일/);
  assert.match(file.source_url, /parentId=G_2\.2/);
  assert.equal(statisticsStatus().kosis_welfare_connected, 30);
});

test("복지 주제의 수치 연결 30종은 저장소 갱신이나 외부 호출 없이 확인본과 API 갱신 상태를 조회한다", async t => {
  const db = database();
  t.after(() => db.sqlite.close());
  for (const [, title, , id] of KOSIS_WELFARE_DIRECTORY) {
    if (id === null) continue;
    const result = await readCurrentStatistics(db, id);
    assert.ok(result.dataset.kosis, title);
    assert.ok(result.dataset.series.some(series => series.points.some(point => point.value !== null)), title);
    assert.equal(result.state, "VERIFIED_SNAPSHOT");
    assert.equal(result.auto_refresh.enabled, true);
    assert.ok(STATISTICS_SCOPE_IDS.includes(id));
  }
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM statistics_refresh_scope").get().n, 0);
});

test("새 KOSIS 수치는 공식 셀의 단위와 정밀도를 유지하고 기존 천명 지표를 바꾸지 않는다", () => {
  const selected = id => { const dataset = verifiedStatistics(id).dataset; return dataset.series.find(row => row.id === dataset.highlight_series_id); };
  assert.deepEqual([selected("stat:2760").unit, selected("stat:2760").points.at(-1).value], ["천명", 2837]);
  assert.deepEqual([selected("kosis:basic-livelihood").unit, selected("kosis:basic-livelihood").points.at(-1).value], ["명", 2836706]);
  assert.deepEqual([selected("kosis:pension-statistics").unit, selected("kosis:pension-statistics").points.at(-1).value], ["천명", 9122]);
  assert.deepEqual([selected("kosis:disability-sports").unit, selected("kosis:disability-sports").points.at(-1).value], ["점", 3.04]);
  const sports = verifiedStatistics("kosis:disability-sports").dataset.series;
  assert.equal(sports.find(row => row.label === "전체 / 좋다").unit, "%");
  assert.deepEqual(selected("kosis:retirement-panel").points.map(point => [point.period, point.value]), [["2019", 40.1], ["2021", 40.8], ["2023", 45]]);
  assert.equal(selected("kosis:near-poor-families").label, "계 / 12월");
  assert.equal(selected("kosis:near-poor-families").points.at(-1).value, 1031081);
  const pension = verifiedStatistics("kosis:pension-statistics").dataset.series;
  assert.equal(pension.find(row => row.label === "남자 / 65~69세 / 연금수급자").points.at(-1).value, 1626);
  assert.equal(pension.find(row => row.label === "여자 / 65~69세 / 연금수급자").points.at(-1).value, 1544);
});

test("보육아동 CSV는 시설 수와 다른 단위 및 실제 수치표 출처를 내보낸다", () => {
  const result = verifiedStatistics("kosis:childcare-users");
  const series = result.dataset.series.find(row => row.label === "어린이집 보육아동 현황 · 합계");
  const csv = statisticsCsv(result, series.id, ["2025"]);
  assert.equal(series.unit, "명");
  assert.equal(series.points.at(-1).value, 887764);
  assert.match(csv, /887764/);
  assert.match(csv, /DT_15407_NN002/);
  assert.doesNotMatch(csv, /DT_15407_NN001|개소|2023|2024/);
});

test("조사 사례수와 행정 집계·월별 수급자 수의 해석 기준을 함께 제공한다", () => {
  assert.match(verifiedStatistics("kosis:single-parent-survey").dataset.note, /사례수.*전체 한부모가구 수가 아닙니다/);
  assert.match(verifiedStatistics("kosis:senior-jobs-survey").dataset.note, /조사 참여자 수/);
  assert.match(verifiedStatistics("kosis:disability-life-panel").dataset.note, /추정치/);
  assert.match(verifiedStatistics("kosis:near-poor-families").dataset.note, /합산하지/);
  assert.match(verifiedStatistics("kosis:long-term-care-insurance").dataset.note, /등급외/);
  assert.equal(statisticsCatalog().filter(row => row.kind === "indicator" && row.data_provider === "index").length, 32);
});
