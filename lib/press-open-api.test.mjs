import assert from "node:assert/strict";
import test from "node:test";

import { setPressApproval } from "./press/admin.ts";
import { autoApproveRobotsAllowed } from "./press/auto-approve.ts";
import { collectPressSource } from "./press/collect.ts";
import { parseOpenApiItems, parseOpenApiProfile, withApiKey } from "./press/open-api.ts";
import { readSource } from "./press/store.ts";
import { BODY_MARKER, NOW, collectDeps, database, response } from "./press-test-support.mjs";

const SOURCES = ["src:seoul:press-api", "src:gwacheon:press-api", "src:paju:press-api"];
const KEY = "test-key-abc123/=+";

test("마이그레이션은 키 자리({key})만 둔 Open API 수집처 3곳을 유효한 프로필로 등록한다", async () => {
  const db = database();
  for (const id of SOURCES) {
    const source = await readSource(db, id);
    assert.ok(source, id);
    assert.equal(source.adapter, "OpenAPIAdapter");
    assert.ok(source.endpointUrl.includes("{key}"), id);
    assert.ok(parseOpenApiProfile(source.adapterProfile), id);
  }
});

test("서울시 보도자료 응답에서 제목·게시일·원문 주소만 꺼내고 본문(CN)은 버린다", async () => {
  const db = database();
  const profile = parseOpenApiProfile((await readSource(db, "src:seoul:press-api")).adapterProfile);
  const body = JSON.stringify({ tvReportedInfo: { list_total_count: 2, RESULT: { CODE: "INFO-000", MESSAGE: "ok" }, row: [
    { TITLE: "서울시, 어르신에게 할인해 주는 &apos;시니어 동행상점&apos; 운영", PUBDATE: "2026-10-02", LINK: "https://www.seoul.go.kr/news/news_report.do#view/467572", CN: BODY_MARKER, DEPT: "고령사회대응과" },
    { TITLE: "링크 없는 행", PUBDATE: "2026-10-01", LINK: "", CN: BODY_MARKER },
  ] } });
  const items = parseOpenApiItems(body, profile);
  assert.deepEqual(items[0], { title: "서울시, 어르신에게 할인해 주는 '시니어 동행상점' 운영", link: "https://www.seoul.go.kr/news/news_report.do?bbsNo=158&nttNo=467572", guid: "467572", pubDate: "2026-10-02" });
  assert.equal(items[1].link, "", "번호를 못 꺼낸 행은 링크 없이 두어 저장 단계에서 걸러진다");
  assert.ok(!JSON.stringify(items).includes(BODY_MARKER));
  assert.deepEqual(parseOpenApiItems(JSON.stringify({ tvReportedInfo: { RESULT: { CODE: "INFO-200" } } }), profile), []);
  assert.throws(() => parseOpenApiItems(JSON.stringify({ RESULT: { CODE: "INFO-100", MESSAGE: "인증키가 유효하지 않습니다." } }), profile), { code: "API_KEY_INVALID" });
});

test("공공데이터포털 게이트웨이 오류는 키 문제(30·31)와 그 밖의 오류로 나눈다", async () => {
  const db = database();
  const profile = parseOpenApiProfile((await readSource(db, "src:paju:press-api")).adapterProfile);
  const gateway = (code) => JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: "E", returnReasonCode: code } } });
  assert.throws(() => parseOpenApiItems(gateway("30"), profile), { code: "API_KEY_INVALID" });
  assert.throws(() => parseOpenApiItems(gateway("12"), profile), { code: "API_ERROR" });
  assert.throws(() => parseOpenApiItems("<html>", profile), { code: "API_ERROR" });
  assert.equal(withApiKey("https://a.example/x?serviceKey={key}&n=1", "k%2F1"), "https://a.example/x?serviceKey=k%2F1&n=1");
});

test("Open API 수집처는 robots.txt를 읽지 않고 활용신청·이용약관 근거로 자동 승인한다", async () => {
  const db = database();
  db.sqlite.exec("UPDATE press_auto_approval SET checked_at = 0");
  db.sqlite.exec("UPDATE press_source SET verification_status = 'REGISTERED' WHERE adapter <> 'OpenAPIAdapter'");
  const fetched = [];
  const results = await autoApproveRobotsAllowed(db, async (address) => { fetched.push(address); return response(400, "<OpenAPI_ServiceResponse/>"); }, NOW, 10);
  assert.deepEqual(results.map((result) => [result.sourceId, result.verdict, result.approved]).sort(), SOURCES.map((id) => [id, "OPEN_API", true]).sort());
  assert.equal(fetched.length, 0);
  const rows = db.sqlite.prepare("SELECT approval_status, enabled, policy_basis FROM press_source WHERE adapter = 'OpenAPIAdapter'").all();
  for (const row of rows) {
    assert.equal(row.approval_status, "POLICY_APPROVED");
    assert.equal(row.enabled, 1);
    assert.ok(row.policy_basis.startsWith("기관 공개 Open API"));
  }
});

