import assert from "node:assert/strict";
import test from "node:test";
import corrections from "../data/press-link-corrections-20261024.json" with { type: "json" };
import { applyVerifiedPressLinkCorrections, SEOCHO_SOURCE_ID } from "./press/link-corrections.ts";
import { collectionFixture, NOW, response } from "./press-test-support.mjs";
import { collectPressSource } from "./press/collect.ts";
import { readSource } from "./press/store.ts";
import { parseBoardProfile, parseHtmlBoard } from "./press/html-board.ts";

async function legacyItem(status = "PUBLIC") {
  const correction = corrections[0];
  const fixture = await collectionFixture([{ title: "노인 돌봄 지원", link: "https://www.mohw.go.kr/board.es?list_no=1" }]);
  await fixture.run();
  fixture.db.sqlite.prepare("UPDATE press_item SET item_id = ?, canonical_url = ?, source_id = ?, issued_by_org_id = ?, public_status = ?")
    .run(correction.itemId, correction.from, SEOCHO_SOURCE_ID, "org:서울특별시:서초구", status);
  return { ...fixture, correction };
}

test("검증한 원문 주소만 정정하고 ID·철회 상태·차단 사유를 보존한다", async () => {
  const { db, correction } = await legacyItem("WITHDRAWN");
  db.sqlite.prepare("INSERT INTO press_item_block(canonical_url, reason, blocked_at, previous_status) VALUES (?, '기존 삭제 사유', ?, 'PUBLIC')").run(correction.from, NOW);
  await applyVerifiedPressLinkCorrections(db, NOW + 1);
  assert.deepEqual({ ...db.sqlite.prepare("SELECT item_id, canonical_url, public_status FROM press_item").get() }, { item_id: correction.itemId, canonical_url: correction.to, public_status: "WITHDRAWN" });
  assert.equal(db.sqlite.prepare("SELECT reason FROM press_item_block WHERE canonical_url = ?").get(correction.to).reason, "기존 삭제 사유");
  await applyVerifiedPressLinkCorrections(db, NOW + 2);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM press_item").get().n, 1);
  const source = await readSource(db, SEOCHO_SOURCE_ID);
  const profile = parseBoardProfile(source.adapterProfile);
  assert.ok(profile);
  const html = '<a href="/site/seocho/ex/bbs/View.do?cbIdx=57&amp;bcIdx=399631">다른 게시판 공지사항</a><a href="/site/seocho/ex/bbs/View.do?cbIdx=61&amp;bcIdx=412042">노인 돌봄 지원</a>';
  assert.deepEqual(parseHtmlBoard(html, profile).map(item => item.link), [correction.to]);
});

test("주소를 정정한 게시물을 다시 수집해도 중복 없이 기존 ID로 제목을 갱신한다", async () => {
  const { db, ctx, correction } = await legacyItem();
  await applyVerifiedPressLinkCorrections(db, NOW + 1);
  db.sqlite.prepare("UPDATE press_source SET approval_status='POLICY_APPROVED', enabled=1, collect_via='server' WHERE source_id=?").run(SEOCHO_SOURCE_ID);
  const source = await readSource(db, SEOCHO_SOURCE_ID);
  ctx.clock.now += 7200;
  ctx.deps.fetcher = async () => response(200, '<a href="/site/seocho/ex/bbs/View.do?cbIdx=61&amp;bcIdx=412042">노인 돌봄 지원 확대</a><span>2026-10-02</span>');
  ctx.deps.robotsFetcher = async () => response(404);
  const result = await collectPressSource(db, { source, trigger: "manual" }, ctx.deps);
  assert.equal(result.status, "succeeded");
  assert.equal(result.counts.created, 0);
  assert.equal(result.counts.updated, 1);
  assert.deepEqual({ ...db.sqlite.prepare("SELECT item_id, title FROM press_item").get() }, { item_id: correction.itemId, title: "노인 돌봄 지원 확대" });
});

test("원기관에서 삭제된 것으로 확인한 한 게시물만 철회하며 재수집 차단을 남긴다", async () => {
  const { db, run } = await collectionFixture([{ title: "생활복지사 모집", link: "https://www.mohw.go.kr/board.es?list_no=1" }, { title: "노인 돌봄 지원", link: "https://www.mohw.go.kr/board.es?list_no=2" }]);
  await run();
  const removedId = "src:www.gp.go.kr:press:f0cf217bf1152a9e4fa7ab439988f277";
  const removedUrl = "https://www.gp.go.kr/portal/selectBbsNttView.do?key=787&bbsNo=127&nttNo=289880&searchCtgry=&searchCnd=all&searchKrwd=&pageIndex=1&integrDeptCode=";
  db.sqlite.prepare("UPDATE press_item SET item_id=?, canonical_url=?, public_status='PUBLIC' WHERE title='생활복지사 모집'").run(removedId, removedUrl);
  await applyVerifiedPressLinkCorrections(db, NOW);
  assert.equal(db.sqlite.prepare("SELECT public_status FROM press_item WHERE item_id=?").get(removedId).public_status, "WITHDRAWN");
  assert.equal(db.sqlite.prepare("SELECT previous_status FROM press_item_block WHERE canonical_url=?").get(removedUrl).previous_status, "PUBLIC");
  assert.equal(db.sqlite.prepare("SELECT public_status FROM press_item WHERE title='노인 돌봄 지원'").get().public_status, "PUBLIC");
});
