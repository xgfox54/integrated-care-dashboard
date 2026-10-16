import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { database } from "./press-test-support.mjs";
import { STATISTICS_DATASETS, statisticsCatalog, verifiedStatistics } from "./statistics/catalog.ts";
import { INDEX_API_SERIES } from "./statistics/index-verified-data.ts";
import { indexApiUrl, parseIndexApi } from "./statistics/index-api.ts";
import { runStatisticsRefresh } from "./statistics/background.ts";
import { claimStatisticsWorker, releaseStatisticsWorker, readCurrentStatistics, STATISTICS_DAY, STATISTICS_HOUR } from "./statistics/store.ts";

const fixtures = JSON.parse(readFileSync(new URL("../docs/statistics/index-api-fixtures-2026-10-11.json", import.meta.url)));
const NOW = Date.parse("2026-10-11T12:00:00Z");
const dataset = id => verifiedStatistics(id).dataset;
const clone = id => structuredClone(fixtures[id]);

test("실제 지표누리 응답 17종의 대표 표·모든 항목과 복합 단위를 검증한다", () => {
  assert.equal(Object.keys(INDEX_API_SERIES).length, 32);
  assert.equal(statisticsCatalog().filter(item => item.data_provider === "index").length, 32);
  for (const [id, rows] of Object.entries(fixtures)) {
    const expected = dataset(id), result = parseIndexApi(JSON.stringify(rows), expected, NOW);
    assert.equal(result.series.length, expected.series.length, id);
    assert.equal(result.periods.at(-1), expected.periods.at(-1), id);
    assert.deepEqual(result.series.map(s => s.unit), expected.series.map(s => s.unit));
    assert.ok(result.series.every(s => new Set(s.points.map(p => p.period)).size === s.points.length));
    assert.ok(result.index_api.updated_at);
  }
  const insurance = parseIndexApi(JSON.stringify(fixtures["stat:2763"]), dataset("stat:2763"), NOW);
  assert.equal(insurance.series.at(-1).unit, "%");
  assert.equal(insurance.series[0].unit, "조원");
  assert.equal(insurance.series[0].points.filter(p => p.period === "2023").length, 1);
  assert.equal(parseIndexApi(JSON.stringify(fixtures["stat:2759"]), dataset("stat:2759"), NOW).series[0].points.at(-1).status, "PROVISIONAL");
  assert.ok(parseIndexApi(JSON.stringify(fixtures["stat:1430"]), dataset("stat:1430"), NOW).series[0].points.every(p => p.status === "ESTIMATE"));
  assert.ok(dataset("stat:2764").series.some(s => s.points.some(p => p.value < 0)));
});

test("서비스에서 뺀 정신장애 유병률은 목록·자동 확인·수치 조회 어디에도 남지 않는다", async () => {
  assert.equal(INDEX_API_SERIES["stat:1441"], undefined);
  assert.ok(!STATISTICS_DATASETS.some(item => item.id === "stat:1441"));
  assert.ok(!statisticsCatalog().some(item => item.title === "정신장애 유병률" || item.dataset_id === "stat:1441"));
  await assert.rejects(readCurrentStatistics(database(), "stat:1441", {}, NOW));
});

test("잘못된 표·단위·항목·주기·중복 관측·누락 항목은 저장하지 않는다", () => {
  for (const [name, edit] of [
    ["table", rows => { rows[0]["통계표코드"] = "999999"; }],
    ["unit", rows => { rows[0]["단위"] = "명"; }],
    ["identity", rows => { rows[0]["항목코드"] = "T99"; }],
    ["frequency", rows => { rows[0]["주기코드"] = "M"; }],
    ["period", rows => { rows[0]["시점"] = "2099"; }],
    ["duplicate", rows => rows.push({ ...rows[0] })],
    ["source", rows => { rows[0]["출처"] = ""; }],
    ["value", rows => { rows[0]["값"] = "NaN"; }],
    ["missing-series", rows => rows.splice(0, rows.filter(r => r["항목코드"] === "T01").length)],
  ]) {
    const rows = clone("stat:2760"); edit(rows);
    assert.throws(() => parseIndexApi(JSON.stringify(rows), dataset("stat:2760"), NOW), /확인|형식/, name);
  }
  assert.throws(() => parseIndexApi("private-provider-token-TESTKEY", dataset("stat:2760")), error => !error.message.includes("TESTKEY"));
});

