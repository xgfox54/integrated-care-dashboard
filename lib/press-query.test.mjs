import assert from "node:assert/strict";
import test from "node:test";

import { setPressApproval } from "./press/admin.ts";
import { collectPressSource } from "./press/collect.ts";
import { readPressCoverage } from "./press/coverage.ts";
import { parsePressSearch, readPressRegions, searchPress } from "./press/query.ts";
import { readWebPin } from "./platform/public-pin.ts";
import { NOW, SOURCE_ID, collectDeps, database, feedXml, response, sourceOf, url } from "./press-test-support.mjs";

const FEED = [
  { title: "복지부, 지역사회 통합돌봄 시범사업 확대", link: url(201), pubDate: "Fri, 02 Oct 2026 07:50:00 GMT" },
  { title: "노인 장기요양 100% 보장 방안", link: url(202), pubDate: "Tue, 29 Sep 2026 01:00:00 GMT" },
  { title: "보건복지부, 신규 지원 안내", link: url(203), pubDate: "Mon, 28 Sep 2026 01:00:00 GMT" },
  { title: "복지부 장관 해외 출장", link: url(204) },
];
const search = (query = "") => {
  const parsed = parsePressSearch(new URLSearchParams(query));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  return parsed.search;
};

async function collected() {
  const db = database();
  await setPressApproval(db, SOURCE_ID, "approve", NOW);
  const { deps } = collectDeps(async () => response(200, feedXml(FEED)));
  await collectPressSource(db, { source: await sourceOf(db), trigger: "manual" }, deps);
  return db;
}

test("공개 조회는 복지로 분류된 항목만 최신순으로 돌려주고 검토·비복지는 숨긴다", async () => {
  const result = await searchPress(await collected(), search());
  assert.equal(result.total_count, 2);
  assert.deepEqual(result.items.map((item) => item.title), ["복지부, 지역사회 통합돌봄 시범사업 확대", "노인 장기요양 100% 보장 방안"]);
});

test("오래된순 정렬과 화면 필터용 기관·분야·기관 유형별 공개 건수", async () => {
  const db = await collected();
  const oldest = await searchPress(db, search("sort=oldest"));
  assert.deepEqual(oldest.items.map((item) => item.title), ["노인 장기요양 100% 보장 방안", "복지부, 지역사회 통합돌봄 시범사업 확대"]);
  assert.equal(parsePressSearch(new URLSearchParams("sort=popular")).ok, false);
  const regions = await readPressRegions(db);
  assert.deepEqual(regions.by_organization.map((organization) => [organization.organization_id, organization.count]), [["org:mohw", 2]]);
  assert.equal(regions.by_organization_type.CENTRAL, 2);
  // 한 게시물이 여러 분야에 속할 수 있어 분야별 합은 게시물 수보다 클 수 있다. 공개 항목만 센다.
  const categoryTotal = Object.values(regions.by_category).reduce((sum, value) => sum + value, 0);
  assert.ok(categoryTotal >= 2);
  assert.ok(regions.by_category.integrated_care >= 1);
});

test("공개 DTO에는 본문 성격의 필드가 없고 메타데이터 전용임을 밝힌다", async () => {
  const [item] = (await searchPress(await collected(), search())).items;
  assert.deepEqual(Object.keys(item).sort(), [
    "article_id", "category_ids", "classification_basis", "content_scope", "discovered_at", "document_kind", "duplicate_group", "issued_by", "original_url",
    "press_release_id", "publication_precision", "published_at", "published_date", "publisher_region", "related_group", "schema_version", "source_kind", "source_registry_version", "title",
  ]);
  assert.equal(item.content_scope, "metadata_only");
  assert.equal(item.source_kind, "OFFICIAL_PRESS_RELEASE");
  assert.deepEqual(item.issued_by, { organization_id: "org:mohw", name: "보건복지부", type: "CENTRAL", basis: "source_owner_single_publisher_board", reposted_by: null });
});