async function setupGwacheon(readApiKey) {
  const db = database();
  assert.equal(await setPressApproval(db, "src:gwacheon:press-api", "approve", NOW), true);
  const source = await readSource(db, "src:gwacheon:press-api");
  const calls = [];
  const ctx = collectDeps(async (address) => {
    if (address.endsWith("/robots.txt")) return response(404);
    calls.push(address);
    return response(200, JSON.stringify({ total: 2, success: true, limit: 30, items: [
      { title: "과천시, 제30회 노인의 날 기념식 성황리 개최", depart: "사회복지과", url: "https://www.gccity.go.kr/portal/newsList/view.do?mId=0301140100&idx=2454", createDate: "2026-10-02 16:20:35.0", contents: BODY_MARKER },
      { title: "과천시가족센터 이전 개소", depart: "가족정책과", url: "https://www.gccity.go.kr/portal/newsList/view.do?mId=0301140100&idx=2453", createDate: "2026-10-02 14:35:48.0", contents: BODY_MARKER },
    ] }));
  }, readApiKey ? { readApiKey } : {});
  return { db, calls, run: () => collectPressSource(db, { source, trigger: "manual" }, ctx.deps) };
}

test("인증키가 없으면 API를 부르지 않고 KEY_REQUIRED(차단)로 남긴다", async () => {
  const { db, calls, run } = await setupGwacheon(null);
  const summary = await run();
  assert.equal(summary.status, "failed");
  assert.equal(summary.errorCode, "KEY_REQUIRED");
  assert.equal(calls.length, 0);
  assert.equal(db.sqlite.prepare("SELECT technical_status FROM press_source WHERE source_id = 'src:gwacheon:press-api'").get().technical_status, "BLOCKED");
});

test("저장된 키로 부르고, 키·본문은 어디에도 저장하지 않는다", async () => {
  const { db, calls, run } = await setupGwacheon(async (ref) => (ref === "data_go_kr" ? encodeURIComponent(KEY) : null));
  const summary = await run();
  assert.equal(summary.status, "succeeded");
  assert.equal(summary.counts.created, 2);
  assert.ok(calls[0].includes("serviceKey=" + encodeURIComponent(KEY)));
  const stored = JSON.stringify([
    db.sqlite.prepare("SELECT * FROM press_item").all(),
    db.sqlite.prepare("SELECT * FROM press_collection_run").all(),
    db.sqlite.prepare("SELECT * FROM press_crawl_state").all(),
    db.sqlite.prepare("SELECT * FROM press_source").all(),
  ]);
  for (const forbidden of [BODY_MARKER, KEY, encodeURIComponent(KEY)]) assert.ok(!stored.includes(forbidden), forbidden);
  const item = db.sqlite.prepare("SELECT canonical_url, timestamp_semantics, published_date FROM press_item ORDER BY canonical_url DESC").get();
  assert.deepEqual({ ...item }, { canonical_url: "https://www.gccity.go.kr/portal/newsList/view.do?mId=0301140100&idx=2454", timestamp_semantics: "api_pubdate", published_date: "2026-10-02" });
});

test("같은 원문 주소를 다른 Source가 이미 저장했으면 Open API 항목을 새로 넣지 않는다", async () => {
  const { db, run } = await setupGwacheon(async () => "k");
  db.sqlite.prepare("INSERT INTO press_item (item_id, source_id, origin_id, canonical_url, title, title_hash, issued_by_org_id, published_date, publication_precision, discovered_at, collected_at, classification_status, classification_basis, dictionary_version, public_status) VALUES ('board:1', 'src:mohw:press-rss', '1', ?, 't', 'h', 'org:경기도:과천시', '2026-10-02', 'date', 1, 1, 'WELFARE', 'rule', 'v1', 'PUBLIC')")
    .run("https://www.gccity.go.kr/portal/newsList/view.do?mId=0301140100&idx=2454");
  const summary = await run();
  assert.equal(summary.counts.created, 1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM press_item WHERE canonical_url LIKE '%idx=2454'").get().n, 1);
});

test("시간대 없는 기관 날짜는 한국시간으로 읽는다", async () => {
  const { parsePublicationDate } = await import("./press/normalize.ts");
  assert.deepEqual(parsePublicationDate("2026-10-02 16:20:35.0", NOW + 86400 * 30), { epoch: Date.parse("2026-10-02T16:20:35+09:00") / 1000, date: "2026-10-02", precision: "datetime" });
  assert.deepEqual(parsePublicationDate("2026/10/02", NOW + 86400 * 30), { epoch: null, date: "2026-10-02", precision: "date" });
  assert.equal(parsePublicationDate("2026-10-02 23:30", NOW + 86400 * 30).date, "2026-10-02");
});
