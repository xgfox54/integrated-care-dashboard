import assert from "node:assert/strict";
import test from "node:test";

import { collectionFixture, feedXml, NOW, response, url } from "./press-test-support.mjs";
import { withdrawExcludedPressItems } from "./press/title-exclusions.ts";
import { recordTitleAttempt } from "./press/title-complete.ts";

test("고향사랑기부 제목은 저장하지 않으며 제외 항목이 많아도 파서 오류로 처리하지 않는다", async () => {
  const excluded = Array.from({ length: 6 }, (_, i) => ({ title: `고향사랑기부금으로 노인 돌봄 지원 ${i}`, link: url(i + 1) }));
  const { db, run } = await collectionFixture([...excluded, { title: "어르신 이웃돕기 성금 기탁", link: url(10) }]);
  const result = await run();
  assert.equal(result.status, "succeeded");
  assert.equal(result.counts.rejected, 0);
  assert.equal(result.counts.created, 1);
  assert.deepEqual(db.sqlite.prepare("SELECT title FROM press_item").all().map(row => row.title), ["어르신 이웃돕기 성금 기탁"]);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM press_item_block").get().n, 6);
});

test("기존 제목이 제외 제목으로 바뀌면 철회하고 이후 재수집에도 다시 공개하지 않는다", async () => {
  const { db, ctx, run } = await collectionFixture([{ title: "노인 돌봄 지원", link: url(1) }]);
  await run();
  ctx.clock.now += 10;
  ctx.next = () => response(200, feedXml([{ title: "고향사랑기부금으로 노인 돌봄 지원", link: url(1) }]));
  await run();
  assert.equal(db.sqlite.prepare("SELECT public_status FROM press_item").get().public_status, "WITHDRAWN");
  ctx.clock.now += 10;
  ctx.next = () => response(200, feedXml([{ title: "노인 돌봄 지원 확대", link: url(1) }]));
  await run();
  assert.equal(db.sqlite.prepare("SELECT public_status FROM press_item").get().public_status, "WITHDRAWN");
});

test("기존 공개 자료와 숨김 자료를 철회하며 다른 제목과 삭제 전 상태를 보존한다", async () => {
  const { db, run } = await collectionFixture([1, 2, 3].map(i => ({ title: `노인 돌봄 지원 ${i}`, link: url(i) })));
  await run();
  const rows = db.sqlite.prepare("SELECT item_id, canonical_url FROM press_item ORDER BY canonical_url").all();
  db.sqlite.prepare("UPDATE press_item SET title = ?, public_status = ? WHERE item_id = ?").run("고향사랑기부금 노인 지원", "PUBLIC", rows[0].item_id);
  db.sqlite.prepare("UPDATE press_item SET title = ?, public_status = ? WHERE item_id = ?").run("고향사랑기부금 지원", "HIDDEN", rows[1].item_id);
  assert.equal(await withdrawExcludedPressItems(db, NOW), 2);
  assert.equal(await withdrawExcludedPressItems(db, NOW + 1), 0);
  assert.deepEqual(db.sqlite.prepare("SELECT public_status FROM press_item ORDER BY canonical_url").all().map(row => row.public_status), ["WITHDRAWN", "WITHDRAWN", "PUBLIC"]);
  assert.deepEqual(db.sqlite.prepare("SELECT previous_status FROM press_item_block ORDER BY canonical_url").all().map(row => row.previous_status), ["PUBLIC", "HIDDEN"]);
});

test("줄인 제목을 보완한 결과에 제외 문구가 있으면 공개 철회한다", async () => {
  const { db, run } = await collectionFixture([{ title: "노인 돌봄 지원…", link: url(1) }]);
  await run();
  const item = db.sqlite.prepare("SELECT item_id, title FROM press_item").get();
  await recordTitleAttempt(db, item, "노인 돌봄 지원, 고향사랑기부금으로 확대", NOW);
  assert.equal(db.sqlite.prepare("SELECT public_status FROM press_item").get().public_status, "WITHDRAWN");
});
