import assert from "node:assert/strict";
import test from "node:test";

import { assignRelatedGroups, readPendingRelatedGroups, rejectRelatedGroup, titleKey, verifyDuplicateGroup } from "./press/group.ts";
import { McpData } from "./mcp/data.ts";
import { parsePressSearch, searchPress } from "./press/query.ts";
import { NOW, database } from "./press-test-support.mjs";

function seed() {
  const db = database();
  const run = (sql, ...values) => db.sqlite.prepare(sql).run(...values);
  run("UPDATE press_source SET approval_status = 'POLICY_APPROVED', enabled = 1 WHERE source_id = 'src:mohw:press-rss'");
  for (const [id, org] of [["a", "org:서울특별시"], ["b", "org:부산광역시"]]) {
    run("INSERT INTO press_source (source_id, organization_id, method, adapter, registry_version, approval_status, enabled) VALUES (?, ?, 'RSS', 'RSSAdapter', 'test', 'POLICY_APPROVED', 1)", "src:test:" + id, org);
  }
  run("INSERT INTO press_source (source_id, organization_id, method, adapter, registry_version, approval_status, enabled) VALUES ('src:test:c', 'org:인천광역시', 'RSS', 'RSSAdapter', 'test', 'PENDING_PERMISSION', 0)");
  const item = (id, source, org, title, date, status = "PUBLIC") => run(
    "INSERT INTO press_item (item_id, source_id, origin_id, canonical_url, title, title_hash, issued_by_org_id, published_date, publication_precision, discovered_at, collected_at, categories, classification_status, classification_basis, dictionary_version, public_status) " +
      "VALUES (?, ?, ?, ?, ?, 'h', ?, ?, 'date', ?, ?, '[\"senior\"]', 'WELFARE', 'k', 'd', ?)",
    id, source, id, "https://example.go.kr/" + id, title, org, date, NOW, NOW, status,
  );
  item("i1", "src:mohw:press-rss", "org:mohw", "[보도자료] 노인 일자리 사업 참여자 모집 확대!", "2026-10-01");
  item("i2", "src:test:a", "org:서울특별시", "노인 일자리 사업 참여자 모집 확대", "2026-10-02");
  item("i3", "src:test:b", "org:부산광역시", "노인 일자리 사업 참여자 모집 확대", "2026-10-09");
  item("i4", "src:test:a", "org:서울특별시", "[보도참고자료] 노인 일자리 사업 참여자 모집 확대", "2026-10-02");
  item("i5", "src:test:c", "org:인천광역시", "노인 일자리 사업 참여자 모집 확대", "2026-10-02");
  item("i6", "src:test:b", "org:부산광역시", "알림", "2026-10-02");
  item("i7", "src:mohw:press-rss", "org:mohw", "알림", "2026-10-02");
  return db;
}

test("제목 열쇠는 앞머리 꼬리표·문장부호·공백을 지운다", () => {
  assert.equal(titleKey("[보도자료] 노인 일자리 사업 참여자 모집 확대!"), titleKey("노인 일자리 사업, 참여자 모집 확대"));
  assert.notEqual(titleKey("노인 일자리 확대"), titleKey("노인 일자리 축소"));
});

test("다른 기관·3일 안의 같은 제목만 관련 묶음으로 잇고, 공개 구성원만 센다", async () => {
  const db = seed();
  const result = await assignRelatedGroups(db);
  assert.equal(result.keyed, 7);
  const groups = Object.fromEntries(db.sqlite.prepare("SELECT item_id, related_group_id FROM press_item").all().map((row) => [row.item_id, row.related_group_id]));
  assert.ok(groups.i1 && groups.i1 === groups.i2, "보건복지부와 서울시 같은 제목(1일 차이)은 묶인다");
  assert.equal(groups.i4, groups.i1, "서울시 다른 게시물도 보건복지부 글과는 같은 묶음");
  assert.equal(groups.i3, null, "7일 넘게 차이 나면 묶지 않는다");
  assert.equal(groups.i6, null, "짧은 제목(알림)은 묶지 않는다");
  assert.equal(await assignRelatedGroups(db).then((again) => again.linked), 0, "다시 돌려도 바뀌지 않는다");
  const parsed = parsePressSearch(new URLSearchParams("q=노인"));
  const page = await searchPress(db, parsed.search);
  const dto = page.items.find((item) => item.article_id === "i2");
  assert.equal(dto.related_group.verified_same_release, false);
  assert.equal(dto.related_group.public_member_count, 3, "미승인 Source(i5)는 세지 않는다");
  assert.equal(page.items.find((item) => item.article_id === "i3").related_group, null);
  assert.equal(page.total_count, 4, "게시물은 묶여도 출처별로 그대로 남는다");
});


