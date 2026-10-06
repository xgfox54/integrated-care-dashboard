import assert from "node:assert/strict";
import test from "node:test";

import { setPressApproval } from "./press/admin.ts";
import { claimRelayJobs, processRelayResult, readRelayPcs, registerRelayPc, relayClientName, releaseRelayClaim, removeRelayPc, RELAY_CLAIM_SECONDS } from "./press/relay.ts";
import { NOW, SOURCE_ID, database, feedXml, url } from "./press-test-support.mjs";

async function relayDb() {
  const db = database();
  assert.equal(await setPressApproval(db, SOURCE_ID, "approve", NOW), true);
  db.sqlite.prepare("UPDATE press_source SET collect_via = 'relay' WHERE source_id = ?").run(SOURCE_ID);
  return db;
}

const deps = () => { let n = 0; return { now: () => NOW, newId: () => "relay-" + ++n }; };
const toBase64 = (text) => Buffer.from(text, "utf8").toString("base64");

// 실제 SQL 실행만 멈춰, 오래된 반납의 읽기와 쓰기 사이에 다른 claim을 확정한다.
function pauseNextClaimWrite(db) {
  let reached, resume;
  const paused = new Promise((resolve) => { reached = resolve; });
  const continued = new Promise((resolve) => { resume = resolve; });
  let waiting = true;
  const wrap = (statement, sql, values = []) => {
    const invoke = async (method) => {
      if (waiting && /^(INSERT|UPDATE)/.test(sql) && sql.includes("app_setting") && values.includes("press_relay_claim")) {
        waiting = false;
        reached();
        await continued;
      }
      return statement[method]();
    };
    return {
      bind: (...bound) => wrap(statement.bind(...bound), sql, bound),
      first: () => invoke("first"),
      all: () => invoke("all"),
      run: () => invoke("run"),
    };
  };
  return { db: { ...db, prepare: (sql) => wrap(db.prepare(sql), sql) }, paused, resume: () => resume() };
}

test("관리자가 등록한 PC 토큰만 인정하고, 삭제하면 바로 막힌다", async () => {
  const db = database();
  const token = await registerRelayPc(db, "laptop", NOW);
  assert.match(token, /^[\w-]{43}$/);
  assert.ok(!JSON.stringify(await readRelayPcs(db)).includes(token), "토큰 원문은 저장하지 않는다");
  assert.equal(await relayClientName("Bearer " + token, await readRelayPcs(db)), "laptop");
  assert.equal(await relayClientName("Bearer " + "x".repeat(43), await readRelayPcs(db)), null);
  const renewed = await registerRelayPc(db, "laptop", NOW + 1);
  assert.equal(await relayClientName("Bearer " + token, await readRelayPcs(db)), null, "재발급하면 이전 토큰은 못 쓴다");
  assert.equal(await removeRelayPc(db, "laptop", NOW + 2), true);
  assert.equal(await relayClientName("Bearer " + renewed, await readRelayPcs(db)), null);
});

test("두 PC가 함께 켜져 있으면 먼저 차례를 잡은 PC만 수집하고, 끝내면 다른 PC가 이어받는다", async () => {
  const db = await relayDb();
  const first = await claimRelayJobs(db, "laptop", NOW);
  assert.deepEqual(first.jobs.map((job) => job.sourceId), [SOURCE_ID]);
  assert.equal(first.jobs[0].robotsUrl, "https://www.mohw.go.kr/robots.txt");
  const second = await claimRelayJobs(db, "desktop", NOW + 60);
  assert.deepEqual(second, { jobs: [], busyBy: "laptop" });
  await releaseRelayClaim(db, "laptop", NOW + 120);
  assert.equal((await claimRelayJobs(db, "desktop", NOW + 180)).jobs.length, 1);
});

test("PC가 올린 목록 화면으로 평소처럼 수집하고, 서버 수집 대상이면 받지 않는다", async () => {
  const db = await relayDb();
  assert.equal((await claimRelayJobs(db, "desktop", NOW)).jobs.length, 1);
  const source = db.sqlite.prepare("SELECT endpoint_url FROM press_source WHERE source_id = ?").get(SOURCE_ID);
  const feed = feedXml([{ title: "복지부, 지역사회 통합돌봄 시범사업 확대", link: url(201) }]);
  const uploaded = [
    { url: "https://www.mohw.go.kr/robots.txt", status: 404 },
    { url: source.endpoint_url, status: 200, contentType: "application/rss+xml; charset=utf-8", bodyBase64: toBase64(feed) },
    { url: "https://evil.example/other", status: 200, bodyBase64: toBase64(feed) },
  ];
  const summary = await processRelayResult(db, "desktop", SOURCE_ID, uploaded, deps());
  assert.equal(summary.status, "succeeded");
  assert.equal(summary.counts.created, 1);
  assert.equal(db.sqlite.prepare("SELECT trigger FROM press_collection_run ORDER BY started_at DESC LIMIT 1").get().trigger, "relay");
  db.sqlite.prepare("UPDATE press_source SET collect_via = 'server' WHERE source_id = ?").run(SOURCE_ID);
  assert.equal(await processRelayResult(db, "desktop", SOURCE_ID, uploaded, deps()), null);
});

