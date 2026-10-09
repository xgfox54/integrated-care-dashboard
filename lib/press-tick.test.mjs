import assert from "node:assert/strict";
import test from "node:test";
import { setCrawlerEnabled } from "./press/operations.ts";
import { networkFailureCode, collectPressSource } from "./press/collect.ts";
import { readPressCoverage } from "./press/coverage.ts";
import { previousCollectionSlot } from "./press/schedule.ts";
import { readSchedulerSignal, runPressTick, pickTickBatch } from "./press/tick.ts";
import { NOW, SOURCE_ID, collectionFixture, feedXml, response } from "./press-test-support.mjs";

// 작업지시서 2026-10-08 P0: 방문 요청 없이 인증된 정기 수집 호출로 대기열을 처리하고, 실행권·호스트 간격·공정성·상태 기록을 지킨다.

const COLUMNS = "organization_id, source_kind, method, adapter, homepage_url, interval_minutes, verification_status, verification_note, endpoint_verified_at, approval_status, policy_version, policy_basis, approved_at, technical_status, enabled, registry_version, adapter_profile, request_interval_sec, board_name, copyright_type, public_nuri_type, reuse_allowed, robots_exempt, collect_via";
const row = (db, sql, ...values) => db.sqlite.prepare(sql).get(...values);

function addSource(db, id, host) {
  db.sqlite.prepare("INSERT INTO press_source (source_id, endpoint_url, allowed_hosts, " + COLUMNS + ") SELECT ?, ?, ?, " + COLUMNS + " FROM press_source WHERE source_id = ?")
    .run(id, "https://" + host + "/press/rss", JSON.stringify([host]), SOURCE_ID);
}

async function fixture(extra = []) {
  const base = await collectionFixture([]);
  for (const [id, host] of extra) addSource(base.db, id, host);
  const fetched = [];
  base.ctx.next = (address) => {
    fetched.push(address);
    const host = new URL(address).host;
    return response(200, feedXml([{ title: "통합돌봄 지원 확대 " + host, link: "https://" + host + "/news/1" }, { title: "노인 돌봄 강화 " + host, link: "https://" + host + "/news/2" }]
      .map((item) => host === "www.mohw.go.kr" ? { ...item, link: "https://www.mohw.go.kr/board.es?mid=a10503000000&amp;bid=0027&amp;list_no=" + item.link.slice(-1) + "&amp;act=view" } : item)));
  };
  const makeDeps = (deadlineAt) => ({ ...base.ctx.deps, deadlineAt });
  const now = () => base.ctx.clock.now;
  return { ...base, fetched, makeDeps, now };
}

test("대기열이 비면 NO_WORK만 기록하고 성공 시각·오류를 덮어쓰지 않는다", async () => {
  const { db, makeDeps, now } = await fixture();
  db.sqlite.prepare("INSERT INTO press_crawl_state (source_id, next_due_at, safe_error, consecutive_failures) VALUES (?, ?, 'NETWORK_ERROR', 2)").run(SOURCE_ID, NOW + 3600);
  const result = await runPressTick(db, "laptop", makeDeps, now);
  assert.equal(result.status, "NO_WORK");
  assert.equal(result.attempted, 0);
  assert.equal(row(db, "SELECT COUNT(*) AS n FROM press_collection_run").n, 0);
  const state = row(db, "SELECT last_success_at, safe_error, consecutive_failures FROM press_crawl_state WHERE source_id = ?", SOURCE_ID);
  assert.deepEqual([state.last_success_at, state.safe_error, state.consecutive_failures], [0, "NETWORK_ERROR", 2]);
  const signal = await readSchedulerSignal(db);
  assert.equal(signal.status, "NO_WORK");
  assert.equal(signal.lastWorkAt, null);
});