test("광역자치단체 보도자료를 소속 시·군이 같은 제목으로 다시 올리면 공개 목록·건수에서 광역 글만 보이고, 다른 시·도·중앙부처와 같은 제목은 그대로 둔다", async () => {
  const { readPressRegions } = await import("./press/query.ts");
  const { readPressCoverage } = await import("./press/coverage.ts");
  const db = database();
  const run = (sql, ...values) => db.sqlite.prepare(sql).run(...values);
  run("UPDATE press_source SET approval_status = 'POLICY_APPROVED', enabled = 1 WHERE source_id = 'src:mohw:press-rss'");
  for (const [id, org] of [["gg", "org:경기도"], ["yj", "org:경기도:양주시"], ["sl", "org:서울특별시"], ["gd", "org:서울특별시:강동구"]]) {
    run("INSERT INTO press_source (source_id, organization_id, method, adapter, registry_version, approval_status, enabled) VALUES (?, ?, 'RSS', 'RSSAdapter', 'test', 'POLICY_APPROVED', 1)", "src:test:" + id, org);
  }
  const item = (id, source, org, title, date) => run(
    "INSERT INTO press_item (item_id, source_id, origin_id, canonical_url, title, title_hash, issued_by_org_id, published_date, publication_precision, discovered_at, collected_at, categories, classification_status, classification_basis, dictionary_version, public_status) " +
      "VALUES (?, ?, ?, ?, ?, 'h', ?, ?, 'date', ?, ?, '[\"senior\"]', 'WELFARE', 'k', 'd', 'PUBLIC')",
    id, source, id, "https://example.go.kr/" + id, title, org, date, NOW, NOW,
  );
  item("gg1", "src:test:gg", "org:경기도", "경기도, 6일부터 어르신 인플루엔자 접종 시작…코로나19 동시접종 권고", "2026-10-05");
  item("yj1", "src:test:yj", "org:경기도:양주시", "경기도, 6일부터 어르신 인플루엔자 접종 시작…코로나19 동시접종 권고", "2026-10-05");
  item("yj2", "src:test:yj", "org:경기도:양주시", "양주시 어르신 돌봄 박람회 개최", "2026-10-05");
  item("gd1", "src:test:gd", "org:서울특별시:강동구", "경기도, 6일부터 어르신 인플루엔자 접종 시작…코로나19 동시접종 권고", "2026-10-05");
  item("mw1", "src:mohw:press-rss", "org:mohw", "노인 일자리 사업 참여자 모집 확대", "2026-10-02");
  item("gd2", "src:test:gd", "org:서울특별시:강동구", "노인 일자리 사업 참여자 모집 확대", "2026-10-02");
  await assignRelatedGroups(db);
  const ids = (await searchPress(db, parsePressSearch(new URLSearchParams("size=50")).search)).items.map((entry) => entry.article_id).sort();
  assert.deepEqual(ids, ["gd1", "gd2", "gg1", "mw1", "yj2"], "양주시가 다시 올린 경기도 보도자료(yj1)만 숨긴다. 다른 시·도(강동구)와 중앙부처 재게시는 남는다");
  const gg = (await searchPress(db, parsePressSearch(new URLSearchParams("q=인플루엔자")).search)).items.find((entry) => entry.article_id === "gg1");
  assert.equal(gg.related_group.public_member_count, 2, "숨긴 재게시는 관련 묶음 수에도 세지 않는다");
  const regions = await readPressRegions(db);
  assert.equal(regions.by_organization.find((row) => row.organization_id === "org:경기도:양주시").count, 1);
  assert.equal((await readPressCoverage(db, NOW)).items.public_total, 5);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM press_item WHERE item_id = 'yj1'").get().n, 1, "저장된 글은 지우지 않는다");
});

