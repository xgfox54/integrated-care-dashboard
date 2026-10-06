import assert from "node:assert/strict";
import test from "node:test";

import { ensureActiveBundle, listBundles, readBundlePointer, releaseBundleHold, rollbackActiveBundle } from "./platform/bundle.ts";
import { PUBLIC_KNOWLEDGE_RUN_SQL } from "./platform/public-pin.ts";
import { parsePressSearch, searchPress } from "./press/query.ts";
import { NOW, database } from "./press-test-support.mjs";

function seedRun(db, runId, completedAt) {
  const run = (sql, ...values) => db.sqlite.prepare(sql).run(...values);
  run("INSERT INTO official_sync_run (id, trigger, status, started_at, completed_at) VALUES (?, 'manual', 'succeeded', ?, ?)", runId, completedAt - 60, completedAt);
  run(
    "INSERT INTO official_service_snapshot (id, service_id, sync_run_id, sido, sigungu, category, subcategory, name, description, target, detail_target, provider, type, serial, detail_url, updated_date, collected_at, application_method) " +
      "VALUES (?, ?, ?, '강원특별자치도', '강릉시', '일상생활돌봄', '안부확인', ?, '', '', '', '강릉시청', '지자체', '1', '', '2026-07-01', ?, '')",
    runId + ":1", "0075:1:" + runId, runId, "사업 " + runId, completedAt,
  );
}

const publicRun = (db) => db.sqlite.prepare("SELECT " + PUBLIC_KNOWLEDGE_RUN_SQL + " AS id").get().id;

test("관리자가 이전 통합 공개본으로 되돌리면 웹이 그 공개본을 읽고, 보류 동안 자동 갱신이 넘어가지 않으며, 철회는 계속 적용된다", async () => {
  const db = database();
  seedRun(db, "run-a", NOW - 200);
  const first = await ensureActiveBundle(db, NOW - 100);
  db.sqlite.prepare("UPDATE press_source SET approval_status = 'POLICY_APPROVED', enabled = 1 WHERE source_id = 'src:mohw:press-rss'").run();
  db.sqlite.prepare(
    "INSERT INTO press_item (item_id, source_id, origin_id, canonical_url, title, title_hash, issued_by_org_id, published_date, publication_precision, discovered_at, collected_at, categories, classification_status, classification_basis, dictionary_version, public_status) " +
      "VALUES ('p1', 'src:mohw:press-rss', 'p1', 'https://example.go.kr/p1', '노인 돌봄 안내', 'h', 'org:mohw', '2026-10-01', 'DAY', ?, ?, '[\"senior\"]', 'WELFARE', 'k', 'd', 'PUBLIC')",
  ).run(NOW - 50, NOW - 50);
  seedRun(db, "run-b", NOW - 40);
  const second = await ensureActiveBundle(db, NOW - 30);
  assert.ok(second.changed && second.bundle.bundle_id !== first.bundle.bundle_id);
  assert.equal(publicRun(db), "run-b");
  const press = async () => (await searchPress(db, parsePressSearch(new URLSearchParams("")).search)).total_count;
  assert.equal(await press(), 1);

  const result = await rollbackActiveBundle(db, first.bundle.bundle_id, "새 수집 이상 확인", NOW);
  assert.deepEqual(result, { ok: true });
  assert.equal((await readBundlePointer(db)).hold_reason, "새 수집 이상 확인");
  assert.equal(publicRun(db), "run-a", "웹도 되돌린 공개본의 사업 수집을 읽는다");
  assert.equal(await press(), 0, "되돌린 공개본 경계 뒤의 보도자료는 보이지 않는다");
  const held = await ensureActiveBundle(db, NOW + 10);
  assert.equal(held.changed, false);
  assert.equal(held.bundle.bundle_id, first.bundle.bundle_id, "보류 중에는 배경 갱신이 넘어가지 않는다");
  assert.match(held.blocking[0], /관리자 보류/);

  const released = await releaseBundleHold(db, NOW + 20);
  assert.equal(released.bundle.bundle_id, second.bundle.bundle_id, "보류를 풀면 같은 구성요소의 기존 공개본으로 돌아온다");
  assert.equal(publicRun(db), "run-b");
  db.sqlite.prepare("UPDATE press_item SET public_status = 'WITHDRAWN' WHERE item_id = 'p1'").run();
  assert.equal(await press(), 0, "철회는 공개본과 무관하게 바로 적용");
  await rollbackActiveBundle(db, first.bundle.bundle_id, "", NOW + 30);
  assert.equal((await readBundlePointer(db)).hold_reason, "관리자 되돌리기", "사유가 비면 기본 사유");
  await releaseBundleHold(db, NOW + 40);
});

test("사업 수집 자료가 이미 정리된 공개본으로는 되돌리지 않고 이유를 보여 준다", async () => {
  const db = database();
  seedRun(db, "run-a", NOW - 200);
  const first = await ensureActiveBundle(db, NOW - 100);
  seedRun(db, "run-b", NOW - 40);
  await ensureActiveBundle(db, NOW - 30);
  db.sqlite.prepare("DELETE FROM official_service_snapshot WHERE sync_run_id = 'run-a'").run();
  const listed = (await listBundles(db)).find((bundle) => bundle.bundle_id === first.bundle.bundle_id);
  assert.match(listed.restore_blockers.join(), /정리됨/);
  const result = await rollbackActiveBundle(db, first.bundle.bundle_id, "x", NOW);
  assert.equal(result.ok, false);
  assert.equal(publicRun(db), "run-b");
  assert.equal((await readBundlePointer(db)).hold_reason, null);
  assert.equal((await rollbackActiveBundle(db, "rb_none", "x", NOW)).ok, false);
});