test("방문 요청 없이 정기 수집 호출 한 번으로 여러 기관을 처리하고, 같은 호스트는 한 묶음에 하나만 넣는다", async () => {
  const { db, ctx, makeDeps, now, fetched } = await fixture([["src:a1", "a.example.go.kr"], ["src:a2", "a.example.go.kr"], ["src:b1", "b.example.go.kr"]]);
  const result = await runPressTick(db, "laptop", makeDeps, now);
  assert.equal(result.status, "PROCESSED");
  assert.equal(result.attempted, 3);
  assert.equal(result.succeeded, 3);
  assert.equal(result.remainingDue, 1, "요청 간격이 남은 같은 호스트 소스는 다음 호출로 넘긴다");
  ctx.clock.now += 4;
  const next = await runPressTick(db, "laptop", makeDeps, now);
  assert.deepEqual([next.attempted, next.succeeded, next.remainingDue], [1, 1, 0]);
  assert.equal(fetched.filter((address) => address.includes("a.example.go.kr")).length, 2);
  // a1·a2는 같은 기관 서버의 같은 원문 주소를 내므로 먼저 본 소스의 항목 하나만 둔다(소스 간 중복 제거).
  assert.equal(row(db, "SELECT COUNT(*) AS n FROM press_item").n, 6);
  assert.equal(row(db, "SELECT COUNT(DISTINCT canonical_url) AS n FROM press_item").n, 6);
  assert.equal(row(db, "SELECT COUNT(*) AS n FROM press_collection_run WHERE trigger = 'scheduled' AND status = 'succeeded'").n, 4);
  // 같은 호스트의 실행권은 요청 간격(3초 이상)만큼 다음 실행을 막은 채 반납된다.
  assert.ok(row(db, "SELECT lease_expires_at FROM press_host_lease WHERE host = 'a.example.go.kr'").lease_expires_at >= NOW + 3);
  const signal = await readSchedulerSignal(db);
  assert.deepEqual([signal.status, signal.by, signal.attempted, signal.lastWorkAt], ["PROCESSED", "laptop", 1, NOW + 4]);
});

test("같은 호스트 소스는 묶음 선택 단계에서 겹치지 않고, 실패를 반복하는 소스는 정상 회차 작업 뒤로 간다", () => {
  const source = (sourceId, host, retrying = false) => ({ sourceId, endpointUrl: "https://" + host + "/list", retrying });
  const batch = pickTickBatch([source("old-retry", "r.go.kr", true), source("x1", "x.go.kr"), source("x2", "x.go.kr"), source("y1", "y.go.kr")], 3, new Set());
  assert.deepEqual(batch.map((item) => item.sourceId), ["x1", "y1", "old-retry"]);
  assert.deepEqual(pickTickBatch([source("old-retry", "r.go.kr", true), source("x1", "x.go.kr")], 1, new Set()).map((item) => item.sourceId), ["x1"]);
});

test("두 PC가 동시에 정기 수집을 불러도 같은 소스를 두 번 수집하거나 중복 저장하지 않는다", async () => {
  const { db, makeDeps, now } = await fixture([["src:a1", "a.example.go.kr"], ["src:b1", "b.example.go.kr"]]);
  const [left, right] = await Promise.all([runPressTick(db, "laptop", makeDeps, now), runPressTick(db, "desktop", makeDeps, now)]);
  const runs = db.sqlite.prepare("SELECT source_id, COUNT(*) AS n FROM press_collection_run GROUP BY source_id").all();
  assert.ok(runs.every((item) => item.n === 1), JSON.stringify(runs));
  assert.equal(runs.length, 3);
  assert.equal(left.succeeded + right.succeeded, 3);
  assert.equal(row(db, "SELECT COUNT(*) AS n FROM press_item").n, 6);
  assert.equal(row(db, "SELECT COUNT(DISTINCT canonical_url) AS n FROM press_item").n, 6);
});

test("기간이 끝난 5xx 일시 중지는 다시 수집하고, 아직 유효한 중지는 건드리지 않는다", async () => {
  const { db, makeDeps, now } = await fixture([["src:a1", "a.example.go.kr"]]);
  const hold = db.sqlite.prepare("INSERT INTO press_crawl_state (source_id, collection_hold, hold_until, hold_reason, consecutive_failures, safe_error) VALUES (?, 'SERVER_PAUSED', ?, '5xx', 3, 'SERVER_ERROR')");
  hold.run(SOURCE_ID, NOW - 1);
  hold.run("src:a1", NOW + 3600);
  const result = await runPressTick(db, "laptop", makeDeps, now);
  assert.deepEqual(result.sources.map((item) => item.sourceId), [SOURCE_ID]);
  assert.equal(row(db, "SELECT collection_hold FROM press_crawl_state WHERE source_id = ?", SOURCE_ID).collection_hold, "");
  assert.equal(row(db, "SELECT collection_hold FROM press_crawl_state WHERE source_id = 'src:a1'").collection_hold, "SERVER_PAUSED");
  const coverage = await readPressCoverage(db, NOW);
  assert.equal(coverage.schedule.scheduler.server_due_backlog, 0, "유효한 중지는 대기열 적체로 세지 않는다");
  assert.equal(coverage.schedule.current_slot.server.held, 1);
});