test("재게시 B를 원문으로 지정한 동일 묶음에서도 광역 A가 남고 공개본 경계와 화면 집계가 일치한다", async () => {
  const { readPressCoverage } = await import("./press/coverage.ts");
  const db = database();
  for (const [id, org] of [["metroA", "org:경기도"], ["repostB", "org:경기도:양주시"]]) {
    db.sqlite.prepare("INSERT INTO press_source (source_id, organization_id, method, adapter, registry_version, approval_status, enabled) VALUES (?, ?, 'RSS', 'RSSAdapter', 'test', 'POLICY_APPROVED', 1)").run("src:test:" + id, org);
    db.sqlite.prepare(
      "INSERT INTO press_item (item_id, source_id, origin_id, canonical_url, title, title_hash, issued_by_org_id, published_date, publication_precision, discovered_at, collected_at, categories, classification_status, classification_basis, dictionary_version, public_status) " +
        "VALUES (?, ?, ?, ?, '경기도 어르신 돌봄 지원 확대', 'h', ?, '2026-10-05', 'date', ?, ?, '[\"senior\"]', 'WELFARE', 'k', 'd', 'PUBLIC')",
    ).run(id, "src:test:" + id, id, "https://example.go.kr/" + id, org, NOW, NOW);
  }
  await assignRelatedGroups(db);
  const related = db.sqlite.prepare("SELECT related_group_id FROM press_item WHERE item_id = 'metroA'").get().related_group_id;
  assert.ok(await verifyDuplicateGroup(db, related, "repostB", NOW));
  const check = async (expected, scenario) => {
    const grouped = await searchPress(db, parsePressSearch(new URLSearchParams("group_mode=verified_groups")).search);
    assert.deepEqual(grouped.items.map((item) => item.article_id), expected, scenario);
    assert.equal(grouped.total_count, expected.length, scenario);
    const coverage = await readPressCoverage(db, NOW);
    assert.equal(coverage.items.display_total, grouped.total_count, scenario + ": 화면 집계 일치");
    assert.equal(coverage.items.public_total, expected.length, scenario + ": 공개 게시물 집계 일치");
    const posts = await searchPress(db, parsePressSearch(new URLSearchParams()).search);
    assert.deepEqual(posts.items.map((item) => item.article_id), expected, scenario + ": 게시물 모드도 같은 공개 후보");
  };
  await check(["metroA"], "숨겨지는 재게시 B가 대표 후보에서 빠져 광역 A가 남는다");
  db.sqlite.prepare(
    "INSERT INTO platform_release_bundle (bundle_id, bundle_schema_version, components_key, components_json, compatibility_report, status, created_at) VALUES ('rb_repost', '1.0', 'repost', ?, '{}', 'active', ?)",
  ).run(JSON.stringify({ news: { detail: { discovered_watermark: NOW } } }), NOW);
  db.sqlite.prepare("UPDATE platform_active_bundle SET bundle_id = 'rb_repost' WHERE id = 1").run();
  await check(["metroA"], "발견 시각이 공개본 경계와 같으면 포함한다");
  db.sqlite.prepare("UPDATE press_item SET discovered_at = ? WHERE item_id = 'metroA'").run(NOW + 1);
  await check(["repostB"], "경계 밖 광역 A가 경계 안 재게시 B를 숨기지 않는다");
  db.sqlite.prepare("UPDATE press_item SET discovered_at = CASE WHEN item_id = 'metroA' THEN ? ELSE ? END").run(NOW, NOW + 1);
  await check(["metroA"], "경계 밖 지정 원문 B가 경계 안 광역 A의 대표 자리를 차지하지 않는다");
  db.sqlite.prepare("UPDATE platform_release_bundle SET components_json = ? WHERE bundle_id = 'rb_repost'").run(JSON.stringify({ news: { detail: { discovered_watermark: NOW - 1 } } }));
  await check([], "모든 구성원이 경계 밖이면 목록과 집계 모두 비어 있다");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM press_item").get().n, 2, "저장된 구성원은 지우지 않는다");
});