test("두 PC의 동시 claim은 빈 상태와 만료 상태 모두 한 PC에만 작업을 준다", async () => {
  for (const existing of [false, true]) {
    const db = await relayDb();
    if (existing) await claimRelayJobs(db, "old-pc", NOW - RELAY_CLAIM_SECONDS);
    const results = await Promise.all(["laptop", "desktop"].map((pc) => claimRelayJobs(db, pc, NOW)));
    const winners = results.map((result, index) => ({ ...result, pc: ["laptop", "desktop"][index] })).filter((result) => result.jobs.length);
    assert.equal(winners.length, 1, existing ? "만료 claim 교체도 원자적" : "첫 claim 생성도 원자적");
    assert.deepEqual(winners[0].jobs.map((job) => job.sourceId), [SOURCE_ID]);
    const loser = results.find((result) => result.jobs.length === 0);
    assert.equal(loser.busyBy, winners[0].pc);
    const claim = JSON.parse(db.sqlite.prepare("SELECT value FROM app_setting WHERE key = 'press_relay_claim'").get().value);
    assert.deepEqual(claim, { pc: winners[0].pc, until: NOW + RELAY_CLAIM_SECONDS });
  }
});

test("claim 없는 업로드·타 PC 업로드·정확한 만료 시각의 업로드·반납 뒤 업로드는 저장하지 않는다", async () => {
  const db = await relayDb();
  const endpoint = db.sqlite.prepare("SELECT endpoint_url FROM press_source WHERE source_id = ?").get(SOURCE_ID).endpoint_url;
  const uploaded = [
    { url: "https://www.mohw.go.kr/robots.txt", status: 404 },
    { url: endpoint, status: 200, contentType: "application/rss+xml", bodyBase64: toBase64(feedXml([{ title: "복지부, 지역사회 통합돌봄 시범사업 확대", link: url(201) }])) },
  ];
  assert.equal(await processRelayResult(db, "laptop", SOURCE_ID, uploaded, deps()), null);
  await claimRelayJobs(db, "laptop", NOW);
  assert.equal(await processRelayResult(db, "desktop", SOURCE_ID, uploaded, deps()), null);
  assert.equal(await processRelayResult(db, "laptop", SOURCE_ID, uploaded, { ...deps(), now: () => NOW + RELAY_CLAIM_SECONDS }), null);
  assert.equal((await claimRelayJobs(db, "desktop", NOW + RELAY_CLAIM_SECONDS)).jobs.length, 1);
  const later = { ...deps(), now: () => NOW + RELAY_CLAIM_SECONDS };
  assert.equal(await processRelayResult(db, "laptop", SOURCE_ID, uploaded, later), null);
  await releaseRelayClaim(db, "desktop", NOW + RELAY_CLAIM_SECONDS);
  assert.equal(await processRelayResult(db, "desktop", SOURCE_ID, uploaded, later), null);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM press_item").get().n, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM press_collection_run").get().n, 0);
});

test("오래된 반납이 대기하는 동안 새 PC가 차례를 얻어도 새 claim은 보존된다", { timeout: 5000 }, async () => {
  const db = await relayDb();
  await claimRelayJobs(db, "laptop", NOW);
  const delayed = pauseNextClaimWrite(db);
  const releasing = releaseRelayClaim(delayed.db, "laptop", NOW + 1);
  await delayed.paused;
  try {
    assert.equal((await claimRelayJobs(db, "desktop", NOW + RELAY_CLAIM_SECONDS)).jobs.length, 1);
  } finally {
    delayed.resume();
    await releasing;
  }
  assert.deepEqual(await claimRelayJobs(db, "laptop", NOW + RELAY_CLAIM_SECONDS + 1), { jobs: [], busyBy: "desktop" });
});

test("오래된 반납은 같은 PC가 갱신한 claim도 지우지 않고 타 PC의 반납은 무시한다", { timeout: 5000 }, async () => {
  const db = await relayDb();
  await claimRelayJobs(db, "laptop", NOW);
  await releaseRelayClaim(db, "desktop", NOW + 1);
  const delayed = pauseNextClaimWrite(db);
  const releasing = releaseRelayClaim(delayed.db, "laptop", NOW + 2);
  await delayed.paused;
  try {
    assert.equal((await claimRelayJobs(db, "laptop", NOW + 60)).jobs.length, 1);
  } finally {
    delayed.resume();
    await releasing;
  }
  assert.deepEqual(await claimRelayJobs(db, "desktop", NOW + RELAY_CLAIM_SECONDS), { jobs: [], busyBy: "laptop" });
});
