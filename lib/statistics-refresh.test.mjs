import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

import { database } from "./press-test-support.mjs";
import { STATISTICS_DATASETS, verifiedStatistics } from "./statistics/catalog.ts";
import { STATISTICS_HIGHLIGHT_IDS } from "./statistics/highlights.ts";
import { runStatisticsRefresh } from "./statistics/background.ts";
import {
  claimStatisticsWorker, currentStatisticsStatus, publishedResults,
  readCurrentStatistics, readCurrentStatisticsSnapshots, readStatisticsView,
  releaseStatisticsWorker, STATISTICS_DAY, STATISTICS_HOUR, STATISTICS_SCOPE_IDS,
} from "./statistics/store.ts";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const NATIONAL_ID = "stat:2760";
const SOURCE = verifiedStatistics(NATIONAL_ID).dataset;
const scope = (db, id = NATIONAL_ID) => db.sqlite.prepare("SELECT * FROM statistics_refresh_scope WHERE scope_id = ?").get(id);
const worker = db => db.sqlite.prepare("SELECT * FROM statistics_refresh_worker WHERE id = 1").get();
const latestCount = result => result.dataset.series[0].points.at(-1).value;
const escapeHtml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

// Transmission fixtures preserve the verified source's row identities and values.
// Corrections/new periods are test-only inputs and never alter the source evidence.
function nationalHtml({ dataset = SOURCE, periods = dataset.periods, lastValue } = {}) {
  const header = periods.map(period => `<th>${escapeHtml(period)}</th>`).join("");
  const rows = dataset.series.map((series, rowIndex) => {
    const values = periods.map((period, periodIndex) => {
      const point = series.points.find(point => point.period === period) ?? series.points.at(-1);
      const raw = rowIndex === 0 && periodIndex === periods.length - 1 && lastValue !== undefined ? String(lastValue) : point.raw;
      return `<td>${escapeHtml(raw)}</td>`;
    }).join("");
    return `<tr><th>${escapeHtml(series.source_label)}</th>${values}</tr>`;
  }).join("");
  return `<h1>${escapeHtml(dataset.table_title)}</h1><p>[단위 : ${escapeHtml(dataset.original_unit)}]</p>` +
    `<table><thead><tr><th></th>${header}</tr></thead><tbody>${rows}</tbody></table>` +
    `<p>출처: ${escapeHtml(dataset.source_name)}</p><p>주석: ${escapeHtml(dataset.source_notes)}</p>`;
}

function testDatabase(t) {
  const db = database();
  t.after(() => db.sqlite.close());
  return db;
}

async function refreshFixture(t, activeScopes = [NATIONAL_ID]) {
  const db = testDatabase(t);
  const clock = { now: NOW };
  assert.ok(await claimStatisticsWorker(db, clock.now, "fixture-setup"));
  await releaseStatisticsWorker(db, "fixture-setup");
  db.sqlite.prepare("UPDATE statistics_refresh_scope SET next_check_at = ?").run(NOW + 100 * STATISTICS_DAY);
  for (const id of activeScopes) db.sqlite.prepare("UPDATE statistics_refresh_scope SET next_check_at = 0 WHERE scope_id = ?").run(id);
  const calls = [];
  const sleeps = [];
  const context = {
    db, clock, calls, sleeps,
    robots: () => new Response("", { status: 404 }),
    source: () => new Response(nationalHtml(), { headers: { "content-type": "text/html" } }),
    run(extra = {}) {
      return runStatisticsRefresh(db, {
        now: () => clock.now,
        sleep: async milliseconds => { sleeps.push(milliseconds); clock.now += milliseconds; },
        fetcher: async (url, init) => {
          calls.push({ url, at: clock.now, init });
          return new URL(url).pathname === "/robots.txt" ? context.robots(url, init) : context.source(url, init);
        },
        timeoutMs: 100,
        ...extra,
      });
    },
    dataCalls() { return calls.filter(call => new URL(call.url).pathname !== "/robots.txt"); },
    due() { clock.now = Math.max(clock.now, ...activeScopes.map(id => scope(db, id).next_check_at)); },
  };
  return context;
}

function publication(db, id = NATIONAL_ID) {
  const row = scope(db, id);
  return { result_json: row.result_json, revision: row.revision, last_success_at: row.last_success_at,
    latest_period: row.latest_period, checked_at: publishedResults(row)[0]?.checked_at };
}