test("결측·비공개·0을 구분하고 부분 연도 결측을 만들어 0으로 채우지 않는다", () => {
  const rows = clone("stat:2760");
  rows[0]["값"] = "0"; rows[1]["값"] = null; rows[2]["값"] = "x";
  rows.splice(3, 1);
  const points = parseIndexApi(JSON.stringify(rows), dataset("stat:2760"), NOW).series[0].points;
  assert.equal(points[0].value, 0);
  assert.equal(points[1].status, "MISSING"); assert.equal(points[1].value, null);
  assert.equal(points[2].status, "CONFIDENTIAL");
  assert.equal(points[3].status, "MISSING"); assert.equal(points[3].value, null);
});

async function scopedDatabase(t, id) {
  const db = database(); t.after(() => db.sqlite.close());
  await claimStatisticsWorker(db, NOW, "setup"); await releaseStatisticsWorker(db, "setup");
  db.sqlite.prepare("UPDATE statistics_refresh_scope SET next_check_at = ?").run(NOW + 100 * STATISTICS_DAY);
  db.sqlite.prepare("UPDATE statistics_refresh_scope SET next_check_at = 0 WHERE scope_id = ?").run(id);
  db.sqlite.prepare("UPDATE statistics_refresh_worker SET host_state_json = ?").run(JSON.stringify({ "https://www.index.go.kr": { api_enabled: true, next_request_at: 0 } }));
  return db;
}

test("등록 키로 API를 한 번 호출하고 D1·조회 응답에는 키와 요청 URL을 저장하지 않는다", async t => {
  const db = await scopedDatabase(t, "stat:2768");
  const calls = [], key = "fixture-only+key/with=padding";
  const run = extra => runStatisticsRefresh(db, { now: () => NOW, readIndexKey: async () => key, timeoutMs: 100,
    fetcher: async (url, init) => { calls.push({ url, init }); return Response.json(fixtures["stat:2768"]); }, ...extra });
  assert.equal((await run()).completed, 1);
  assert.equal(calls.length, 1);
  const request = new URL(calls[0].url);
  assert.equal(request.pathname, "/unity/openApi/sttsJsonViewer.do");
  assert.equal(request.searchParams.get("idntfcId"), key);
  assert.equal(request.searchParams.get("statsCode"), "276801");
  assert.equal(request.searchParams.get("period"), "2016:2027");
  assert.equal(calls[0].init.redirect, "manual");
  const row = db.sqlite.prepare("SELECT * FROM statistics_refresh_scope WHERE scope_id = ?").get("stat:2768");
  assert.match(row.revision, /^index-api:276801:/);
  assert.equal(row.next_check_at, NOW + STATISTICS_DAY);
  const result = await readCurrentStatistics(db, "stat:2768", {}, NOW);
  assert.equal(result.state, "CACHED"); assert.equal(result.dataset.series[0].points.at(-1).value, 2628);
  assert.doesNotMatch(JSON.stringify([row, result]), /fixture-only|idntfcId|sttsJsonViewer/);
  assert.equal((await run()).completed, 0); assert.equal(calls.length, 1);
  db.sqlite.prepare("UPDATE statistics_refresh_scope SET next_check_at = 0 WHERE scope_id = ?").run("stat:2768");
  assert.equal((await run({ fetcher: async () => new Response("private-key-stack", { status: 403 }) })).failed, 1);
  const failed = await readCurrentStatistics(db, "stat:2768", {}, NOW);
  assert.equal(failed.refresh_error, "SOURCE_ACCESS_DENIED");
  assert.equal(failed.revision, result.revision); assert.equal(failed.checked_at, result.checked_at);
});

test("키가 없거나 복호화에 실패하면 외부 호출 없이 확인본과 재시도 상태를 유지한다", async t => {
  for (const reader of [async () => null, async () => { throw new Error("private-secret"); }]) {
    const db = await scopedDatabase(t, "stat:2768"); let calls = 0;
    const result = await runStatisticsRefresh(db, { now: () => NOW, readIndexKey: reader, timeoutMs: 100,
      fetcher: async () => { calls++; throw new Error("unexpected fetch"); } });
    assert.equal(result.failed, 1); assert.equal(calls, 0);
    const read = await readCurrentStatistics(db, "stat:2768", {}, NOW);
    assert.match(read.refresh_error, /^SOURCE_KEY_(REQUIRED|UNAVAILABLE)$/);
    assert.equal(read.auto_refresh.status, "retry_wait");
    assert.equal(read.dataset.series[0].points.at(-1).value, 2628);
    assert.doesNotMatch(JSON.stringify(read), /private-secret/);
  }
  assert.throws(() => indexApiUrl(STATISTICS_DATASETS.find(d => d.population), "fixture"), /인증키/);
});