test("키워드·분야·기간·기관 필터가 AND로 적용되고 LIKE 기호는 글자로 취급한다", async () => {
  const db = await collected();
  assert.equal((await searchPress(db, search("q=장기요양"))).total_count, 1);
  assert.equal((await searchPress(db, search("q=%25"))).total_count, 1);
  assert.equal((await searchPress(db, search("q=_"))).total_count, 0);
  assert.equal((await searchPress(db, search("q=100%25"))).total_count, 1);
  assert.equal((await searchPress(db, search("category=integrated_care"))).total_count, 1);
  assert.equal((await searchPress(db, search("from=2026-10-01"))).total_count, 1);
  assert.equal((await searchPress(db, search("to=2026-09-30"))).total_count, 1);
  assert.equal((await searchPress(db, search("organization_type=CENTRAL"))).total_count, 2);
  assert.equal((await searchPress(db, search("organization_type=METROPOLITAN"))).total_count, 0);
  assert.equal((await searchPress(db, search("organization_id=org:mohw&q=통합돌봄&category=senior"))).total_count, 0);
});

test("잘못된 입력은 안전한 오류 문구로 거절한다", () => {
  for (const query of ["category=nope", "organization_type=X", "from=어제", "from=2026-10-02&to=2026-10-01"]) {
    assert.equal(parsePressSearch(new URLSearchParams(query)).ok, false, query);
  }
  assert.equal(parsePressSearch(new URLSearchParams("size=999&page=-3")).search.size, 50);
});

test("승인을 해제하면 이미 수집한 자료도 공개 목록에서 즉시 빠진다", async () => {
  const db = await collected();
  await setPressApproval(db, SOURCE_ID, "revoke", NOW);
  assert.equal((await searchPress(db, search())).total_count, 0);
  assert.equal((await readPressCoverage(db, NOW)).coverage.approved_active_sources, 0);
});

test("endpoint 확인을 마치지 않은 Source는 승인할 수 없다", async () => {
  const db = database();
  db.sqlite.exec("UPDATE press_source SET verification_status = 'REGISTERED'");
  assert.equal(await setPressApproval(db, SOURCE_ID, "approve", NOW), false);
});

test("수집 범위는 분모와 함께 보이고 등록 기관 수를 수집률로 쓰지 않는다", async () => {
  const db = await collected();
  const coverage = await readPressCoverage(db, NOW + 60);
  // 294곳 모두 대상(화성시 일반구 4곳은 2026-10-05 실재 확인으로 SEED_UNVERIFIED 해제, drizzle/0064. 정책브리핑 부처별 목록으로 중앙행정기관 9곳 추가, drizzle/0079).
  assert.equal(coverage.targets.organizations, 294);
  assert.equal(coverage.targets.by_type.GENERAL_DISTRICT, 39);
  assert.equal(coverage.targets.by_type.ADMINISTRATIVE_CITY, 2);
  // 시·군·구 자동 탐색(0026)으로 확인 기관이 늘어난다. 상수 대신 Source 표와 기관 조사표를 서로 대조한다.
  const one = (sql) => db.sqlite.prepare(sql).get().n;
  const verifiedOrgs = one("SELECT COUNT(DISTINCT organization_id) AS n FROM press_source WHERE verification_status = 'ENDPOINT_VERIFIED'");
  assert.ok(verifiedOrgs >= 11);
  assert.equal(coverage.coverage.endpoint_verified_organizations, verifiedOrgs);
  assert.equal(coverage.coverage.reviewed_organizations, one("SELECT COUNT(DISTINCT organization_id) AS n FROM press_source"));
  // 0082가 충북·경남의 공식 보도자료 경로를 확인했다. 실제 보안 차단에 대한 수집 정책은 바꾸지 않는다.
  assert.equal(coverage.coverage.sources_by_verification.BLOCKED_ROBOTS ?? 0, 0);
  assert.deepEqual(db.sqlite.prepare("SELECT source_id FROM press_source WHERE verification_status = 'BLOCKED_ROBOTS' ORDER BY source_id").all().map((row) => row.source_id), []);
  assert.equal(one("SELECT COUNT(*) AS n FROM press_source WHERE verification_status = 'BLOCKED_ROBOTS' AND (enabled <> 0 OR approval_status <> 'PENDING_PERMISSION')"), 0, "남은 robots 차단 Source는 활성화하지 않는다");
  assert.deepEqual({ ...db.sqlite.prepare("SELECT verification_status, approval_status, enabled FROM press_source WHERE source_id = 'src:sejong:press'").get() }, { verification_status: "ENDPOINT_VERIFIED", approval_status: "PENDING_PERMISSION", enabled: 0 }, "endpoint 검증만으로 자동 승인 실행 전 활성화되지는 않는다");
  // registry r10(0054)이 최근 1년 게시물이 없는 보관 게시판(화순군)을 확인에서 되돌림. 경상북도는 0065에서 ENDPOINT_VERIFIED가 됐다.
  assert.equal(coverage.coverage.sources_by_verification.NEEDS_REVIEW, 1);
  assert.equal(Object.values(coverage.survey.by_category).reduce((sum, value) => sum + value, 0), 294, "시드 기관 전부가 다섯 분류 중 하나로 설명된다");
  assert.equal(coverage.survey.by_category.endpoint_confirmed, verifiedOrgs, "조사표의 endpoint 확인 기관과 확인 Source 기관이 같다");
  assert.equal(one("SELECT COUNT(*) AS n FROM press_source WHERE approval_status = 'POLICY_APPROVED' AND source_id <> 'src:mohw:press-rss'"), 0, "새 Source는 승인 대기로 들어온다");
  assert.equal(coverage.coverage.normal_organizations_24h, 1);
  assert.deepEqual(coverage.runs_24h, { total: 1, succeeded: 1, gap_possible: 0, gap_recovered: 0 });
  assert.equal(coverage.items.public_total, 2);
  assert.equal(coverage.items.latest_published_date, "2026-10-02");
  assert.equal(coverage.schedule.mode, "request_driven");
  assert.match(coverage.targets.basis, /검증되지 않음/);
});