test("새 통계 저장소의 첫 조회는 쓰기·원문 호출 없이 검증본 10종을 유지한다", async t => {
  const db = testDatabase(t);
  const initialChanges = db.sqlite.prepare("SELECT total_changes() AS count").get().count;
  t.mock.method(globalThis, "fetch", () => { throw new Error("A statistics read must not fetch a source"); });
  const results = await readCurrentStatisticsSnapshots(db, NOW);
  assert.equal(results.length, 53);
  assert.deepEqual(results.map(result => result.dataset.id), STATISTICS_DATASETS.filter(dataset => !dataset.kosis || STATISTICS_HIGHLIGHT_IDS.has(dataset.id)).map(dataset => dataset.id));
  for (const result of results) {
    assert.deepEqual(result.dataset, verifiedStatistics(result.dataset.id).dataset);
    assert.equal(result.state, "VERIFIED_SNAPSHOT");
    assert.equal(result.auto_refresh?.status ?? "idle", "idle");
    assert.equal(result.auto_refresh?.last_success_at ?? null, null);
  }
  assert.equal((await currentStatisticsStatus(db)).automatic_refresh.scope_count, 76);
  assert.equal(db.sqlite.prepare("SELECT total_changes() AS count").get().count, initialChanges);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM statistics_refresh_scope").get().count, 0);
  assert.equal(worker(db), undefined);
});

test("통계 마이그레이션이 아직 없을 때도 고정 확인본과 설정 필요 상태를 읽을 수 있다", async t => {
  const db = testDatabase(t);
  db.sqlite.exec("DROP TABLE statistics_refresh_scope; DROP TABLE statistics_refresh_worker;");
  const result = await readCurrentStatistics(db, NATIONAL_ID, {}, NOW);
  assert.equal(result.state, "SNAPSHOT_FALLBACK");
  assert.equal(result.refresh_error, "STATISTICS_STORAGE_UNAVAILABLE");
  assert.equal(result.auto_refresh.status, "unavailable");
  assert.deepEqual(result.dataset, SOURCE);
  assert.equal((await readCurrentStatisticsSnapshots(db, NOW)).length, 53);
  assert.equal((await currentStatisticsStatus(db)).automatic_refresh.storage_available, false);
  const pinned = await readCurrentStatistics(db, NATIONAL_ID, { mode: "verified" }, NOW);
  assert.equal(pinned.state, "VERIFIED_SNAPSHOT");
  assert.equal(pinned.auto_refresh.enabled, false);
});

test("중간 저장 자료가 있어도 실행권이 없으면 확인 중이 아닌 재시도 또는 이어받기 대기다", async t => {
  // Given a checkpoint from an interrupted source request.
  const fixture = await refreshFixture(t);
  const { db, clock } = fixture;
  db.sqlite.prepare("UPDATE statistics_refresh_scope SET stage_json = ?, error_code = 'SOURCE_TIMEOUT', next_check_at = ? WHERE scope_id = ?")
    .run('{"checkpoint":true}', NOW + STATISTICS_HOUR, NATIONAL_ID);
  // When the public status reads a saved checkpoint, a live lease, and an expired lease.
  const waiting = await readCurrentStatistics(db, NATIONAL_ID, {}, clock.now);
  await claimStatisticsWorker(db, clock.now, "status-check");
  db.sqlite.prepare("UPDATE statistics_refresh_worker SET active_scope = ? WHERE id = 1").run(NATIONAL_ID);
  const running = await readCurrentStatistics(db, NATIONAL_ID, {}, clock.now);
  clock.now += 30_000;
  const expired = await readCurrentStatistics(db, NATIONAL_ID, {}, clock.now);
  db.sqlite.prepare("UPDATE statistics_refresh_scope SET error_code = NULL WHERE scope_id = ?").run(NATIONAL_ID);
  const continuation = await readCurrentStatistics(db, NATIONAL_ID, {}, clock.now);
  const previous = verifiedStatistics(NATIONAL_ID);
  db.sqlite.prepare("UPDATE statistics_refresh_scope SET result_json = ?, revision = ?, latest_period = ?, last_success_at = ? WHERE scope_id = ?")
    .run(JSON.stringify([previous]), previous.revision, previous.dataset.periods.at(-1), NOW - STATISTICS_DAY, NATIONAL_ID);
  const continuationWithPrevious = await readCurrentStatistics(db, NATIONAL_ID, {}, clock.now);
  // Then only a live worker is checking, and checkpoints never hide an error or a due check.
  assert.equal(waiting.auto_refresh.status, "retry_wait");
  assert.equal(running.auto_refresh.status, "checking");
  assert.equal(expired.auto_refresh.status, "retry_wait");
  assert.equal(continuation.auto_refresh.status, "idle");
  assert.equal(continuation.auto_refresh.continuation_pending, true);
  assert.equal(continuationWithPrevious.auto_refresh.status, "idle");
  assert.equal(continuationWithPrevious.auto_refresh.continuation_pending, true);
  assert.equal(continuationWithPrevious.dataset.series[0].points.at(-1).value, previous.dataset.series[0].points.at(-1).value);
  assert.equal((await readCurrentStatistics(db, NATIONAL_ID, {}, NOW + STATISTICS_HOUR)).auto_refresh.check_due, true);
});

