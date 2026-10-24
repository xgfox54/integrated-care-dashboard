// 보도자료 수집 지침(2026-10-05) 37항 시험: robots 6종 분류·점검 기록·변경 이력, 요청 간격, 403·401·429·5xx·CAPTCHA 처리, Kill Switch, 지침 상태값.
import assert from "node:assert/strict";
import test from "node:test";

import { advanceRobotsAudit } from "./press/auto-approve.ts";
import { holdPressSource, resumePressHold, setPressApproval } from "./press/admin.ts";
import { collectPressSource, redactUrl, USER_AGENT } from "./press/collect.ts";
import { addCrawlBlock, guidelineStatus, robotsDiff, setCrawlerEnabled } from "./press/operations.ts";
import { analyzeRobots } from "./press/robots.ts";
import { listDueSources } from "./press/store.ts";
import { NOW, SOURCE_ID, collectDeps, database, feedXml, response, sourceOf, url } from "./press-test-support.mjs";

const BOARD = "/rss/board.es?mid=a10503000000&bid=0027";
const decide = (status, body, path = BOARD) => analyzeRobots(status, body, USER_AGENT, path).decision;

test("robots 6종 분류: 전체허용·일부(관리자·로그인·검색)차단·보도자료 경로 차단·전체 차단·없음·확인 오류", () => {
  assert.equal(decide(200, "User-agent: *\nAllow: /"), "ALLOW_ALL");
  assert.equal(decide(200, "User-agent: *\nDisallow:"), "ALLOW_ALL");
  const partial = "User-agent: *\nDisallow: /admin/\nDisallow: /member/\nDisallow: /login/\nDisallow: /search/";
  assert.equal(decide(200, partial), "ALLOW_PARTIAL", "관리자·로그인·검색만 막으면 보도자료 게시판은 수집한다");
  assert.equal(decide(200, partial, "/search/result.do?q=복지"), "TARGET_BLOCKED", "검색 경로 자체는 수집하지 않는다");
  assert.equal(decide(200, partial, "/admin/board.do"), "TARGET_BLOCKED", "관리자 경로 자체는 수집하지 않는다");
  const press = analyzeRobots(200, "User-agent: *\nDisallow: /rss/", USER_AGENT, BOARD);
  assert.deepEqual([press.decision, press.verdict, press.rule], ["TARGET_BLOCKED", "DISALLOWED", "Disallow: /rss/"]);
  const all = analyzeRobots(200, "User-agent: *\nDisallow: /", USER_AGENT, BOARD);
  assert.equal(all.decision, "BLOCK_ALL");
  assert.match(all.reason, /MANUAL_REVIEW/);
  assert.equal(decide(404, ""), "NO_ROBOTS");
  assert.equal(decide(null, ""), "CHECK_ERROR", "시간 초과");
  assert.equal(decide(503, ""), "CHECK_ERROR");
  assert.equal(decide(200, "<html><body>차단</body></html>"), "CHECK_ERROR");
  assert.equal(decide(200, "User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nAllow: /"), "ALLOW_ALL", "다른 봇 전용 금지는 우리에게 적용하지 않는다");
});

async function setup(feed = [{ title: "복지부, 지역사회 통합돌봄 확대", link: url(201) }]) {
  const db = database();
  assert.equal(await setPressApproval(db, SOURCE_ID, "approve", NOW), true);
  const source = await sourceOf(db);
  const calls = [];
  const sleeps = [];
  const ctx = collectDeps(async (address, headers) => {
    calls.push(address);
    if (address.endsWith("/robots.txt")) return ctx.robots ? ctx.robots() : response(404);
    return ctx.next ? ctx.next(address, headers) : response(200, feedXml(feed));
  }, { sleep: async (ms) => { sleeps.push(ms); } });
  const run = () => collectPressSource(db, { source, trigger: "manual" }, ctx.deps);
  const state = () => db.sqlite.prepare("SELECT * FROM press_crawl_state WHERE source_id = ?").get(SOURCE_ID);
  return { db, source, calls, sleeps, ctx, run, state };
}