test("보도자료 테이블에는 본문·요약·이미지·작성자 성격의 열이 없다", () => {
  const db = database();
  const tables = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'press_%'").all();
  // 13번째: press_auto_approval(robots 판정 기록, 본문 열 없음). 14~17번째(0071 수집 지침): robots 점검 기록·변경 이력, 수집 차단 목록, 전체 수집 스위치.
  assert.equal(tables.length, 17, "새 press_ 테이블은 이 검사 대상에 넣고 개수를 고친다");
  for (const { name } of tables) {
    for (const column of db.sqlite.prepare(`PRAGMA table_info(${name})`).all()) {
      assert.doesNotMatch(column.name, /description|content|body|summary|snippet|thumbnail|image|author|excerpt/, `${name}.${column.name}`);
    }
  }
});

test("웹 지역 필터는 발행기관 관할로 찾고, 통합 시·도 별칭·시→일반구 포함·게시일 미확인을 구분한다", async () => {
  const db = database();
  const run = (sql, ...values) => db.sqlite.prepare(sql).run(...values);
  const orgs = { goyang: "org:경기도:고양시", deogyang: "org:경기도:고양시:덕양구", gwangju: "org:광주광역시", mokpo: "org:전남광주통합특별시:목포시", seogwipo: "org:제주특별자치도:서귀포시" };
  for (const [key, org] of Object.entries(orgs)) {
    run("INSERT INTO press_source (source_id, organization_id, method, adapter, registry_version, approval_status, enabled) VALUES (?, ?, 'RSS', 'RSSAdapter', 'test', 'POLICY_APPROVED', 1)", "src:t:" + key, org);
  }
  const item = (id, key, date) => run(
    "INSERT INTO press_item (item_id, source_id, origin_id, canonical_url, title, title_hash, issued_by_org_id, published_date, publication_precision, discovered_at, collected_at, categories, classification_status, classification_basis, dictionary_version, public_status) " +
      "VALUES (?, ?, ?, ?, ?, 'h', ?, ?, 'DAY', ?, ?, '[\"senior\"]', 'WELFARE', 'k', 'd', 'PUBLIC')",
    id, "src:t:" + key, id, "https://example.go.kr/" + id, "노인 돌봄 " + id, orgs[key], date, NOW, NOW,
  );
  item("g1", "goyang", "2026-10-01");
  item("d1", "deogyang", "2026-10-02");
  item("k1", "gwangju", "2026-10-02");
  item("m1", "mokpo", "");
  item("s1", "seogwipo", "2026-10-03");
  const ids = async (query) => (await searchPress(db, search(query))).items.map((row) => row.article_id).sort();
  assert.deepEqual(await ids("sido=경기도"), ["d1", "g1"], "시·도는 그 안 모든 발행기관");
  assert.deepEqual(await ids("sido=경기도&sigungu=고양시"), ["g1"], "하위 포함을 켜지 않으면 시 본청만");
  assert.deepEqual(await ids("sido=경기도&sigungu=고양시&include_descendants=1"), ["d1", "g1"], "시 → 일반구");
  assert.deepEqual(await ids("sido=전남광주통합특별시"), ["k1", "m1"], "통합 시·도는 옛 광주광역시 발행기관도 포함");
  assert.deepEqual(await ids("sido=제주특별자치도&sigungu=서귀포시"), ["s1"], "제주 → 서귀포(행정시)");
  assert.deepEqual(await ids("date_unknown=1"), ["m1"]);
  assert.equal((await searchPress(db, search("sido=경기도"))).region_basis, "publisher_jurisdiction");
  assert.equal(parsePressSearch(new URLSearchParams("date_unknown=1&from=2026-10-01")).ok, false, "게시일 미확인과 기간은 함께 쓰지 않는다");
  assert.equal(parsePressSearch(new URLSearchParams("region_basis=mentioned")).ok, false, "내용상 지역은 본문이 없어 거절");
  assert.ok(parsePressSearch(new URLSearchParams("region_basis=publisher_jurisdiction")).ok);
  const regions = await readPressRegions(db);
  assert.equal(regions.by_sido["경기도"], 2);
  assert.equal((regions.by_sido["광주광역시"] ?? 0) + (regions.by_sido["전남광주통합특별시"] ?? 0), 2);
  assert.ok(regions.areas.some((area) => area.sigungu === "고양시 덕양구" && area.count === 1 && area.organization_type === "GENERAL_DISTRICT"));
});

