// 보도자료 분류 2단계(T167): 검토자가 보류 항목을 확정하면 공개 목록에 반영되고, 1단계 결과·사전 버전은 보존되며, 제목이 바뀌면 다시 규칙 분류한다.
import assert from "node:assert/strict";
import test from "node:test";

import { readAdminPress, reviewPressClassification } from "./press/admin.ts";
import { collectPressSource } from "./press/collect.ts";
import { McpData } from "./mcp/data.ts";
import { NOW, SOURCE_ID, collectDeps, database, feedXml, response, sourceOf, url } from "./press-test-support.mjs";

async function seeded(title) {
  const db = database();
  db.sqlite.prepare("UPDATE press_source SET approval_status = 'POLICY_APPROVED', enabled = 1 WHERE source_id = ?").run(SOURCE_ID);
  let feed = [{ title, link: url(7) }];
  const { deps, clock } = collectDeps(async (address) => (address.endsWith("/robots.txt") ? response(404) : response(200, feedXml(feed))));
  await collectPressSource(db, { source: await sourceOf(db), trigger: "manual" }, deps);
  return { db, deps, clock, setFeed: (next) => { feed = next; } };
}

test("보류 항목을 복지로 확정하면 공개되고, 1단계 결과·사전 버전이 남으며, 잘못된 분류는 거절한다", async () => {
  const { db } = await seeded("2027년 지원 사업 공모 안내");
  const [item] = (await readAdminPress(db)).review_queue;
  assert.equal(item.classification_status, "NEEDS_REVIEW");
  const data = new McpData(db, async () => new Map());
  assert.equal(await data.newsItem(item.item_id), null, "보류 항목은 공개하지 않는다");
  assert.equal(await reviewPressClassification(db, item.item_id, "WELFARE", [], NOW), "invalid", "복지는 분류가 필요");
  assert.equal(await reviewPressClassification(db, item.item_id, "WELFARE", ["not_a_category"], NOW), "invalid");
  assert.equal(await reviewPressClassification(db, item.item_id, "NON_WELFARE", ["senior"], NOW), "invalid");
  assert.equal(await reviewPressClassification(db, item.item_id, "WELFARE", ["social_service", "senior"], NOW), "ok");
  const row = db.sqlite.prepare("SELECT classification_status, classification_basis, categories, rule_classification_status, rule_categories, dictionary_version, reviewed_at FROM press_item WHERE item_id = ?").get(item.item_id);
  assert.equal(row.classification_status, "WELFARE");
  assert.equal(row.classification_basis, "reviewer");
  assert.deepEqual(JSON.parse(row.categories), ["social_service", "senior"]);
  assert.equal(row.rule_classification_status, "NEEDS_REVIEW");
  assert.ok(row.dictionary_version.startsWith("press-dict-"), "사전 버전은 그대로");
  assert.ok((await data.newsItem(item.item_id)), "확정 뒤 공개");
  assert.equal(await reviewPressClassification(db, item.item_id, "NON_WELFARE", [], NOW + 1), "ok", "검토한 항목은 다시 고칠 수 있다");
  assert.equal(db.sqlite.prepare("SELECT rule_classification_status FROM press_item WHERE item_id = ?").get(item.item_id).rule_classification_status, "NEEDS_REVIEW", "다시 고쳐도 1단계 결과는 처음 값");
  assert.equal((await readAdminPress(db)).reviewed.length, 1);
  assert.equal(await data.newsItem(item.item_id), null, "비복지로 고치면 다시 숨긴다");
  db.sqlite.prepare("UPDATE press_item SET public_status = 'WITHDRAWN' WHERE item_id = ?").run(item.item_id);
  await reviewPressClassification(db, item.item_id, "WELFARE", ["senior"], NOW + 2);
  assert.equal(await data.newsItem(item.item_id), null, "철회된 자료는 검토로 다시 공개하지 않는다");
});

test("규칙으로 확정된 항목은 검토 대상이 아니고, 제목이 바뀌면 검토가 지워지고 다시 규칙 분류한다", async () => {
  const { db, deps, clock, setFeed } = await seeded("2027년 지원 사업 공모 안내");
  const itemId = db.sqlite.prepare("SELECT item_id FROM press_item").get().item_id;
  await reviewPressClassification(db, itemId, "WELFARE", ["senior"], NOW);
  setFeed([{ title: "노인 돌봄 지원 사업 공모 안내(정정)", link: url(7) }]);
  clock.now += 7200;
  db.sqlite.prepare("UPDATE press_crawl_state SET etag = '', last_modified = ''").run();
  await collectPressSource(db, { source: await sourceOf(db), trigger: "manual" }, deps);
  const row = db.sqlite.prepare("SELECT classification_basis, rule_classification_status, reviewed_at, title_version FROM press_item WHERE item_id = ?").get(itemId);
  assert.deepEqual({ ...row }, { classification_basis: "title_rule", rule_classification_status: "", reviewed_at: null, title_version: 2 });
  assert.equal(await reviewPressClassification(db, itemId, "NON_WELFARE", [], NOW), "not_reviewable", "규칙으로 복지 확정된 항목은 검토 대기가 아니다");
});