test("robots 거부·읽기 실패는 표 요청을 0회로 막고 검증본과 재시도 시각을 보존한다", async t => {
  for (const [status, body, expected] of [
    [200, "User-agent: *\nDisallow: /", "ROBOTS_DISALLOWED"],
    [503, "upstream-private-error-details", "ROBOTS_UNAVAILABLE"],
    [200, "<html>temporary source error</html>", "ROBOTS_UNAVAILABLE"],
  ]) await t.test(expected + ":" + status, async t => {
    const fixture = await refreshFixture(t);
    fixture.robots = () => new Response(body, { status });
    const summary = await fixture.run();
    assert.equal(summary.failed, 1);
    assert.equal(summary.completed, 0);
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.dataCalls().length, 0);
    const row = scope(fixture.db);
    assert.equal(row.error_code, expected);
    assert.equal(row.next_check_at, fixture.clock.now + STATISTICS_HOUR);
    assert.equal(row.last_success_at, null);
    assert.equal(row.result_json, null);
    const result = await readCurrentStatistics(fixture.db, NATIONAL_ID, {}, fixture.clock.now);
    assert.equal(result.state, "SNAPSHOT_FALLBACK");
    assert.equal(result.refresh_error, expected);
    assert.equal(result.checked_at, verifiedStatistics(NATIONAL_ID).checked_at);
    assert.equal(latestCount(result), latestCount(verifiedStatistics(NATIONAL_ID)));
    assert.doesNotMatch(JSON.stringify(result), /upstream-private|temporary source error/);
    const noRetry = await fixture.run();
    assert.equal(noRetry.completed + noRetry.failed, 0);
    assert.equal(fixture.calls.length, 1);
  });
});

test("성공 자료는 D1에 저장되고 24시간 동안 다른 실행도 원문을 다시 요청하지 않는다", async t => {
  const fixture = await refreshFixture(t);
  const { db, clock } = fixture;
  db.sqlite.prepare("INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?)").run("statistics-test:preserve", "operational-setting", NOW);
  const existingSettings = db.sqlite.prepare("SELECT * FROM app_setting ORDER BY key").all();
  const existingPressSources = db.sqlite.prepare("SELECT * FROM press_source ORDER BY source_id").all();
  const summary = await fixture.run();
  assert.deepEqual(summary, { status: "advanced", completed: 1, failed: 0, staged: 0 });
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.dataCalls().length, 1);
  assert.ok(fixture.dataCalls()[0].at - fixture.calls[0].at >= 3_000);
  assert.ok(fixture.calls.every(call => call.init.redirect === "manual" && call.init.signal instanceof AbortSignal));
  assert.ok(fixture.calls.every(call => !/LAW_OC|api[_-]?key|idntfcId/i.test(call.url)));
  const saved = publication(db);
  const next = scope(db).next_check_at;
  assert.equal(next, saved.last_success_at + STATISTICS_DAY);
  assert.equal(saved.checked_at, new Date(saved.last_success_at).toISOString());
  assert.match(saved.revision, /^public-table:276001:/);
  assert.equal(worker(db).lease_token, null);
  assert.equal((await readStatisticsView(db)).rows.length, STATISTICS_SCOPE_IDS.length);
  const current = await readCurrentStatistics(db, NATIONAL_ID, {}, clock.now);
  assert.equal(current.state, "CACHED");
  assert.equal(current.auto_refresh.status, "current");
  assert.equal(current.revision, saved.revision);
  assert.equal(latestCount(current), 2837);
  for (const at of [clock.now, next - 1]) {
    clock.now = at;
    assert.equal((await fixture.run()).status, "current");
    assert.deepEqual(publication(db), saved);
    assert.equal(fixture.calls.length, 2);
  }
  clock.now = next;
  assert.equal((await fixture.run()).completed, 1);
  assert.equal(fixture.dataCalls().length, 2);
  assert.ok(scope(db).last_success_at > saved.last_success_at);
  assert.equal(scope(db).revision, saved.revision, "동일 원문은 동일 내용 revision을 유지한다");
  assert.deepEqual(db.sqlite.prepare("SELECT * FROM app_setting ORDER BY key").all(), existingSettings);
  assert.deepEqual(db.sqlite.prepare("SELECT * FROM press_source ORDER BY source_id").all(), existingPressSources);
});

