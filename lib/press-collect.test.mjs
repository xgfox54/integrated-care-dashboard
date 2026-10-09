import assert from "node:assert/strict";
import test from "node:test";

import { setPressApproval } from "./press/admin.ts";
import { collectPressSource } from "./press/collect.ts";
import { claimCrawlLease, listDueSources, readCrawlState } from "./press/store.ts";
import { BODY_MARKER, NOW, SOURCE_ID, collectDeps, collectionFixture, database, feedXml, response, sourceOf, url } from "./press-test-support.mjs";

const WELFARE = { title: "복지부, 지역사회 통합돌봄 시범사업 확대", link: url(101) };
const REVIEW = { title: "보건복지부, 신규 지원 안내", link: url(102) };
const OTHER = { title: "복지부 장관 해외 출장", link: url(103) };

async function setup(feed = [WELFARE, REVIEW, OTHER]) {
  return collectionFixture(feed);
}

const rows = (db, sql) => db.sqlite.prepare(sql).all();

test("수집 때마다 robots.txt를 다시 읽어, 그 사이 막혔으면 가져오지 않고 차단으로 기록한다", async () => {
  const { db, ctx, calls, run } = await setup();
  ctx.robots = () => response(200, "User-agent: *\nDisallow: /rss/");
  const summary = await run();
  assert.equal(summary.status, "failed");
  assert.equal(summary.errorCode, "ROBOTS_DISALLOWED");
  assert.equal(calls.length, 0, "피드를 요청하지 않는다");
  assert.equal(rows(db, "SELECT technical_status FROM press_source WHERE source_id = '" + SOURCE_ID + "'")[0].technical_status, "BLOCKED");
  ctx.robots = () => response(401, "<html>blocked</html>");
  ctx.clock.now += 100_000;
  assert.equal((await run()).status, "succeeded", "robots를 읽을 수 없으면 등록 때 판단을 유지한다");
});

test("첫 수집: 중복·허용 밖 링크를 걸러 저장하고 분류별로 센다", async () => {
  const { db, run } = await setup([WELFARE, REVIEW, OTHER, WELFARE, { title: "악성 링크", link: "https://evil.example/a" }]);
  const summary = await run();
  assert.equal(summary.status, "succeeded");
  assert.deepEqual(summary.counts, { feedItems: 5, created: 3, updated: 0, unchanged: 0, rejected: 1, welfare: 1, review: 1, nonWelfare: 1 });
  const items = rows(db, "SELECT * FROM press_item ORDER BY canonical_url");
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((item) => item.public_status).sort(), ["HIDDEN", "HIDDEN", "PUBLIC"]);
  const everything = JSON.stringify(items);
  for (const forbidden of [BODY_MARKER, "담당자이름", "evil.example"]) assert.ok(!everything.includes(forbidden), forbidden);
  const state = await readCrawlState(db, SOURCE_ID);
  assert.equal(state.lastSuccessAt, NOW);
  assert.equal(state.latestItemDate, "2026-10-02");
  assert.equal(state.lastItemCount, 5);
  assert.equal(rows(db, "SELECT technical_status FROM press_source")[0].technical_status, "NORMAL");
});

test("같은 피드를 다시 받아도 중복 저장하지 않고, 제목이 바뀐 항목만 갱신한다", async () => {
  const { db, ctx, run } = await setup();
  await run();
  // 같은 기관 서버는 요청 간격(3초 이상)이 지나야 다시 부른다.
  ctx.clock.now += 10;
  const again = await run();
  assert.equal(again.counts.created, 0);
  assert.equal(again.counts.updated, 0);
  assert.equal(again.counts.unchanged, 3);
  ctx.clock.now += 10;
  ctx.next = () => response(200, feedXml([{ ...WELFARE, title: "복지부, 지역사회 통합돌봄 시범사업 전국 확대" }, REVIEW, OTHER]));
  const changed = await run();
  assert.equal(changed.counts.updated, 1);
  assert.equal(changed.counts.created, 0);
  const row = rows(db, "SELECT title, title_version FROM press_item WHERE title LIKE '%전국 확대'")[0];
  assert.equal(row.title_version, 2);
  assert.equal(rows(db, "SELECT COUNT(*) AS n FROM press_item")[0].n, 3);
});

