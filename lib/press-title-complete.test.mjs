import assert from "node:assert/strict";
import test from "node:test";

import { setPressApproval } from "./press/admin.ts";
import { collectPressSource } from "./press/collect.ts";
import { claimRelayJobs, processRelayResult } from "./press/relay.ts";
import { readSource } from "./press/store.ts";
import { extractFullTitle } from "./press/title-complete.ts";
import { NOW, SOURCE_ID, collectDeps, database, feedXml, response, url } from "./press-test-support.mjs";

const FULL = "노인 돌봄 통합지원 확대 시행";

test("원문 화면에서 줄인 제목으로 시작하는 가장 짧은 전체 제목을 찾는다", () => {
  const page = `<html><head><title>${FULL} | 예시구청</title><meta property="og:title" content="${FULL} | 예시구청"></head>` +
    `<body><a href="/list">노인 돌봄 통합...</a><h3 class="tit">${FULL}</h3><p>${FULL}에 따라 구는 본문을 이어 간다.</p></body></html>`;
  assert.equal(extractFullTitle(page, "노인 돌봄 통합..."), FULL);
  assert.equal(extractFullTitle(`<title>${FULL} | 예시구청</title>`, "노인 돌봄 통합…"), FULL, "<title>의 기관명은 뗀다");
  assert.equal(extractFullTitle('<input type="submit" value="일교차 큰 가을, &lsquo;증평인삼&rsquo;으로 건강을">', "일교차 큰 가을, ‘증평인삼’으로..."), "일교차 큰 가을, ‘증평인삼’으로 건강을");
  assert.equal(extractFullTitle("<h3>다른 보도자료 제목입니다</h3>", "노인 돌봄 통합..."), null);
  assert.equal(extractFullTitle(`<h3>${FULL}</h3>`, "노인..."), null, "앞부분이 너무 짧으면 고르지 않는다");
});

const PROFILE = { link: "/press/view\\?seq=(?<id>\\d+)", url: "https://www.example.go.kr/press/view?seq={id}", title: "text" };
const BOARD = '<ul><li><a href="/press/view?seq=101">노인 돌봄 통합지원 확...</a><span>2026-10-01</span></li>' +
  '<li><a href="/press/view?seq=102">장애인 일자리 지원</a><span>2026-10-01</span></li></ul>';

test("서버 수집: 줄인 제목은 원문에서 보완하고, 다음 수집의 줄인 목록 제목이 다시 덮지 않는다", async () => {
  const db = database();
  db.sqlite.prepare("UPDATE press_source SET adapter_profile = ?, allowed_hosts = ? WHERE source_id = 'src:gangwon:press'")
    .run(JSON.stringify(PROFILE), JSON.stringify(["www.example.go.kr"]));
  assert.equal(await setPressApproval(db, "src:gangwon:press", "approve", NOW), true);
  const source = await readSource(db, "src:gangwon:press");
  const details = [];
  const ctx = collectDeps(async (address) => {
    if (address.endsWith("/robots.txt")) return response(404);
    if (address.includes("seq=")) {
      details.push(address);
      return response(200, `<title>예시구청</title><h3>${FULL}</h3><p>본문</p>`);
    }
    return response(200, BOARD);
  });
  const first = await collectPressSource(db, { source, trigger: "manual" }, ctx.deps);
  assert.equal(first.status, "succeeded");
  assert.deepEqual(details, ["https://www.example.go.kr/press/view?seq=101"], "줄인 제목 글만 원문을 연다");
  const title = () => db.sqlite.prepare("SELECT title FROM press_item WHERE canonical_url LIKE '%seq=101'").get().title;
  assert.equal(title(), FULL);
  assert.equal(db.sqlite.prepare("SELECT status FROM press_title_fix").get().status, "COMPLETED");
  ctx.clock.now += 100_000;
  const second = await collectPressSource(db, { source, trigger: "manual" }, ctx.deps);
  assert.equal(second.status, "succeeded");
  assert.equal(title(), FULL, "목록의 줄인 제목으로 되돌리지 않는다");
  assert.equal(details.length, 1);
});

test("PC 중계: 줄인 제목 글의 원문 주소를 작업에 넣고, PC가 올린 원문 화면으로만 보완한다", async () => {
  const db = database();
  assert.equal(await setPressApproval(db, SOURCE_ID, "approve", NOW), true);
  db.sqlite.prepare("UPDATE press_source SET collect_via = 'relay' WHERE source_id = ?").run(SOURCE_ID);
  const endpoint = db.sqlite.prepare("SELECT endpoint_url FROM press_source WHERE source_id = ?").get(SOURCE_ID).endpoint_url;
  const toBase64 = (text) => Buffer.from(text, "utf8").toString("base64");
  const feed = toBase64(feedXml([{ title: "복지부, 지역사회 통합돌봄 시범사업 확...", link: url(301) }]));
  const upload = (extra = []) => [{ url: "https://www.mohw.go.kr/robots.txt", status: 404 }, { url: endpoint, status: 200, contentType: "application/rss+xml", bodyBase64: feed }, ...extra];
  let n = 0;
  const deps = (now) => ({ now: () => now, newId: () => "relay-" + ++n });
  await claimRelayJobs(db, "desktop", NOW);
  assert.equal((await processRelayResult(db, "desktop", SOURCE_ID, upload(), deps(NOW))).status, "succeeded");
  const later = NOW + 2 * 86_400;
  const { jobs } = await claimRelayJobs(db, "desktop", later);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].detailUrls.length, 1);
  const detail = jobs[0].detailUrls[0];
  const page = toBase64("<h2>복지부, 지역사회 통합돌봄 시범사업 확대 시행</h2>");
  await processRelayResult(db, "desktop", SOURCE_ID, upload([{ url: "https://www.mohw.go.kr/other", status: 200, bodyBase64: page }]), deps(later));
  const attempts = () => db.sqlite.prepare("SELECT COUNT(*) AS n FROM press_title_fix f JOIN press_item i ON i.item_id = f.item_id WHERE i.canonical_url = ?").get(detail).n;
  assert.equal(attempts(), 0, "작업에 없는 주소나 올리지 않은 원문은 시도로 세지 않는다");
  await processRelayResult(db, "desktop", SOURCE_ID, upload([{ url: detail, status: 200, contentType: "text/html; charset=utf-8", bodyBase64: page }]), deps(later + 60));
  assert.equal(db.sqlite.prepare("SELECT title FROM press_item WHERE canonical_url = ?").get(detail).title, "복지부, 지역사회 통합돌봄 시범사업 확대 시행");
});
