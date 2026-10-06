// 보도자료 수집 48시간 가상 시각 replay(작업지시서 v5 §23.20·T116·T157·T158). 실제 48시간 운영이 아니라,
// 실제 마이그레이션 DB와 실제 수집 코드(listDueSources·collectPressSource)를 가상 시계로 10분씩 돌리며 장애를 주입한다:
// 고정 공지·매시간 새 글·403 구간·429(Retry-After)·글 폭증(목록 창 초과)·실행 중단(lease 남김)·동시 실행·304.
import assert from "node:assert/strict";
import test from "node:test";

import { setPressApproval } from "./press/admin.ts";
import { resumePressHold } from "./press/admin.ts";
import { collectPressSource } from "./press/collect.ts";
import { claimCrawlLease, listDueSources } from "./press/store.ts";
import { SOURCE_ID, database, response, url } from "./press-test-support.mjs";

const HOUR = 3600;
const START = Date.UTC(2026, 9, 4, 15, 0) / 1000; // 한국시간 2026-10-05 00:00
const FEED_SIZE = 20;
const at = (hours) => START + Math.round(hours * HOUR);

/** 가상 원천: 0~39시까지 매시간 1건, 37~39시에 4분마다 추가 글(폭증 30건). 맨 위에는 오래된 고정 공지. */
function posts() {
  const list = [];
  for (let hour = 0; hour <= 39; hour += 1) list.push({ id: 1000 + hour, time: at(hour), title: "복지 소식 " + hour + "시 통합돌봄 안내" });
  for (let minute = 0; minute < 120; minute += 4) list.push({ id: 5000 + minute, time: at(37) + minute * 60, title: "폭증 " + minute + "분 노인 돌봄 공지" });
  return list.sort((a, b) => a.time - b.time);
}
const PINNED = { id: 1, time: START - 30 * 24 * HOUR, title: "[고정] 통합돌봄 사업 안내" };
const rfc = (seconds) => new Date(seconds * 1000).toUTCString();
const item = (post) => "<item><title><![CDATA[" + post.title + "]]></title><link>" + url(post.id) + "</link><pubDate>" + rfc(post.time) + "</pubDate></item>";

function feedAt(now) {
  const visible = posts().filter((post) => post.time <= now).sort((a, b) => b.time - a.time).slice(0, FEED_SIZE);
  return { etag: "\"v" + (visible[0]?.id ?? 0) + "\"", body: "<?xml version=\"1.0\"?><rss version=\"2.0\"><channel><title>t</title>" + [PINNED, ...visible].map(item).join("") + "</channel></rss>" };
}