test("robots.txt 점검 기록: 판정·해시·규칙을 남기고, 바뀌면 이전 내용과의 차이를 이력으로 남긴다. 시간 초과는 CHECK_ERROR로 남기고 진행한다", async () => {
  const { db, ctx, run } = await setup();
  ctx.robots = () => response(200, "User-agent: *\nDisallow: /admin/");
  assert.equal((await run()).status, "succeeded");
  let audit = db.sqlite.prepare("SELECT * FROM press_robots_audit").get();
  assert.equal(audit.domain, "www.mohw.go.kr");
  assert.equal(audit.decision, "ALLOW_PARTIAL");
  assert.equal(audit.user_agent, USER_AGENT);
  assert.ok(audit.robots_hash.length > 0);
  const run1 = db.sqlite.prepare("SELECT requested_url, robots_status, response_size, parser_result FROM press_collection_run").get();
  assert.equal(run1.robots_status, "ALLOW_PARTIAL");
  assert.ok(run1.response_size > 0);
  assert.equal(run1.parser_result, "OK 1건");
  assert.match(run1.requested_url, /^https:\/\/www\.mohw\.go\.kr\//);

  ctx.clock.now += 100_000;
  ctx.robots = () => response(200, "User-agent: *\nDisallow: /admin/\nDisallow: /rss/");
  assert.equal((await run()).errorCode, "ROBOTS_DISALLOWED");
  const change = db.sqlite.prepare("SELECT * FROM press_robots_change").get();
  assert.deepEqual([change.old_decision, change.new_decision], ["ALLOW_PARTIAL", "TARGET_BLOCKED"]);
  assert.match(change.diff, /\+ Disallow: \/rss\//);

  ctx.clock.now += 100_000;
  ctx.robots = () => { throw new TypeError("timeout"); };
  assert.equal((await run()).status, "succeeded", "robots.txt를 읽지 못하면 운영 참고값(CHECK_ERROR)으로 남기고 등록 판단대로 진행한다");
  audit = db.sqlite.prepare("SELECT * FROM press_robots_audit").get();
  assert.equal(audit.decision, "CHECK_ERROR");
  assert.match(audit.robots_text, /Disallow: \/rss\//, "읽지 못한 회차는 이전 원문을 지우지 않는다");
  assert.equal(redactUrl("https://api.example.go.kr/list?serviceKey=SECRET&page=1"), "https://api.example.go.kr/list?serviceKey=***&page=1");
});

test("같은 기관 서버: robots.txt 뒤 3초 이상 쉬고 목록을 부르며, 실행이 끝나도 3초 동안은 같은 호스트를 다시 잡지 않는다", async () => {
  const { sleeps, ctx, run } = await setup();
  assert.equal((await run()).status, "succeeded");
  assert.ok(sleeps[0] >= 3000, "robots.txt와 목록 요청 사이 " + sleeps[0] + "ms");
  assert.equal((await run()).status, "skipped_host_busy", "같은 시각에 바로 다시 부르지 않는다");
  ctx.clock.now += 4;
  assert.equal((await run()).status, "succeeded");
});

test("403은 ACCESS_DENIED로 자동 수집을 멈추고, 401은 인증 필요로 멈추며, 관리자가 풀면 다시 수집 대상이 된다", async () => {
  const { db, calls, ctx, run, state } = await setup();
  ctx.next = () => response(403);
  assert.equal((await run()).errorCode, "ACCESS_DENIED");
  assert.equal(calls.filter((address) => !address.endsWith("/robots.txt")).length, 1, "403은 반복 요청하지 않는다");
  assert.equal(state().collection_hold, "ACCESS_DENIED");
  assert.equal((await listDueSources(db, NOW + 30 * 86_400, 5)).length, 0, "관리자가 풀기 전에는 정기 수집하지 않는다");
  assert.equal(guidelineStatus({ method: "RSS", approvalStatus: "POLICY_APPROVED", enabled: true, technicalStatus: "BLOCKED", safeError: "ACCESS_DENIED", hold: state().collection_hold, robotsDecision: "NO_ROBOTS" }), "ACCESS_DENIED");
  assert.equal(await resumePressHold(db, SOURCE_ID, NOW + 10), true);
  assert.equal((await listDueSources(db, NOW + 10, 5)).length, 1);
  ctx.clock.now += 100;
  ctx.next = () => response(401);
  await run();
  assert.equal(state().collection_hold, "AUTH_REQUIRED");
});

test("429는 Retry-After와 30초 이상 감속을 지키고, 5xx가 3회 잇따르면 하루 멈췄다가 다시 수집한다", async () => {
  const { db, ctx, run, state } = await setup();
  ctx.next = () => response(429, "", { "retry-after": "45" });
  await run();
  assert.ok(state().next_due_at - ctx.clock.now >= 45);
  ctx.next = () => response(503);
  for (let n = 0; n < 3; n += 1) {
    ctx.clock.now = state().next_due_at + 5;
    await run();
  }
  const paused = state();
  assert.equal(paused.collection_hold, "SERVER_PAUSED");
  assert.ok(paused.hold_until >= ctx.clock.now + 86_000);
  assert.equal((await listDueSources(db, ctx.clock.now + 3600, 5)).length, 0);
  assert.equal((await listDueSources(db, paused.hold_until + 1, 5)).length, 1, "일시 중지가 끝나면 다시 수집 대상");
  ctx.clock.now = paused.hold_until + 1;
  ctx.next = undefined;
  assert.equal((await run()).status, "succeeded");
  assert.equal(state().collection_hold, "", "성공하면 보류가 풀린다");
  assert.notEqual(state().last_seen_post_id, "");
});

test("CAPTCHA 화면은 우회하지 않고 MANUAL_REVIEW로 멈추며, 구조가 바뀌어 0건이면 SITE_CHANGED로 본다", async () => {
  const { ctx, run, state } = await setup();
  ctx.next = () => response(200, "<html><body><div class='g-recaptcha'></div>자동입력 방지 문자를 입력하세요</body></html>");
  assert.equal((await run()).errorCode, "CAPTCHA_DETECTED");
  assert.equal(state().collection_hold, "MANUAL_REVIEW");
  assert.equal(guidelineStatus({ method: "HTML", approvalStatus: "POLICY_APPROVED", enabled: true, technicalStatus: "PARSER_ERROR", safeError: "FEED_EMPTY", hold: "", robotsDecision: "ALLOW_ALL" }), "SITE_CHANGED");
  assert.equal(guidelineStatus({ method: "HTML", approvalStatus: "POLICY_APPROVED", enabled: true, technicalStatus: "NORMAL", safeError: "", hold: "", robotsDecision: "ALLOW_PARTIAL" }), "ROBOTS_PARTIAL");
  assert.equal(guidelineStatus({ method: "OPEN_API", approvalStatus: "POLICY_APPROVED", enabled: true, technicalStatus: "NORMAL", safeError: "", hold: "", robotsDecision: null }), "API_ONLY");
  assert.equal(guidelineStatus({ method: "HTML", approvalStatus: "PENDING_PERMISSION", enabled: false, technicalStatus: "UNCHECKED", safeError: "", hold: "", robotsDecision: "BLOCK_ALL" }), "MANUAL_REVIEW");
});

test("Kill Switch: 전체 수집을 끄거나 도메인·경로를 막으면 기관 서버에 아무 요청도 보내지 않고, 기관 요청 보류는 수동 검토로 둔다", async () => {
  const { db, calls, ctx, run } = await setup();
  await setCrawlerEnabled(db, false, NOW);
  assert.equal((await run()).status, "skipped_disabled");
  assert.equal(calls.length, 0);
  await setCrawlerEnabled(db, true, NOW);
  assert.equal(await addCrawlBlock(db, "DOMAIN", "https://mohw.go.kr/", "기관 요청", NOW), true);
  assert.equal((await run()).status, "skipped_blocked", "하위 호스트(www.)도 막는다");
  assert.equal(calls.length, 0);
  db.sqlite.prepare("DELETE FROM press_crawl_block").run();
  assert.equal(await addCrawlBlock(db, "PATH", "/rss/", "경로 차단", NOW), true);
  ctx.clock.now += 10;
  assert.equal((await run()).status, "skipped_blocked");
  assert.equal(calls.length, 0);
  assert.equal(await addCrawlBlock(db, "PATH", "아무 글자", "", NOW), false, "형식이 틀린 패턴은 거절한다");
  db.sqlite.prepare("DELETE FROM press_crawl_block").run();
  ctx.clock.now += 100_000;
  assert.equal(await holdPressSource(db, SOURCE_ID, "기관 공식 수집 중단 요청", NOW), true);
  assert.equal((await listDueSources(db, ctx.clock.now, 5)).length, 0);
});

test("robots.txt 전수 점검은 등록 기관을 7일마다 한 번씩 보고, 차단 목록 도메인은 요청하지 않는다", async () => {
  const db = database();
  const seen = [];
  const fetcher = async (address) => { seen.push(new URL(address).host); return response(200, "User-agent: *\nDisallow: /"); };
  const first = await advanceRobotsAudit(db, fetcher, NOW, 3);
  assert.equal(first, 3);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM press_robots_audit WHERE decision = 'BLOCK_ALL'").get().n, 3);
  await addCrawlBlock(db, "DOMAIN", seen[0], "test", NOW);
  const before = seen.length;
  await advanceRobotsAudit(db, fetcher, NOW + 8 * 86_400, 400);
  assert.ok(!seen.slice(before).includes(seen[0]), "차단 목록 도메인은 요청하지 않는다");
  assert.equal(robotsDiff("User-agent: *\nDisallow: /a", "User-agent: *\nDisallow: /b"), "- Disallow: /a\n+ Disallow: /b");
});