test("304이면 새 글 0건과 성공을 구분해 기록하고 이전 상태를 유지한다", async () => {
  const { db, ctx, calls, run } = await setup();
  ctx.next = () => response(200, feedXml([WELFARE]), { etag: '"v1"', "last-modified": "Fri, 02 Oct 2026 07:50:00 GMT" });
  await run();
  ctx.clock.now += 3600;
  ctx.next = () => response(304);
  const summary = await run();
  assert.equal(summary.status, "not_modified");
  assert.equal(calls.at(-1).headers["if-none-match"], '"v1"');
  const state = await readCrawlState(db, SOURCE_ID);
  assert.equal(state.lastItemCount, 1);
  assert.equal(state.lastSuccessAt, NOW + 3600);
  assert.equal(rows(db, "SELECT COUNT(*) AS n FROM press_item")[0].n, 1);
});

test("접근 거부·429·이전·서버 오류·네트워크 오류는 안전한 코드로 기록하고 기존 자료를 지우지 않는다", async () => {
  const { db, ctx, calls, run } = await setup();
  await run();
  const before = rows(db, "SELECT COUNT(*) AS n FROM press_item")[0].n;
  const cases = [
    [() => response(403), "ACCESS_DENIED", "BLOCKED", 1],
    [() => response(429, "", { "retry-after": "7200" }), "RATE_LIMITED", "BLOCKED", 1],
    [() => response(301, "", { location: "https://other.example/" }), "URL_CHANGED", "URL_CHANGED", 1],
    [() => response(503), "SERVER_ERROR", "ERROR", 2],
    [() => { throw new TypeError("fetch failed"); }, "NETWORK_ERROR", "ERROR", 2],
  ];
  for (const [next, code, technical, attempts] of cases) {
    ctx.clock.now += 100_000;
    ctx.next = next;
    const callsBefore = calls.length;
    const summary = await run();
    assert.equal(summary.status, "failed");
    assert.equal(summary.errorCode, code);
    assert.equal(calls.length - callsBefore, attempts, code);
    assert.equal(rows(db, "SELECT technical_status FROM press_source")[0].technical_status, technical);
    assert.equal(rows(db, "SELECT COUNT(*) AS n FROM press_item")[0].n, before);
  }
  const state = await readCrawlState(db, SOURCE_ID);
  assert.equal(state.consecutiveFailures, 5);
  assert.equal(state.lastSuccessAt, NOW);
});

test("같은 주소로 다시 보내는 3xx(세션 쿠키 심기)는 주소 변경으로 보지 않고 다시 요청한다", async () => {
  const { db, source, ctx, calls, run } = await setup();
  let n = 0;
  ctx.next = () => (n++ === 0 ? response(302, "", { location: source.endpointUrl }) : response(200, feedXml([WELFARE])));
  const summary = await run();
  assert.equal(summary.status, "succeeded");
  assert.equal(calls.length, 2);
  assert.equal(rows(db, "SELECT technical_status FROM press_source")[0].technical_status, "NORMAL");
  ctx.clock.now += 100_000;
  ctx.next = () => response(302, "", { location: source.endpointUrl });
  const looping = await run();
  assert.equal(looping.errorCode, "SAME_URL_REDIRECT");
});

test("200이어도 0건·RSS 아님·필드 누락은 파서 오류로 보류하고 체크포인트를 옮기지 않는다", async () => {
  const { db, ctx, run } = await setup();
  await run();
  const invalid = Array.from({ length: 5 }, (_, index) => ({ title: `항목 ${index}`, link: `https://evil.example/${index}` }));
  const cases = [
    [feedXml([]), "FEED_EMPTY"],
    ["<html>점검 중입니다</html>", "FEED_NOT_RSS"],
    [feedXml(invalid), "FEED_FIELD_DRIFT"],
  ];
  for (const [body, code] of cases) {
    ctx.clock.now += 100_000;
    ctx.next = () => response(200, body);
    const summary = await run();
    assert.equal(summary.errorCode, code);
    assert.equal(rows(db, "SELECT technical_status FROM press_source")[0].technical_status, "PARSER_ERROR");
  }
  const state = await readCrawlState(db, SOURCE_ID);
  assert.equal(state.lastSuccessAt, NOW);
  assert.equal(state.lastItemCount, 3);
  assert.equal(rows(db, "SELECT COUNT(*) AS n FROM press_item")[0].n, 3);
});