test("원문 500 실패는 마지막 정상값·확인시각을 유지하고 1시간→2시간 재시도 뒤 회복한다", async t => {
  const fixture = await refreshFixture(t);
  await fixture.run();
  const saved = publication(fixture.db);
  fixture.source = () => new Response("upstream-private-stack", { status: 500 });
  for (const [failureCount, delay] of [[1, STATISTICS_HOUR], [2, 2 * STATISTICS_HOUR]]) {
    fixture.due();
    assert.equal((await fixture.run()).failed, 1);
    assert.deepEqual(publication(fixture.db), saved);
    const row = scope(fixture.db);
    assert.equal(row.failure_count, failureCount);
    assert.equal(row.error_code, "SOURCE_UNAVAILABLE");
    assert.equal(row.next_check_at, fixture.clock.now + delay);
    const result = await readCurrentStatistics(fixture.db, NATIONAL_ID, {}, fixture.clock.now);
    assert.equal(result.auto_refresh.status, "retry_wait");
    assert.equal(result.auto_refresh.last_success_at, saved.checked_at);
    assert.equal(result.checked_at, saved.checked_at);
    assert.equal(result.revision, saved.revision);
    assert.equal(latestCount(result), 2837);
    assert.doesNotMatch(JSON.stringify(result), /upstream-private-stack/);
    const callsBefore = fixture.calls.length;
    await fixture.run();
    assert.equal(fixture.calls.length, callsBefore);
  }
  fixture.source = () => new Response(nationalHtml({ lastValue: 2840 }));
  fixture.due();
  assert.equal((await fixture.run()).completed, 1);
  assert.equal(scope(fixture.db).failure_count, 0);
  assert.equal(scope(fixture.db).error_code, null);
  assert.equal(latestCount(await readCurrentStatistics(fixture.db, NATIONAL_ID, {}, fixture.clock.now)), 2840);
  assert.equal(scope(fixture.db).next_check_at, fixture.clock.now + STATISTICS_DAY);
});

test("응답 헤더 뒤 본문이 멈춰도 요청 제한시간에 중단하고 마지막 성공 자료를 보존한다", async t => {
  const fixture = await refreshFixture(t);
  await fixture.run();
  const saved = publication(fixture.db);
  fixture.due();
  let aborted = false, cancelled = false;
  fixture.source = (_url, init) => {
    init.signal.addEventListener("abort", () => { aborted = true; }, { once: true });
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("<h1>incomplete table</h1>")); },
      cancel() { cancelled = true; },
    }));
  };
  const result = await fixture.run({ timeoutMs: 10 });
  assert.equal(result.failed, 1);
  assert.equal(scope(fixture.db).error_code, "SOURCE_TIMEOUT");
  assert.equal(aborted, true);
  assert.equal(cancelled, true);
  assert.deepEqual(publication(fixture.db), saved);
  assert.equal(scope(fixture.db).next_check_at, fixture.clock.now + STATISTICS_HOUR);
  assert.equal(worker(fixture.db).lease_token, null);
});