test("관리자 전체 수집 스위치가 꺼져 있으면 기관 서버에 요청하지 않는다", async () => {
  const { db, makeDeps, now, fetched } = await fixture();
  await setCrawlerEnabled(db, false, NOW);
  const result = await runPressTick(db, "laptop", makeDeps, now);
  assert.equal(result.status, "CRAWLER_DISABLED");
  assert.equal(fetched.length, 0);
});

test("DB 저장이 실패하면 DB_WRITE_FAILED로 남기고 성공 시각·기준점을 옮기지 않는다", async () => {
  const { db, ctx, source } = await fixture();
  const batch = db.batch.bind(db);
  db.batch = async (statements) => {
    if (statements.some((statement) => statement.sql.startsWith("INSERT INTO press_item"))) throw new Error("D1_ERROR: storage unavailable");
    return batch(statements);
  };
  const summary = await collectPressSource(db, { source, trigger: "scheduled" }, ctx.deps);
  assert.equal(summary.status, "failed");
  assert.equal(summary.errorCode, "DB_WRITE_FAILED");
  const state = row(db, "SELECT last_success_at, latest_item_date, last_seen_post_id, lease_token, next_due_at FROM press_crawl_state WHERE source_id = ?", SOURCE_ID);
  assert.deepEqual([state.last_success_at, state.latest_item_date, state.last_seen_post_id, state.lease_token], [0, "", "", ""]);
  assert.ok(state.next_due_at > NOW);
  assert.equal(row(db, "SELECT COUNT(*) AS n FROM press_item").n, 0);
  assert.equal(row(db, "SELECT error_code FROM press_collection_run").error_code, "DB_WRITE_FAILED");
});

test("통신 실패는 응답 대기 시간 초과·본문 읽기·DNS·TLS·기타 연결 실패로 나눈다", () => {
  const named = (name) => Object.assign(new Error("aborted"), { name });
  assert.equal(networkFailureCode(named("TimeoutError"), "connect"), "RESPONSE_TIMEOUT");
  assert.equal(networkFailureCode(named("AbortError"), "body"), "BODY_READ_TIMEOUT");
  assert.equal(networkFailureCode(new TypeError("Network connection lost."), "body"), "BODY_READ_FAILED");
  assert.equal(networkFailureCode(new TypeError("TLS handshake failed: certificate unknown"), "connect"), "TLS_ERROR");
  assert.equal(networkFailureCode(new TypeError("DNS lookup failed"), "connect"), "DNS_ERROR");
  assert.equal(networkFailureCode(new TypeError("fetch failed"), "connect"), "NETWORK_ERROR");
});

test("회차 기준 시각은 지금 이하의 가장 최근 09·12·15·18시(한국시간)다", () => {
  const kst = (text) => Date.parse(text + "+09:00") / 1000;
  assert.equal(previousCollectionSlot(kst("2026-10-09T00:21:00")), kst("2026-10-08T18:00:00"));
  assert.equal(previousCollectionSlot(kst("2026-10-09T09:00:00")), kst("2026-10-09T09:00:00"));
  assert.equal(previousCollectionSlot(kst("2026-10-09T14:59:59")), kst("2026-10-09T12:00:00"));
  assert.equal(previousCollectionSlot(kst("2026-10-09T08:59:59")), kst("2026-10-08T18:00:00"));
});

test("상태 API는 스케줄러 신호·회차별 처리·기관 기준 성공과 현재 정상을 따로 보여 준다", async () => {
  const { db, makeDeps, now } = await fixture([["src:a1", "a.example.go.kr"]]);
  const before = await readPressCoverage(db, NOW);
  assert.equal(before.schedule.scheduler.last_signal_status, "NEVER");
  assert.equal(before.schedule.scheduler.stale, true);
  assert.equal(before.schedule.scheduler.server_due_backlog, 2);
  await runPressTick(db, "laptop", makeDeps, now);
  const after = await readPressCoverage(db, NOW + 60);
  assert.equal(after.schedule.mode, "pc_scheduler_with_request_fallback");
  assert.equal(after.schedule.scheduler.last_signal_status, "PROCESSED");
  assert.equal(after.schedule.scheduler.stale, false);
  assert.equal(after.schedule.scheduler.server_due_backlog, 0);
  assert.equal(after.schedule.current_slot.server.succeeded, 2);
  assert.equal(after.coverage.organizations_success_24h, after.coverage.approved_active_organizations);
});