test("웹 보도자료 목록도 활성 통합 공개본의 발견 시각 경계까지만 보이고 공개본 ID를 함께 돌려준다", async () => {
  const db = await collected();
  const before = await searchPress(db, search());
  assert.equal(before.release_bundle_id, null, "공개본이 없으면 경계 없음");
  db.sqlite.prepare(
    "INSERT INTO platform_release_bundle (bundle_id, bundle_schema_version, components_key, knowledge_snapshot_id, fiscal_snapshot_id, news_snapshot_id, link_snapshot_id, components_json, compatibility_report, status, created_at) VALUES ('rb_t', '1.0', 'k', NULL, NULL, 'news:t', NULL, ?, '{}', 'active', ?)",
  ).run(JSON.stringify({ news: { detail: { discovered_watermark: NOW - 1 } }, fiscal: { detail: { snapshot_ids: ["fs:a"] } } }), NOW);
  db.sqlite.prepare("UPDATE platform_active_bundle SET bundle_id = 'rb_t' WHERE id = 1").run();
  const pinned = await searchPress(db, search());
  assert.equal(pinned.release_bundle_id, "rb_t");
  assert.equal(pinned.total_count, 0, "공개본 경계 뒤에 발견된 항목은 다음 공개본까지 웹에도 나오지 않는다");
  const coverage = await readPressCoverage(db, NOW);
  assert.equal(coverage.items.public_total, 0, "상단 집계도 목록과 같은 공개본을 센다");
  assert.equal(coverage.items.display_total, 0);
  assert.equal(coverage.items.latest_published_date, "");
  assert.deepEqual(await readWebPin(db), { bundleId: "rb_t", fiscalSnapshotIds: ["fs:a"] });
  db.sqlite.prepare("UPDATE platform_release_bundle SET components_json = ? WHERE bundle_id = 'rb_t'").run(JSON.stringify({ news: { detail: { discovered_watermark: NOW + 10 } } }));
  assert.equal((await searchPress(db, search())).total_count, before.total_count);
  assert.equal((await readPressRegions(db)).by_sido ? true : false, true);
});