test("서로 다른 Worker 실행의 전역 lease가 중복 원문 요청을 차단한다", async t => {
  const fixture = await refreshFixture(t);
  const entered = Promise.withResolvers();
  const response = Promise.withResolvers();
  fixture.source = () => { entered.resolve(); return response.promise; };
  const first = fixture.run({ timeoutMs: 1_000 });
  await entered.promise;
  const firstToken = worker(fixture.db).lease_token;
  assert.ok(firstToken);
  assert.equal(worker(fixture.db).active_scope, NATIONAL_ID);
  const second = await fixture.run();
  assert.equal(second.status, "busy_or_current");
  assert.equal(second.completed + second.failed, 0);
  assert.equal(fixture.dataCalls().length, 1);
  assert.equal(worker(fixture.db).lease_token, firstToken);
  response.resolve(new Response(nationalHtml()));
  assert.equal((await first).completed, 1);
  assert.equal(worker(fixture.db).lease_token, null);
});

test("lease가 만료된 늦은 원문 결과는 게시하거나 새 Worker의 실행권을 해제할 수 없다", async t => {
  const fixture = await refreshFixture(t);
  const entered = Promise.withResolvers();
  const response = Promise.withResolvers();
  fixture.source = () => { entered.resolve(); return response.promise; };
  const first = fixture.run({ timeoutMs: 1_000 });
  await entered.promise;
  fixture.clock.now = worker(fixture.db).lease_expires_at + 1;
  assert.ok(await claimStatisticsWorker(fixture.db, fixture.clock.now, "replacement-worker"));
  response.resolve(new Response(nationalHtml({ lastValue: 9000 })));
  assert.equal((await first).status, "lease_lost");
  assert.equal(scope(fixture.db).result_json, null);
  assert.equal(scope(fixture.db).last_success_at, null);
  assert.equal(worker(fixture.db).lease_token, "replacement-worker");
  await releaseStatisticsWorker(fixture.db, "replacement-worker");
  assert.equal(worker(fixture.db).lease_token, null);
});

test("D1 최신 기준연도보다 과거 원문은 거절하고 같은 기준연도의 정정은 원자적으로 교체한다", async t => {
  const fixture = await refreshFixture(t);
  const newerPeriods = [...SOURCE.periods, "2026"];
  fixture.source = () => new Response(nationalHtml({ periods: newerPeriods, lastValue: 3000 }));
  assert.equal((await fixture.run()).completed, 1);
  const first = publication(fixture.db);
  assert.equal(first.latest_period, "2026");
  fixture.due();
  fixture.source = () => new Response(nationalHtml());
  assert.equal((await fixture.run()).failed, 1);
  assert.equal(scope(fixture.db).error_code, "SOURCE_PERIOD_REGRESSION");
  assert.deepEqual(publication(fixture.db), first);
  assert.equal(latestCount(await readCurrentStatistics(fixture.db, NATIONAL_ID, {}, fixture.clock.now)), 3000);
  fixture.due();
  fixture.source = () => new Response(nationalHtml({ periods: newerPeriods, lastValue: 3012 }));
  assert.equal((await fixture.run()).completed, 1);
  const corrected = publication(fixture.db);
  assert.equal(corrected.latest_period, first.latest_period);
  assert.notEqual(corrected.revision, first.revision);
  assert.equal(scope(fixture.db).previous_json, first.result_json);
  assert.ok(corrected.last_success_at > first.last_success_at);
  assert.equal(scope(fixture.db).error_code, null);
  assert.equal(latestCount(await readCurrentStatistics(fixture.db, NATIONAL_ID, {}, fixture.clock.now)), 3012);
});

test("원문의 연도창이 줄어도 이미 게시한 과거 관측값을 지우지 않는다", async t => {
  const fixture = await refreshFixture(t);
  await fixture.run();
  const prior = publishedResults(scope(fixture.db))[0];
  fixture.due();
  fixture.source = () => new Response(nationalHtml({ periods: ["2025", "2026"], lastValue: 3000 }));
  assert.equal((await fixture.run()).completed, 1);
  const current = await readCurrentStatistics(fixture.db, NATIONAL_ID, {}, fixture.clock.now);
  assert.deepEqual(current.dataset.periods, [...SOURCE.periods, "2026"]);
  for (const series of prior.dataset.series) {
    const replacement = current.dataset.series.find(item => item.id === series.id);
    for (const point of series.points) assert.deepEqual(replacement.points.find(item => item.period === point.period), point);
  }
  assert.equal(latestCount(current), 3000);
});

