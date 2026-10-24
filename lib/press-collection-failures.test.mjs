import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { collectPressSource } from "./press/collect.ts";
import { timedPressFetcher } from "./press/fetch.ts";
import { readCrawlState } from "./press/store.ts";
import { SOURCE_ID, collectionFixture, feedXml, response, url } from "./press-test-support.mjs";

const setup = () => collectionFixture([{ title: "복지부, 지역사회 통합돌봄 시범사업 확대", link: url(101) }]);
const row = (db, sql) => db.sqlite.prepare(sql).get();

test("5xx 응답 연결을 버리고 다음 예약 시도까지 재요청하지 않는다", async (t) => {
  const { db, source, ctx } = await setup();
  const signals = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    signals.push(options.signal);
    return signals.length === 1
      ? new Response(new ReadableStream(), { status: 503 })
      : new Response(feedXml([{ title: "통합돌봄 지원 확대", link: url(101) }]));
  });
  ctx.deps.fetcher = timedPressFetcher(7000);
  ctx.deps.robotsFetcher = async () => response(404);
  const summary = await collectPressSource(db, { source, trigger: "manual" }, ctx.deps);

  assert.equal(summary.status, "failed");
  assert.equal(summary.errorCode, "SERVER_ERROR");
  assert.equal(signals.length, 1);
  assert.equal(signals[0].aborted, true);
  assert.ok(row(db, "SELECT next_due_at FROM press_crawl_state").next_due_at >= ctx.clock.now + 30);
});

test("응답 본문 읽기가 취소되어도 실패와 재시도 시각을 기록하고 기존 자료를 보존한다", async () => {
  const { db, ctx, run } = await setup();
  await run();
  const before = await readCrawlState(db, SOURCE_ID);
  const itemCount = row(db, "SELECT COUNT(*) AS n FROM press_item").n;
  ctx.clock.now += 3600;
  ctx.next = () => ({ ...response(200), text: async () => { throw new DOMException("The operation was aborted", "AbortError"); } });

  const summary = await run();

  assert.equal(summary.status, "failed");
  assert.equal(summary.errorCode, "BODY_READ_TIMEOUT", "본문 읽기 취소는 연결 실패와 구분한다");
  const state = await readCrawlState(db, SOURCE_ID);
  assert.equal(state.consecutiveFailures, 1);
  const persisted = row(db, "SELECT next_due_at, lease_token FROM press_crawl_state");
  assert.ok(persisted.next_due_at > ctx.clock.now);
  assert.equal(persisted.lease_token, "");
  assert.equal(row(db, "SELECT lease_token FROM press_host_lease").lease_token, "");
  assert.equal(state.lastSuccessAt, before.lastSuccessAt);
  assert.equal(state.latestItemDate, before.latestItemDate);
  assert.equal(state.lastItemCount, before.lastItemCount);
  assert.equal(row(db, "SELECT COUNT(*) AS n FROM press_item").n, itemCount);
  assert.equal(row(db, "SELECT error_code FROM press_collection_run ORDER BY started_at DESC").error_code, "BODY_READ_TIMEOUT");
});

test("전체 수집 시간에 재시도 간격이 들어가지 않으면 반복 요청하지 않고 실패를 기록한다", async () => {
  const { db, ctx, calls, run } = await setup();
  ctx.deps.deadlineAt = ctx.clock.now + 5;
  ctx.deps.sleep = async (milliseconds) => { ctx.clock.now += milliseconds / 1000; };
  ctx.next = () => response(503);

  const summary = await run();

  assert.equal(summary.status, "failed");
  assert.equal(calls.length, 1);
  assert.equal(summary.errorCode, "SERVER_ERROR", "기관의 5xx 실패와 차단 정책을 보존한다");
  assert.equal(row(db, "SELECT COUNT(*) AS n FROM press_collection_run WHERE status = 'failed'").n, 1);
});

test("기관 대기 간격이 전체 마감보다 길면 기다리거나 목록을 요청하지 않고 기록한다", async () => {
  const { db, source, ctx, calls } = await setup();
  ctx.deps.deadlineAt = ctx.clock.now + 22;
  ctx.deps.sleep = async () => { assert.fail("마감을 넘는 대기는 시작하지 않는다"); };

  const summary = await collectPressSource(db, { source: { ...source, requestIntervalSec: 60 }, trigger: "scheduled" }, ctx.deps);

  assert.equal(summary.errorCode, "TIME_BUDGET_EXCEEDED");
  assert.equal(calls.length, 0);
  assert.equal(row(db, "SELECT COUNT(*) AS n FROM press_collection_run WHERE status = 'failed'").n, 1);
});

test("실제 통신 래퍼를 거친 취소도 robots·목록·본문 경계에서 기록까지 처리한다", async (t) => {
  for (const phase of ["robots", "feed", "body"]) {
    const { db, ctx, run } = await setup();
    const cancellation = runInNewContext('Object.assign(new Error("The operation was aborted"), { name: "AbortError" })');
    const cancel = () => { throw cancellation; };
    t.mock.method(globalThis, "fetch", async (address) => {
      if (address.endsWith("/robots.txt")) return phase === "robots" ? cancel() : new Response(null, { status: 404 });
      if (phase === "feed") return cancel();
      if (phase === "body") return new Response(new ReadableStream({ start(controller) { controller.error(cancellation); } }));
      return new Response(feedXml([{ title: "통합돌봄 안내", link: url(101) }]));
    });
    ctx.deps.fetcher = timedPressFetcher(1000);
    ctx.deps.robotsFetcher = timedPressFetcher(1000);
    const summary = await run();
    assert.equal(summary.status, phase === "robots" ? "succeeded" : "failed", phase);
    assert.equal(summary.errorCode, { robots: "", feed: "RESPONSE_TIMEOUT", body: "BODY_READ_TIMEOUT" }[phase], phase);
    assert.equal(row(db, "SELECT COUNT(*) AS n FROM press_collection_run").n, 1);
    if (phase === "robots") assert.equal(row(db, "SELECT robots_status FROM press_collection_run").robots_status, "CHECK_ERROR");
    assert.equal(row(db, "SELECT lease_token FROM press_crawl_state").lease_token, "");
    assert.equal(row(db, "SELECT lease_token FROM press_host_lease").lease_token, "");
  }
});