test("관리자가 같은 자료로 확정한 묶음만 대표 1건으로 접고, 구성원 조회·철회·다른 자료 판정이 따로 동작한다", async () => {
  const db = seed();
  await assignRelatedGroups(db);
  const related = db.sqlite.prepare("SELECT related_group_id FROM press_item WHERE item_id = 'i1'").get().related_group_id;
  const pending = await readPendingRelatedGroups(db);
  assert.deepEqual(pending.filter((row) => row.related_group_id === related).map((row) => row.item_id).sort(), ["i1", "i2", "i4"], "미승인 Source(i5)는 확인 대기에 나오지 않는다");
  const search = (query) => searchPress(db, parsePressSearch(new URLSearchParams(query)).search);
  assert.equal((await search("q=노인&group_mode=verified_groups")).total_count, 4, "비슷한 제목만으로는 접지 않는다");
  assert.equal(await verifyDuplicateGroup(db, related, "i9", NOW), null, "묶음 밖 게시물은 원 출처로 고를 수 없다");
  const groupId = await verifyDuplicateGroup(db, related, "i2", NOW);
  assert.ok(groupId.startsWith("dg:"));
  assert.equal((await readPendingRelatedGroups(db)).length, 0, "확정한 묶음은 대기에서 빠진다");
  const grouped = await search("q=노인&group_mode=verified_groups");
  assert.equal(grouped.total_count, 2, "확정 묶음 대표 1건 + 묶음 밖 i3");
  const { readPressCoverage } = await import("./press/coverage.ts");
  const coverage = await readPressCoverage(db, NOW);
  const allGrouped = await search("group_mode=verified_groups");
  assert.equal(coverage.items.display_total, allGrouped.total_count, "상단 공개 건수는 화면의 중복 제거 기준과 같다");
  assert.equal(coverage.items.post_count, 6, "원래 게시물 수는 별도 보존한다");
  assert.equal(grouped.result_unit, "verified_group_or_item");
  const representative = grouped.items.find((item) => item.duplicate_group);
  assert.equal(representative.article_id, "i2", "고른 원 발행 출처가 대표");
  assert.equal(representative.duplicate_group.other_sources_count, 2);
  assert.equal(representative.related_group.verified_same_release, true);
  assert.equal((await search("q=노인")).total_count, 4, "API 기본(items)은 게시물별 그대로");
  const members = await search("group_mode=items&duplicate_group_id=" + encodeURIComponent(groupId));
  assert.deepEqual(members.items.map((item) => item.article_id).sort(), ["i1", "i2", "i4"]);
  assert.equal(parsePressSearch(new URLSearchParams("group_mode=verified_groups&duplicate_group_id=" + groupId)).ok, false, "모순된 조합은 거절");
  assert.equal(parsePressSearch(new URLSearchParams("group_mode=all")).ok, false);
  db.sqlite.prepare("UPDATE press_item SET public_status = 'WITHDRAWN' WHERE item_id = 'i2'").run();
  const afterWithdraw = (await search("q=노인&group_mode=verified_groups")).items.find((item) => item.duplicate_group);
  assert.equal(afterWithdraw.article_id, "i1", "대표가 철회되면 다음 이른 게시물이 대표");
  assert.equal(afterWithdraw.duplicate_group.other_sources_count, 1, "철회된 구성원은 세지 않는다");
  const mcp = new McpData(db, async () => new Map());
  const filter = { queryTokens: ["노인"], categoryIds: [], organizationIds: [], organizationTypes: [], sido: "", sigungu: "", includeDescendants: false, dateFrom: "", dateTo: "", dateBasis: "published" };
  assert.equal((await mcp.news({ ...filter, groupMode: "verified_groups" }, 0, 20)).total, 2, "MCP 묶음 모드는 묶음 대표 1건 + 묶음 밖 i3");
  assert.equal((await mcp.news({ ...filter, groupMode: "items" }, 0, 20)).total, 3, "MCP 게시물 단위는 철회된 i2를 뺀 3건");
});

test("제목만 같은 다른 자료로 판정하면 대기에서만 빠지고 묶음으로 접지 않는다", async () => {
  const db = seed();
  await assignRelatedGroups(db);
  const related = db.sqlite.prepare("SELECT related_group_id FROM press_item WHERE item_id = 'i1'").get().related_group_id;
  await rejectRelatedGroup(db, related, NOW);
  assert.equal((await readPendingRelatedGroups(db)).length, 0);
  const page = await searchPress(db, parsePressSearch(new URLSearchParams("q=노인&group_mode=verified_groups")).search);
  assert.equal(page.total_count, 4);
  assert.ok(page.items.every((item) => item.duplicate_group === null));
});