test("48시간 가상 replay: 장애·폭증·중단·동시 실행에도 중복 없이 수집하고 공백을 드러낸다", async () => {
  const db = database();
  const clock = { now: START };
  const log = [];
  const fetcher = async (address, headers) => {
    if (address.endsWith("/robots.txt")) return response(404);
    const hours = (clock.now - START) / HOUR;
    log.push(hours);
    if (hours >= 9 && hours < 11) return response(403);
    if (hours >= 36 && hours < 36.2) return response(429, "", { "retry-after": "3600" });
    const feed = feedAt(clock.now);
    if (headers["if-none-match"] === feed.etag) return response(304, "", { etag: feed.etag });
    return response(200, feed.body, { etag: feed.etag });
  };
  let counter = 0;
  const deps = { fetcher, now: () => clock.now, sleep: async () => {}, newId: () => "id-" + ++counter };
  assert.equal(await setPressApproval(db, SOURCE_ID, "approve", START), true);

  const summaries = [];
  let crashed = false;
  let concurrent = null;
  for (let step = 0; step <= 48 * 6; step += 1) {
    clock.now = START + step * 600;
    const hours = step / 6;
    // 403은 자동 수집을 멈춘다(지침 10항). 차단 구간이 끝난 뒤 관리자가 확인하고 다시 켠 것으로 친다.
    if (hours >= 11 && hours < 11.2) await resumePressHold(db, SOURCE_ID, clock.now);
    if (!crashed && hours >= 39) {
      // 실행 도중 중단: lease를 잡은 채 사라진다. 만료(120초) 전에는 아무도 수집하지 않아야 한다.
      crashed = await claimCrawlLease(db, SOURCE_ID, "crashed-run", clock.now);
      assert.equal(crashed, true);
      assert.equal((await listDueSources(db, clock.now, 5)).length, 0);
      continue;
    }
    for (const source of await listDueSources(db, clock.now, 5)) {
      if (hours >= 42 && !concurrent) {
        concurrent = await Promise.all([1, 2].map(() => collectPressSource(db, { source, trigger: "scheduled" }, deps)));
        summaries.push(...concurrent.map((summary) => ({ hours, ...summary })));
        continue;
      }
      summaries.push({ hours, ...(await collectPressSource(db, { source, trigger: "scheduled" }, deps)) });
    }
  }

  const rows = db.sqlite.prepare("SELECT canonical_url FROM press_item").all();
  const urls = rows.map((row) => row.canonical_url);
  assert.equal(new Set(urls).size, urls.length, "중복 게시물 없음");
  assert.equal(urls.filter((link) => link.includes("list_no=1&")).length, 1, "고정 공지는 한 번만");
  const stored = new Set(urls.map((link) => Number(/list_no=(\d+)/.exec(link)[1])));
  const missing = posts().filter((post) => !stored.has(post.id)).map((post) => post.id);
  // 폭증 구간(37~38.5시)에 새 글이 목록 창(20건)을 넘쳐 일부를 놓칠 수 있고, 그때 GAP_POSSIBLE이 기록돼야 한다.
  const runs = db.sqlite.prepare("SELECT started_at, status, error_code, coverage_note, new_count FROM press_collection_run ORDER BY started_at").all();
  const gapRuns = runs.filter((run) => run.coverage_note === "GAP_POSSIBLE");
  assert.ok(missing.length > 0, "폭증이 목록 창을 넘는 상황이 실제로 만들어져야 한다");
  assert.ok(gapRuns.length > 0, "놓친 글이 있으면 공백 가능 표시가 있어야 한다(고정 공지가 있어도)");
  for (const id of missing) assert.ok(id >= 1000 && id < 6000);

  const failed = runs.filter((run) => run.status === "failed");
  assert.ok(failed.some((run) => run.error_code === "ACCESS_DENIED"), "403 구간 실패 기록");
  assert.ok(failed.some((run) => run.error_code === "RATE_LIMITED"), "429 기록");
  const after429 = runs.filter((run) => run.started_at > at(36) && run.started_at < at(36) + HOUR && run.error_code !== "RATE_LIMITED");
  assert.equal(after429.length, 0, "Retry-After 3600초 동안 다시 부르지 않는다");
  const afterCrash = runs.find((run) => run.started_at >= at(39));
  assert.ok(afterCrash && afterCrash.started_at >= at(39) + 120, "중단된 lease가 만료된 뒤에야 다시 수집");
  assert.ok(concurrent.some((summary) => summary.status === "skipped_locked"), "동시 실행 하나는 lease로 건너뜀");
  assert.ok(runs.some((run) => run.status === "not_modified"), "변화 없을 때 304를 성공 확인으로 기록");

  // 정상 수집 시각: 첫 실행 뒤로는 한국시간 09·12·15·18시 정각 이후(또는 실패 재시도)만 돈다.
  const slotHours = [9, 12, 15, 18, 33, 36, 39, 42];
  const okRuns = runs.filter((run) => run.status === "succeeded" || run.status === "not_modified");
  for (const run of okRuns.slice(1)) {
    const hours = (run.started_at - START) / HOUR;
    assert.ok(slotHours.some((slot) => hours >= slot && hours < slot + 3), "정기 시각 이후 실행: " + hours);
  }
  const report = { virtual_hours: 48, steps: 289, runs: runs.length, succeeded: okRuns.length, failed: failed.length, gap_possible: gapRuns.length, posts: posts().length, stored: stored.size, missing: missing.length, fetches: log.length };
  console.log("replay", JSON.stringify(report));
  assert.ok(report.fetches < 60, "48시간 요청 수 상한(실제 " + report.fetches + "회)");
});