test("재시도 간격은 24시간까지 늘어나며 전역 시간 예산이 끝나면 다음 접속에서 이어간다", async t => {
  const fixture = await refreshFixture(t);
  fixture.source = () => new Response("temporary error", { status: 500 });
  for (const delayHours of [1, 2, 4, 8, 16, 24, 24]) {
    fixture.due();
    assert.equal((await fixture.run()).failed, 1);
    assert.equal(scope(fixture.db).next_check_at - fixture.clock.now, delayHours * STATISTICS_HOUR);
  }
  fixture.due();
  const callsBefore = fixture.calls.length;
  const saved = publication(fixture.db);
  assert.equal((await fixture.run({ budgetMs: 350 })).completed, 0);
  assert.equal(fixture.calls.length, callsBefore, "남은 전체 시간보다 요청 제한시간이 길면 새 요청을 시작하지 않는다");
  assert.deepEqual(publication(fixture.db), saved);
  assert.equal(worker(fixture.db).lease_token, null);
  fixture.source = () => new Response(nationalHtml());
  assert.equal((await fixture.run()).completed, 1);
});

test("허용된 표도 미래 연도·다른 곳으로의 이동·과대 응답은 게시하지 않는다", async t => {
  for (const [name, source, errorCode] of [
    ["future period", () => new Response(nationalHtml({ periods: ["2026", "2027"] })), "SOURCE_FUTURE_PERIOD"],
    ["redirect", () => new Response(null, { status: 302, headers: { location: "https://unlisted.example/source" } }), "SOURCE_REDIRECTED"],
    ["oversized", () => new Response("", { headers: { "content-length": String(1024 * 1024 + 1) } }), "SOURCE_TOO_LARGE"],
  ]) await t.test(name, async t => {
    const fixture = await refreshFixture(t);
    fixture.source = source;
    assert.equal((await fixture.run()).failed, 1);
    assert.equal(scope(fixture.db).error_code, errorCode);
    assert.equal(scope(fixture.db).result_json, null);
    assert.equal(fixture.dataCalls().length, 1);
    assert.ok(fixture.calls.every(call => new URL(call.url).origin === "https://www.index.go.kr"));
  });
});

test("손상된 게시 JSON과 부분 인구 1종은 현재 자료로 노출하지 않는다", async t => {
  const fixture = await refreshFixture(t);
  await fixture.run();
  fixture.db.sqlite.prepare("UPDATE statistics_refresh_scope SET result_json = ? WHERE scope_id = ?").run("{incomplete-json", NATIONAL_ID);
  const result = await readCurrentStatistics(fixture.db, NATIONAL_ID, {}, fixture.clock.now);
  assert.equal(result.refresh_error, "STATISTICS_STORAGE_INVALID");
  assert.equal(result.auto_refresh.status, "unavailable");
  assert.equal(result.auto_refresh?.last_success_at ?? null, null);
  assert.deepEqual(result.dataset, SOURCE);
  const population = verifiedStatistics("population:children");
  fixture.db.sqlite.prepare("UPDATE statistics_refresh_scope SET result_json = ?, revision = ?, latest_period = ?, last_success_at = ? WHERE scope_id = 'population:mois'")
    .run(JSON.stringify([population]), population.revision, population.dataset.periods.at(-1), NOW);
  const results = await readCurrentStatisticsSnapshots(fixture.db, fixture.clock.now);
  for (const item of results.filter(result => result.dataset.population)) {
    assert.equal(item.refresh_error, "STATISTICS_STORAGE_INVALID");
    assert.deepEqual(item.dataset, verifiedStatistics(item.dataset.id).dataset);
  }
});