test("다른 실행이 실행권을 잡고 있으면 수집하지 않고, 실행권이 만료되면 이어받는다", async () => {
  const { db, source, calls, ctx, run } = await setup();
  assert.equal(await claimCrawlLease(db, SOURCE_ID, "other", NOW), true);
  const skipped = await run();
  assert.equal(skipped.status, "skipped_locked");
  assert.equal(calls.length, 0);
  ctx.clock.now += 121;
  assert.equal((await collectPressSource(db, { source, trigger: "scheduled" }, ctx.deps)).status, "succeeded");
});

test("수집 대상은 승인되고 켜졌으며 수집 시각이 지난 Source뿐이다", async () => {
  const db = database();
  assert.equal((await listDueSources(db, NOW, 5)).length, 0);
  await setPressApproval(db, SOURCE_ID, "approve", NOW);
  assert.equal((await listDueSources(db, NOW, 5)).length, 1);
  const source = await sourceOf(db);
  const { deps } = collectDeps(async () => response(200, feedXml([WELFARE])));
  await collectPressSource(db, { source, trigger: "scheduled" }, deps);
  // NOW는 한국시간 13:00이므로 다음 정기 시각은 15:00(NOW + 2시간)이다.
  assert.equal((await listDueSources(db, NOW + 60, 5)).length, 0);
  assert.equal((await listDueSources(db, NOW + 7199, 5)).length, 0);
  assert.equal((await listDueSources(db, NOW + 7200, 5)).length, 1);
  await setPressApproval(db, SOURCE_ID, "revoke", NOW);
  assert.equal((await listDueSources(db, NOW + 7200, 5)).length, 0);
});


test("같은 호스트를 쓰는 다른 Source가 동시에 수집되면 하나는 호스트 실행권 때문에 건너뛰고, 끝나면 실행권을 돌려준다", async () => {
  const { claimHostLease, readSource } = await import("./press/store.ts");
  const db = database();
  const { deps } = collectDeps(async (address) => (address.endsWith("/robots.txt") ? response(404) : response(200, feedXml([{ title: "통합돌봄 안내", link: "https://www.mohw.go.kr/board.es?mid=a10503000000&bid=0027&list_no=9&act=view" }]))));
  db.sqlite.prepare("UPDATE press_source SET approval_status = 'POLICY_APPROVED', enabled = 1 WHERE source_id = ?").run(SOURCE_ID);
  const source = await readSource(db, SOURCE_ID);
  assert.equal(await claimHostLease(db, "www.mohw.go.kr", "other-run", deps.now()), true, "다른 Source 실행이 같은 호스트를 잡고 있다");
  const busy = await collectPressSource(db, { source, trigger: "manual" }, deps);
  assert.equal(busy.status, "skipped_host_busy");
  assert.equal(db.sqlite.prepare("SELECT lease_token FROM press_crawl_state WHERE source_id = ?").get(SOURCE_ID).lease_token, "", "Source 실행권도 돌려준다");
  db.sqlite.prepare("UPDATE press_host_lease SET lease_expires_at = 0").run();
  const done = await collectPressSource(db, { source, trigger: "manual" }, deps);
  assert.equal(done.status, "succeeded");
  assert.equal(db.sqlite.prepare("SELECT lease_token FROM press_host_lease WHERE host = 'www.mohw.go.kr'").get().lease_token, "");
});



