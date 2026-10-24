import assert from "node:assert/strict";
import test from "node:test";
import { database } from "./press-test-support.mjs";
import { buildVisitsReport, readVisitSummary } from "./usage/visits.ts";
import { reportToCsv } from "./usage/report-csv.ts";

const meta = {
  from: "2026-10-01", to: "2026-10-03", prevFrom: "2026-09-28", prevTo: "2026-09-30",
  today: "2026-10-16", includesToday: false, generatedAt: Date.parse("2026-10-16T01:00:00Z"),
  lastIngestAt: null, enabled: true, killSwitch: false, prevCollected: true,
  dayStates: { "2026-10-01": "on", "2026-10-02": "off", "2026-10-03": "partial" },
};

function fixture(t) {
  const db = database();
  t.after(() => db.sqlite.close());
  for (const [day, tab, initial, selected] of [
    ["2026-09-30", "dashboard_search", 5, 0],
    ["2026-10-01", "wiki", 3, 100], ["2026-10-01", "dashboard_search", 2, 200],
    ["2026-10-02", "news", 0, 999], ["2026-10-03", "statistics", 7, 400],
    ["2026-10-05", "sources", 4, 0],
  ]) db.sqlite.prepare("INSERT INTO usage_daily_tab (day, tab, initial_views, selected_views) VALUES (?, ?, ?, ?)").run(day, tab, initial, selected);
  return db;
}

test("방문 상세는 공개 누적과 같은 새 진입만 세고 메뉴 이동을 제외한다", async t => {
  const db = fixture(t);
  const summary = await readVisitSummary(db);
  const report = await buildVisitsReport(db, meta);
  assert.deepEqual(summary, { visits: 21, since: "2026-09-30" });
  assert.equal(report.total, summary.visits);
  assert.equal(report.current, 12);
  assert.equal(report.previous, 5);
  assert.deepEqual(report.entries, [{ tab: "statistics", visits: 7 }, { tab: "wiki", visits: 3 }, { tab: "dashboard_search", visits: 2 }]);
  assert.equal(report.entries.reduce((sum, row) => sum + row.visits, 0), report.current);
});

test("일별 누적은 기간 이전 방문을 포함하고 중간 빈 날짜를 채우며 종료일 이후를 제외한다", async t => {
  const report = await buildVisitsReport(fixture(t), meta);
  assert.equal(report.before, 5);
  assert.equal(report.throughEnd, 17);
  assert.deepEqual(report.series, [
    { day: "2026-10-01", visits: 5, cumulative: 10 },
    { day: "2026-10-02", visits: 0, cumulative: 10 },
    { day: "2026-10-03", visits: 7, cumulative: 17 },
  ]);
});

test("기간을 하루로 바꿔도 전체 누적은 유지하고 그 날의 방문만 선택한다", async t => {
  const db = fixture(t);
  const report = await buildVisitsReport(db, { ...meta, from: "2026-10-03", to: "2026-10-03" });
  assert.equal(report.total, 21);
  assert.equal(report.current, 7);
  assert.equal(report.before, 10);
  assert.deepEqual(report.series, [{ day: "2026-10-03", visits: 7, cumulative: 17 }]);
});

test("수집 자료가 없어도 날짜별 빈 집계와 시작일 미확인을 반환한다", async t => {
  const db = database();
  t.after(() => db.sqlite.close());
  const report = await buildVisitsReport(db, meta);
  assert.equal(report.total, 0);
  assert.equal(report.since, null);
  assert.equal(report.throughEnd, 0);
  assert.deepEqual(report.entries, []);
  assert.equal(report.series.length, 3);
  assert.ok(report.series.every(row => row.visits === 0 && row.cumulative === 0));
});

test("방문 상세 조회는 기존 집계를 쓰거나 변경하지 않는다", async t => {
  const db = fixture(t);
  const before = db.sqlite.prepare("SELECT total_changes() AS count").get().count;
  await buildVisitsReport(db, meta);
  assert.equal(db.sqlite.prepare("SELECT total_changes() AS count").get().count, before);
});

test("방문 CSV는 같은 기간의 일별 값과 누적 값 및 메뉴별 합계를 내보낸다", async t => {
  const csv = reportToCsv(await buildVisitsReport(fixture(t), meta));
  assert.ok(csv.includes("21,2026-09-30,12,5,5,17"));
  assert.ok(csv.includes("2026-10-01,수집,5,10"));
  assert.ok(csv.includes("2026-10-03,일부 수집,7,17"));
  assert.ok(csv.includes("복지통계,7"));
});