test("실제 API·MCP·초기 화면 조회가 D1의 같은 수치·revision을 읽으며 조회로 원문을 요청하지 않는다", async t => {
  const fixture = await refreshFixture(t);
  fixture.source = () => new Response(nationalHtml({ periods: [...SOURCE.periods, "2026"], lastValue: 3012 }));
  assert.equal((await fixture.run()).completed, 1);
  t.mock.method(globalThis, "fetch", () => { throw new Error("Read handlers must use their durable publication"); });

  // Keep the real route, getD1(), parsers and store; only provide the Worker DB
  // binding and the repository's existing TypeScript path resolution in Node.
  globalThis.statisticsRefreshFixtureDb = fixture.db;
  const root = new URL("../", import.meta.url);
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "cloudflare:workers") return {
        url: "data:text/javascript,export const env = { get DB() { return globalThis.statisticsRefreshFixtureDb; } };",
        shortCircuit: true,
      };
      if (specifier.startsWith("@/")) {
        const url = new URL(specifier.slice(2) + ".ts", root);
        if (existsSync(url)) return { url: url.href, shortCircuit: true };
      }
      if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
        const url = new URL(specifier + ".ts", context.parentURL);
        if (existsSync(url)) return { url: url.href, shortCircuit: true };
      }
      return next(specifier, context);
    },
  });
  t.after(() => { hooks.deregister(); delete globalThis.statisticsRefreshFixtureDb; });
  const { GET } = await import("../app/api/statistics/route.ts");
  const { registerStatisticsTools } = await import("./mcp/statistics-tools.ts");
  const { loadCurrentStatisticsSnapshots } = await import("./statistics/current.ts");
  const handlers = new Map();
  registerStatisticsTools({
    db: fixture.db,
    register: (name, _title, _description, _shape, handler) => handlers.set(name, handler),
    wrap: async (data, options) => ({ data, options }),
  });
  async function api(query) {
    const response = await GET(new Request("https://dashboard.example/api/statistics?" + query));
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.ok, true);
    return body;
  }

  const frozenNow = Date.now();
  t.mock.method(Date, "now", () => frozenNow);
  const { ok: _ok, ...apiResult } = await api("id=stat%3A2760");
  const mcp = await handlers.get("get_statistics_data")({ statistics_id: NATIONAL_ID });
  assert.deepEqual(mcp.data, apiResult);
  assert.equal(latestCount(apiResult), 3012, "새 D1 값은 고정 확인본의 2,837과 구분된다");
  assert.equal(apiResult.dataset.periods.at(-1), "2026");
  assert.equal(apiResult.revision, scope(fixture.db).revision);
  assert.equal(apiResult.state, "CACHED");
  assert.equal(mcp.options.evidence[0].checked_at, apiResult.checked_at);
  const current = await api("view=current");
  const initial = await loadCurrentStatisticsSnapshots();
  assert.equal(current.results.length, 53);
  assert.deepEqual(current.results, initial);
  assert.deepEqual(current.results.find(result => result.dataset.id === NATIONAL_ID), apiResult);
  const status = await api("view=status");
  const sources = await handlers.get("get_statistics_sources")({ statistics_id: NATIONAL_ID });
  assert.deepEqual(sources.data.automatic_refresh, status.status.automatic_refresh);
  assert.equal(status.status.automatic_refresh.successful_tables, 1);
  assert.equal(status.status.automatic_refresh.trigger, "website_requests_and_registered_pc_wake");

  const selected = await api("id=stat%3A2760&from_year=2026&to_year=2026&series_id=row-1");
  assert.deepEqual(selected.dataset.periods, ["2026"]);
  assert.equal(selected.dataset.series.length, 1);
  assert.equal(latestCount(selected), 3012);
  const pinned = await api("id=stat%3A2760&mode=verified");
  assert.equal(latestCount(pinned), 2837);
  assert.equal(pinned.state, "VERIFIED_SNAPSHOT");
  assert.equal(pinned.auto_refresh.enabled, false);
  assert.equal(fixture.dataCalls().length, 1, "여러 화면·도구 조회는 수집을 중복 실행하지 않는다");
});

test("overdue successful publications expose delay without losing the last verified result", async t => {
  // Given: a successful publication whose next check was missed.
  const fixture = await refreshFixture(t);
  await fixture.run();
  const dueAt = scope(fixture.db).next_check_at;
  // When: the same publication is read an hour after its due time.
  const result = await readCurrentStatistics(fixture.db, NATIONAL_ID, {}, dueAt + STATISTICS_HOUR);
  // Then: consumers can distinguish overdue data while retaining its value.
  assert.equal(result.auto_refresh.check_due, true);
  assert.equal(result.auto_refresh.overdue_seconds, 3600);
  assert.equal(result.auto_refresh.failure_count, 0);
  assert.equal(latestCount(result), latestCount(verifiedStatistics(NATIONAL_ID)));
});