test("원천 목록 보유창을 수집마다 측정하고, 정기 수집 간격보다 짧거나 빠듯하면 위험 Source로 표시한다", async () => {
  const { assessRetention, readPressCoverage } = await import("./press/coverage.ts");
  const { MAX_SCHEDULE_GAP_HOURS } = await import("./press/schedule.ts");
  assert.equal(MAX_SCHEDULE_GAP_HOURS, 15, "18시 → 다음 날 09시");
  // 2026-10-04 실측: 보건복지부 RSS 30건·102.9시간, 부산 RSS 10건·24시간.
  assert.equal(assessRetention(30, "2026-09-28T00:57:00.000Z", "2026-10-02T07:50:00.000Z").assessment, "WINDOW_COVERS_GAP");
  assert.equal(assessRetention(10, "2026-09-30T15:00:00.000Z", "2026-10-01T15:00:00.000Z").assessment, "CAPACITY_TIGHT", "15시간에 약 6건 예상 → 목록 10건의 절반 이상");
  assert.equal(assessRetention(5, "2026-10-01T00:00:00.000Z", "2026-10-01T10:00:00.000Z").assessment, "WINDOW_SHORTER_THAN_GAP");
  assert.equal(assessRetention(10, "2026-10-01", "2026-10-01").precision, "date_upper_bound");
  assert.equal(assessRetention(0, "", "").assessment, "UNMEASURED");
  const db = database();
  const { deps } = collectDeps(async (address) => (address.endsWith("/robots.txt") ? response(404) : response(200, feedXml([
    { title: "통합돌봄 안내 1", link: url(1), pubDate: "Mon, 28 Sep 2026 01:00:00 GMT" },
    { title: "통합돌봄 안내 2", link: url(2), pubDate: "Fri, 02 Oct 2026 07:50:00 GMT" },
  ]))));
  db.sqlite.prepare("UPDATE press_source SET approval_status = 'POLICY_APPROVED', enabled = 1 WHERE source_id = ?").run(SOURCE_ID);
  await collectPressSource(db, { source: await sourceOf(db), trigger: "manual" }, deps);
  const state = db.sqlite.prepare("SELECT window_items, window_oldest, window_newest FROM press_crawl_state WHERE source_id = ?").get(SOURCE_ID);
  assert.deepEqual({ ...state }, { window_items: 2, window_oldest: "2026-09-28T01:00:00.000Z", window_newest: "2026-10-02T07:50:00.000Z" });
  const coverage = await readPressCoverage(db, NOW);
  const mohw = coverage.sources.find((source) => source.source_id === SOURCE_ID);
  assert.equal(mohw.retention_window.span_hours, 102.8);
  assert.equal(mohw.retention_window.precision, "timestamp");
  assert.match(coverage.retention.note, /전수 수집을 보장하지 않으며/);
});


test("운영자 예외 근거가 있는 Source만 robots.txt가 막은 목록도 수집하고, 점검 기록에는 원래 판정과 예외 표시를 남긴다", async () => {
  const { db, ctx, calls } = await setup();
  ctx.robots = () => response(200, "User-agent: *\nDisallow: /");
  db.sqlite.prepare("UPDATE press_source SET robots_exempt = '운영자 지시(시험)' WHERE source_id = ?").run(SOURCE_ID);
  const exempt = await sourceOf(db);
  const summary = await collectPressSource(db, { source: exempt, trigger: "manual" }, ctx.deps);
  assert.equal(summary.status, "succeeded");
  assert.equal(calls.length, 1, "예외 Source는 막힌 경로도 요청한다");
  const audit = rows(db, "SELECT robots_status FROM press_collection_run WHERE source_id = '" + SOURCE_ID + "' ORDER BY started_at DESC LIMIT 1")[0];
  assert.match(audit.robots_status, /OPERATOR_EXEMPT/);
});

test("기관 웹방화벽 차단 화면이 오면 게시물 없음으로 반복하지 않고 차단으로 멈추며, robots.txt 자리의 차단 화면은 '읽지 못함'으로 본다", async () => {
  const waf = "<br>\r\n<br>\r\n<center>\r\n<h2>\r\nThe request / response that are contrary to the Web firewall security policies have been blocked.\r\n</h2>\r\n</center>";
  const { db, ctx, run } = await setup();
  ctx.robots = () => response(200, waf);
  ctx.next = () => response(200, waf);
  const summary = await run();
  assert.equal(summary.status, "failed");
  assert.equal(summary.errorCode, "WAF_BLOCKED");
  // 서버가 막힌 것이면 멈추지 않고 PC 중계 수집으로 넘긴다(다음 PC 수집 때 바로 가져오게 next_due_at = 0).
  const state = rows(db, "SELECT collection_hold, next_due_at FROM press_crawl_state WHERE source_id = '" + SOURCE_ID + "'")[0];
  assert.equal(state.collection_hold, "");
  assert.equal(state.next_due_at, 0);
  assert.equal(rows(db, "SELECT collect_via FROM press_source WHERE source_id = '" + SOURCE_ID + "'")[0].collect_via, "relay");
  const audit = rows(db, "SELECT robots_status FROM press_collection_run WHERE source_id = '" + SOURCE_ID + "' ORDER BY started_at DESC LIMIT 1")[0];
  assert.equal(audit.robots_status, "CHECK_ERROR");
});
