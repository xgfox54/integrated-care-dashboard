import assert from "node:assert/strict";
import test from "node:test";

import { readComponents } from "./platform/bundle.ts";
import { assignRelatedGroups } from "./press/group.ts";
import { NOW, database } from "./press-test-support.mjs";

function seed() {
  const db = database();
  for (const [id, org] of [["metro", "org:경기도"], ["city", "org:경기도:양주시"]]) {
    db.sqlite.prepare("INSERT INTO press_source (source_id, organization_id, method, adapter, registry_version, approval_status, enabled) VALUES (?, ?, 'RSS', 'RSSAdapter', 'test', 'POLICY_APPROVED', 1)").run("src:test:" + id, org);
  }
  const insert = (id, source, org, title, discoveredAt) => db.sqlite.prepare(
    "INSERT INTO press_item (item_id, source_id, origin_id, canonical_url, title, title_hash, issued_by_org_id, published_date, publication_precision, discovered_at, collected_at, categories, classification_status, classification_basis, dictionary_version, public_status) " +
      "VALUES (?, ?, ?, ?, ?, 'h', ?, '2026-10-05', 'date', ?, ?, '[\"senior\"]', 'WELFARE', 'k', 'd', 'PUBLIC')",
  ).run(id, "src:test:" + source, id, "https://example.go.kr/" + id, title, org, discoveredAt, discoveredAt);
  return { db, insert };
}

const newsId = async (db) => (await readComponents(db)).news.id;

test("news version ignores a newly collected hidden metropolitan repost", async () => {
  const { db, insert } = seed();
  insert("metroA", "metro", "org:경기도", "경기도 어르신 돌봄 지원 확대", NOW);
  await assignRelatedGroups(db);
  const before = await newsId(db);
  insert("repostB", "city", "org:경기도:양주시", "경기도 어르신 돌봄 지원 확대", NOW + 600);
  await assignRelatedGroups(db);
  assert.equal(await newsId(db), before);
});

test("news version changes when a visible article is added", async () => {
  const { db, insert } = seed();
  insert("metroA", "metro", "org:경기도", "경기도 어르신 돌봄 지원 확대", NOW);
  const before = await newsId(db);
  insert("cityC", "city", "org:경기도:양주시", "양주시 경로당 냉방비 지원", NOW + 600);
  assert.notEqual(await newsId(db), before);
});

test("news version changes when a visible article is withdrawn", async () => {
  const { db, insert } = seed();
  insert("metroA", "metro", "org:경기도", "경기도 어르신 돌봄 지원 확대", NOW);
  insert("cityC", "city", "org:경기도:양주시", "양주시 경로당 냉방비 지원", NOW - 600);
  const before = await newsId(db);
  db.sqlite.prepare("UPDATE press_item SET public_status = 'WITHDRAWN' WHERE item_id = 'cityC'").run();
  assert.notEqual(await newsId(db), before);
});
