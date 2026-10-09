import assert from "node:assert/strict";
import test from "node:test";

import { countPress, parsePressSearch, searchPress } from "./press/query.ts";
import { NOW, database } from "./press-test-support.mjs";

// D-04: 관계성 지도의 보도자료 수(countPress, 동일 자료 묶음 대표 1건)와 /api/press 목록 전체 쪽의 항목이 같다. 합성 자료.

function setup() {
  const db = database();
  const run = (sql, ...values) => db.sqlite.prepare(sql).run(...values);
  run("INSERT INTO press_source (source_id, organization_id, method, adapter, registry_version, approval_status, enabled) VALUES ('src:t', 'org:경기도:고양시', 'RSS', 'RSSAdapter', 'test', 'POLICY_APPROVED', 1)");
  const item = (id, title, group = null) => run(
    "INSERT INTO press_item (item_id, source_id, origin_id, canonical_url, title, title_hash, issued_by_org_id, published_date, publication_precision, discovered_at, collected_at, categories, classification_status, classification_basis, dictionary_version, public_status, duplicate_group_id) " +
      "VALUES (?, 'src:t', ?, ?, ?, ?, 'org:경기도:고양시', '2026-10-02', 'DAY', ?, ?, '[\"senior\"]', 'WELFARE', 'title_rule', 'd', 'PUBLIC', ?)",
    id, id, "https://example.go.kr/" + id, title, "h-" + id, NOW, NOW, group,
  );
  item("n1", "노인 일자리 박람회");
  item("n2", "어르신 건강 강좌");
  item("n3", "65세 이상 독감 예방접종");
  for (let index = 0; index < 23; index += 1) item("bulk" + String(index).padStart(2, "0"), "노인 돌봄 안내 " + index);
  item("dup-a", "어르신 무료 급식 확대", "dg:1");
  item("dup-b", "어르신 무료 급식 확대", "dg:1");
  item("youth", "청년 월세 지원");
  return db;
}

test("T09 보도자료: 지도 집계 수 = 목록 총건수 = 목록 전체 쪽 합집합(동일 자료 묶음은 대표 1건)", async () => {
  const db = setup();
  const search = (page) => parsePressSearch(new URLSearchParams({ target_group: "elderly", group_mode: "verified_groups", size: "10", page: String(page) })).search;
  const counted = await countPress(db, search(1));
  const seen = new Set();
  let total = 0;
  for (let page = 1; page <= 10; page += 1) {
    const result = await searchPress(db, search(page));
    total = result.total_count;
    for (const item of result.items) seen.add(item.article_id);
    if (result.items.length === 0) break;
  }
  assert.equal(counted, total);
  assert.equal(seen.size, counted);
  assert.ok(seen.has("n2") && seen.has("n3"), "「어르신」「65세」만 있는 제목도 포함");
  assert.ok(!seen.has("youth"));
  const old = await countPress(db, parsePressSearch(new URLSearchParams({ q: "노인", group_mode: "verified_groups" })).search);
  assert.ok(old < counted, "감사 당시 링크(q=노인)는 일부만 보였다");
});