test("HTTP 200 평문 오류 문구는 인증키를 가린 짧은 원인으로 남기고 성공하면 지운다", async t => {
  const db = await scopedDatabase(t, "stat:2768");
  const key = "fixture-only-key";
  const run = fetcher => runStatisticsRefresh(db, { now: () => NOW, readIndexKey: async () => key, timeoutMs: 100, fetcher });
  assert.equal((await run(async () => new Response("<p>키 값이 일치하지 않습니다.</p> " + key))).failed, 1);
  const row = () => db.sqlite.prepare("SELECT error_code, error_detail, next_check_at FROM statistics_refresh_scope WHERE scope_id = ?").get("stat:2768");
  assert.equal(row().error_code, "SOURCE_KEY_REJECTED");
  assert.equal(row().next_check_at, NOW + STATISTICS_HOUR);
  assert.equal(row().error_detail, "키 값이 일치하지 않습니다. [KEY]");
  db.sqlite.prepare("UPDATE statistics_refresh_scope SET next_check_at = 0 WHERE scope_id = ?").run("stat:2768");
  assert.equal((await run(async () => Response.json(fixtures["stat:2768"]))).completed, 1);
  assert.equal(row().error_detail, null);
});

test("최초 API 응답 오류는 한 번만 빠르게 재시도하고 재실패·원천 대기는 정상 backoff를 지킨다", async t => {
  const db = await scopedDatabase(t, "stat:2764");
  let clock = NOW, calls = 0;
  const run = fetcher => runStatisticsRefresh(db, { now: () => clock, readIndexKey: async () => "fixture-only", timeoutMs: 100, fetcher });
  const failure = async () => { calls++; return new Response("temporary-provider-error", { status: 500 }); };
  assert.equal((await run(failure)).failed, 1);
  const row = () => db.sqlite.prepare("SELECT * FROM statistics_refresh_scope WHERE scope_id = ?").get("stat:2764");
  assert.equal(row().next_check_at, NOW + 30_000);
  clock += 29_999;
  await run(failure); assert.equal(calls, 1);
  clock++;
  assert.equal((await run(failure)).failed, 1);
  assert.equal(row().failure_count, 2);
  assert.equal(row().next_check_at, clock + 2 * STATISTICS_HOUR);
  clock += 30_000;
  await run(failure); assert.equal(calls, 2);
  clock = row().next_check_at;
  assert.equal((await run(async () => Response.json(fixtures["stat:2764"]))).completed, 1);
  assert.match(row().revision, /^index-api:276401:/);
  db.sqlite.prepare("UPDATE statistics_refresh_scope SET last_success_at = NULL, failure_count = 1, error_code = 'SOURCE_API_UNAVAILABLE', last_attempt_at = ?, next_check_at = ? WHERE scope_id = ?").run(clock - 60_000, clock + STATISTICS_HOUR, "stat:2764");
  assert.equal((await run(async () => Response.json(fixtures["stat:2764"]))).completed, 1);
  db.sqlite.prepare("UPDATE statistics_refresh_scope SET last_success_at = NULL, failure_count = 0, next_check_at = 0 WHERE scope_id = ?").run("stat:2764");
  assert.equal((await run(async () => new Response("wait", { status: 503, headers: { "retry-after": "7200" } }))).failed, 1);
  assert.equal(row().next_check_at, clock + 2 * STATISTICS_HOUR);
  clock += 30_000;
  let unexpected = 0;
  await run(async () => { unexpected++; return Response.json(fixtures["stat:2764"]); });
  assert.equal(unexpected, 0);
});

for (const [body, code, delay] of [["INVALIDKEY", "SOURCE_KEY_REJECTED", STATISTICS_HOUR], ["temporary provider message", "SOURCE_API_UNAVAILABLE", 30_000]]) {
  test(`plaintext ${body} is classified without inappropriate retry acceleration`, async t => {
    // Given a first API attempt with a plain-text provider error.
    const db = await scopedDatabase(t, "stat:2768");
    // When the provider returns HTTP 200 with the error body.
    await runStatisticsRefresh(db, { now: () => NOW, timeoutMs: 100, readIndexKey: async () => "fixture-only-key", fetcher: async () => new Response(body) });
    // Then only known authentication rejection suppresses the short first retry.
    const row = db.sqlite.prepare("SELECT * FROM statistics_refresh_scope WHERE scope_id = ?").get("stat:2768");
    assert.equal(row.error_code, code); assert.equal(row.next_check_at, NOW + delay);
  });
}
