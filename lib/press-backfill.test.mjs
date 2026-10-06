// 제한 backfill(작업지시서 v5 T157·T158): 목록 맨 아래 글이 새 글이면 다음 쪽을 최대 2쪽 더 읽고,
// 지난 수집과 이어지면 GAP_RECOVERED, 끝내 이어지지 않거나 다음 쪽을 못 읽으면 GAP_POSSIBLE로 남긴다.
import assert from "node:assert/strict";
import test from "node:test";

import { setPressApproval } from "./press/admin.ts";
import { collectPressSource } from "./press/collect.ts";
import { NOW, SOURCE_ID, collectDeps, database, response, sourceOf } from "./press-test-support.mjs";

const VIEW = "https://www.mohw.go.kr/board.es?mid=a10503000000&bid=0027&act=view&list_no=";
const PROFILE = {
  link: "list_no=(?<id>\\d+)",
  url: "https://www.mohw.go.kr/board.es?mid=a10503000000&bid=0027&act=view&list_no={id}",
  title: "text",
  page: "https://www.mohw.go.kr/board.es?mid=a10503000000&bid=0027&nPage={page}",
};

/** 최신 글이 위에 오는 게시판 목록. 맨 위에 고정 공지 1건이 쪽마다 붙는다. */
function boardPage(ids) {
  const row = (id, date) => "<tr><td><a href=\"" + VIEW + id + "\">통합돌봄 노인 지원 안내 " + id + "</a></td><td>" + date + "</td></tr>";
  return "<table>" + row(1, "2026-01-02") + ids.map((id) => row(id, "2026-10-0" + (id % 3 + 1))).join("") + "</table>";
}

async function htmlSource() {
  const db = database();
  db.sqlite.prepare("UPDATE press_source SET adapter = 'HTMLBoardAdapter', adapter_profile = ?, endpoint_url = ? WHERE source_id = ?")
    .run(JSON.stringify(PROFILE), "https://www.mohw.go.kr/board.es?mid=a10503000000&bid=0027", SOURCE_ID);
  assert.equal(await setPressApproval(db, SOURCE_ID, "approve", NOW), true);
  return db;
}

const range = (from, to) => Array.from({ length: from - to + 1 }, (_, index) => from - index);

test("공백이 의심되면 다음 쪽을 읽어 지난 수집과 이어 붙이고 GAP_RECOVERED로 남긴다", async () => {
  const db = await htmlSource();
  const pages = { 1: range(110, 101), 2: range(100, 91), 3: range(90, 81) };
  let current = { 1: range(100, 91) };
  const asked = [];
  const { deps, clock } = collectDeps(async (address) => {
    if (address.endsWith("/robots.txt")) return response(404);
    asked.push(address);
    const page = Number(new URL(address).searchParams.get("nPage") ?? "1");
    return current[page] ? response(200, boardPage(current[page])) : response(404);
  });
  const first = await collectPressSource(db, { source: await sourceOf(db), trigger: "manual" }, deps);
  assert.equal(first.status, "succeeded");
  assert.equal(first.coverageNote ?? "", "", "첫 수집은 비교 대상이 없어 공백으로 보지 않는다");

  current = pages;
  clock.now += 3600;
  asked.length = 0;
  const second = await collectPressSource(db, { source: await sourceOf(db), trigger: "manual" }, deps);
  assert.equal(second.status, "succeeded");
  assert.equal(second.coverageNote, "GAP_RECOVERED");
  assert.equal(asked.length, 2, "2쪽에서 지난 수집과 이어졌으므로 3쪽은 읽지 않는다");
  assert.equal(second.counts.created, 10, "1쪽 새 글 10건만 새로 저장(2쪽은 이미 알던 글)");
  const stored = db.sqlite.prepare("SELECT COUNT(*) AS n FROM press_item").get().n;
  assert.equal(stored, 21, "고정 공지 1건 + 91~110번 20건, 중복 없음");
  const run = db.sqlite.prepare("SELECT coverage_note FROM press_collection_run WHERE run_id = ?").get(second.runId);
  assert.equal(run.coverage_note, "GAP_RECOVERED");
});

test("다음 쪽을 읽지 못하면 1쪽만 저장하고 GAP_POSSIBLE로 남긴다", async () => {
  const db = await htmlSource();
  let current = { 1: range(100, 91) };
  const { deps, clock } = collectDeps(async (address) => {
    if (address.endsWith("/robots.txt")) return response(404);
    const page = Number(new URL(address).searchParams.get("nPage") ?? "1");
    if (page > 1) return response(503);
    return response(200, boardPage(current[1]));
  });
  await collectPressSource(db, { source: await sourceOf(db), trigger: "manual" }, deps);
  current = { 1: range(130, 121) };
  clock.now += 3600;
  const second = await collectPressSource(db, { source: await sourceOf(db), trigger: "manual" }, deps);
  assert.equal(second.status, "succeeded", "다음 쪽 실패가 1쪽 수집을 실패로 만들지 않는다");
  assert.equal(second.coverageNote, "GAP_POSSIBLE");
  assert.equal(second.counts.created, 10);
});

test("robots.txt가 다음 쪽 주소를 막으면 더 읽지 않는다", async () => {
  const db = await htmlSource();
  let current = { 1: range(100, 91) };
  const asked = [];
  const { deps, clock } = collectDeps(async (address) => {
    if (address.endsWith("/robots.txt")) return response(200, "User-agent: *\nDisallow: /board.es?mid=a10503000000&bid=0027&nPage=\n");
    asked.push(address);
    return response(200, boardPage(current[1]));
  });
  await collectPressSource(db, { source: await sourceOf(db), trigger: "manual" }, deps);
  current = { 1: range(130, 121) };
  clock.now += 3600;
  asked.length = 0;
  const second = await collectPressSource(db, { source: await sourceOf(db), trigger: "manual" }, deps);
  assert.equal(second.coverageNote, "GAP_POSSIBLE");
  assert.equal(asked.length, 1, "1쪽만 요청");
});
