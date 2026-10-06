import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { setPressApproval } from "./press/admin.ts";
import { collectPressSource, suspiciousTitle } from "./press/collect.ts";
import { parseBoardProfile, parseHtmlBoard } from "./press/html-board.ts";
import { readSource } from "./press/store.ts";
import { NOW, collectDeps, database, response } from "./press-test-support.mjs";

const PROFILE = {
  link: "/press/view\\?seq=(?<id>\\d+)",
  url: "https://www.example.go.kr/press/view?seq={id}",
  title: "<strong class=\"subject\">([\\s\\S]*?)</strong>",
  date: "<dd>([\\d-]+)</dd>",
};
const BOARD = '<ul><li><a href="/menu">보도자료 안내 메뉴입니다 아주 긴 메뉴 이름</a></li>' +
  '<li><a href="/press/view?seq=101"><img alt="사진"><strong class="subject">노인 돌봄 &amp; 통합돌봄 확대</strong><div class="txt">SUMMARY-BODY 2020-01-01 요약은 읽지 않는다</div><dl><dt>제공일자</dt><dd>2026-10-02</dd></dl></a></li>' +
  '<li><a href="/press/view?seq=101">중복 링크</a></li>' +
  '<li><a href="/press/view?seq=102"><strong class="subject">장애인 일자리 지원</strong><dl><dd>2026-9-30</dd></dl></a></li>' +
  '<li><a href="/press/view?seq=../x"><strong class="subject">잘못된 번호</strong></a></li></ul>';

test("HTML 게시판에서 게시물 번호·제목·날짜만 읽고 요약은 버린다", () => {
  const items = parseHtmlBoard(BOARD, parseBoardProfile(JSON.stringify(PROFILE)));
  assert.deepEqual(items, [
    { title: "노인 돌봄 & 통합돌봄 확대", link: "https://www.example.go.kr/press/view?seq=101", guid: "101", pubDate: "2026-10-02" },
    { title: "장애인 일자리 지원", link: "https://www.example.go.kr/press/view?seq=102", guid: "102", pubDate: "2026-09-30" },
  ]);
  assert.ok(!JSON.stringify(items).includes("SUMMARY-BODY"));
});

test("제목은 링크 글자나 title 속성에서도 읽고, 날짜 설정이 없으면 게시물 구간의 첫 날짜를 쓴다", () => {
  const html = '<a class="tit" href="/v?no=7" title="복지관 개관">복지관 개…</a><span>2026.10.01</span><a href="/v?no=8">자립준비청년 지원</a><td>2026/09/29</td>';
  const byAttr = parseHtmlBoard(html, { link: "no=(?<id>\\d+)", url: "https://x.go.kr/v?no={id}", title: "attr:title" });
  assert.deepEqual(byAttr.map((i) => [i.title, i.pubDate]), [["복지관 개관", "2026-10-01"]]);
  const byText = parseHtmlBoard(html, { link: "no=(?<id>\\d+)", url: "https://x.go.kr/v?no={id}", title: "text" });
  assert.deepEqual(byText.map((i) => [i.title, i.pubDate]), [["복지관 개…", "2026-10-01"], ["자립준비청년 지원", "2026-09-29"]]);
});

test("날짜 칸을 지정한 게시판은 두 자리 연도(26.10.02.)를 2026-10-02로 읽고, 지정하지 않으면 두 자리 연도를 날짜로 보지 않는다", () => {
  const html = '<a href="/v?no=7" title="복지관 개관">복지관</a><td class="date">26.10.02.</td>';
  const dated = parseHtmlBoard(html, { link: "no=(?<id>\\d+)", url: "https://x.go.kr/v?no={id}", title: "attr:title", date: 'class="date">([^<]+)' });
  assert.equal(dated[0]?.pubDate, "2026-10-02");
  const plain = parseHtmlBoard(html, { link: "no=(?<id>\\d+)", url: "https://x.go.kr/v?no={id}", title: "attr:title" });
  assert.equal(plain[0]?.pubDate, "");
});

test("</a> 없이 칸이 끝나는 게시판은 tag=a-unclosed일 때 행마다 읽는다", () => {
  const row = (id, title, date) => `<tr><td class="sbj"><a href="/portal/briefing?articleSeq=${id}" onclick="goPage(${id}); return false;"\n>\n${title} \n</td><td class="date">${date}</td></tr>`;
  const html = "<table><tbody>" + row(254620, "보도자료[2026년 10월 2일(금)]", "2026-10-02") + row(254610, "보도자료[2026년 10월 1일(목)]", "2026-10-01") + row(254600, "보도자료[2026년 9월 30일(수)]", "2026-09-30") + "</tbody></table><a href=\"/etc\">기타</a>";
  const profile = { link: "articleSeq=(?<id>\\d+)", url: "https://x.go.kr/portal/briefing?articleSeq={id}", title: "^\\s*([^<]*[가-힣][^<]*)" };
  assert.ok(parseHtmlBoard(html, profile).length < 3, "닫힌 <a>만 읽으면 행을 빠뜨린다");
  assert.equal(parseBoardProfile(JSON.stringify({ ...profile, tag: "a-unclosed" }))?.tag, "a-unclosed");
  const items = parseHtmlBoard(html, { ...profile, tag: "a-unclosed" });
  assert.deepEqual(items.map((item) => [item.guid, item.title, item.pubDate]), [
    ["254620", "보도자료[2026년 10월 2일(금)]", "2026-10-02"], ["254610", "보도자료[2026년 10월 1일(목)]", "2026-10-01"], ["254600", "보도자료[2026년 9월 30일(수)]", "2026-09-30"],
  ]);
});

test("목록 행을 <button onclick>으로 그리는 게시판은 tag=button일 때만 읽는다", () => {
  const html = '<button onclick="fn_search_detail(\'B01\'); return false;"><strong class="t">복지관 개관</strong></button><span>2026-10-01</span>';
  const profile = { link: "fn_search_detail\\('(?<id>\\w+)'\\)", url: "https://x.go.kr/view.do?nttId={id}", title: '<strong class="t">\\s*([^<]+)' };
  assert.deepEqual(parseHtmlBoard(html, profile), []);
  const parsed = parseBoardProfile(JSON.stringify({ ...profile, tag: "button" }));
  assert.deepEqual(parseHtmlBoard(html, parsed).map((i) => [i.title, i.link, i.pubDate]), [["복지관 개관", "https://x.go.kr/view.do?nttId=B01", "2026-10-01"]]);
  assert.equal(parseBoardProfile(JSON.stringify({ ...profile, tag: "div" })), null);
});

test("링크 안의 게시일은 들여쓰기가 길어 구간 상한을 넘어도 읽는다", () => {
  const html = '<button onclick="fn_search_detail(\'B02\');"><strong class="t">경로당 개소</strong>' + " ".repeat(5000) + '<li class="regDate">2026-09-23</li></button>';
  const items = parseHtmlBoard(html, { link: "fn_search_detail\\('(?<id>\\w+)'\\)", url: "https://x.go.kr/view.do?nttId={id}", title: '<strong class="t">\\s*([^<]+)', tag: "button" });
  assert.equal(items[0]?.pubDate, "2026-09-23");
});

test("제목 속 꺾쇠 글자(<제2회 행사>)는 태그로 보지 않고 남긴다", () => {
  const html = '<a href="/v?no=9">노원구, <제2회 EU 그린데이> 참가 <i class="new">N</i></a><span>2026-10-02</span>';
  const items = parseHtmlBoard(html, { link: "no=(?<id>\\d+)", url: "https://x.go.kr/v?no={id}", title: "text" });
  assert.equal(items[0]?.title, "노원구, <제2회 EU 그린데이> 참가");
});

test("양평 게시판 새글 아이콘은 제목에서 제외하고 본래 제목의 새글·NEW는 보존한다", () => {
  const profile = { link: "no=(?<id>\\d+)", url: "https://x.go.kr/v?no={id}", title: "text" };
  const html = '<a href="/v?no=1">가족센터 캠페인 성료<span class="p-icon p-icon__new">새글</span></a>' +
    '<a href="/v?no=2">새글 쓰기 교육 NEW 프로그램</a>';
  assert.deepEqual(parseHtmlBoard(html, profile).map((item) => item.title), ["가족센터 캠페인 성료", "새글 쓰기 교육 NEW 프로그램"]);
});

test("암호화 게시물 번호(base64의 = + /)도 받아 원문 주소에 인코딩해 넣는다", () => {
  const html = '<a href="view?encid=sVo4+9/zA==">부천시 보도자료</a><span>2026-10-02</span>';
  const items = parseHtmlBoard(html, { link: "encid=(?<id>[\\w=+/-]+)", url: "https://x.go.kr/view?encid={id}", title: "text" });
  assert.deepEqual(items.map((i) => [i.guid, i.link]), [["sVo4+9/zA==", "https://x.go.kr/view?encid=sVo4%2B9%2FzA%3D%3D"]]);
});

test("설정 검사: id 그룹·https 주소 틀·올바른 정규식이 없으면 거절한다", () => {
  for (const bad of [
    "not json", "[]", JSON.stringify({ ...PROFILE, link: "seq=(\\d+)" }), JSON.stringify({ ...PROFILE, url: "http://a.go.kr/{id}" }),
    JSON.stringify({ ...PROFILE, url: "https://a.go.kr/view" }), JSON.stringify({ ...PROFILE, title: "([" }), JSON.stringify({ ...PROFILE, date: 3 }),
  ]) assert.equal(parseBoardProfile(bad), null, bad);
});

test("HTML Source 수집: 날짜만 있는 게시일을 보존하고 구조가 바뀌어 0건이면 파서 오류로 보류한다", async () => {
  const db = database();
  db.sqlite.prepare("UPDATE press_source SET adapter_profile = ?, allowed_hosts = ? WHERE source_id = 'src:gangwon:press'")
    .run(JSON.stringify(PROFILE), JSON.stringify(["www.example.go.kr"]));
  assert.equal(await setPressApproval(db, "src:gangwon:press", "approve", NOW), true);
  const source = await readSource(db, "src:gangwon:press");
  const ctx = collectDeps(async (_url, headers) => {
    assert.equal(headers.accept, "text/html");
    return ctx.body ? response(200, ctx.body) : response(200, BOARD);
  });
  const first = await collectPressSource(db, { source, trigger: "manual" }, ctx.deps);
  assert.equal(first.status, "succeeded");
  assert.equal(first.counts.created, 2);
  const rows = db.sqlite.prepare("SELECT published_date, published_at, publication_precision, timestamp_semantics, issued_by_org_id, public_status FROM press_item ORDER BY origin_id").all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { published_date: "2026-10-02", published_at: null, publication_precision: "date", timestamp_semantics: "html_list_date", issued_by_org_id: "org:강원특별자치도", public_status: "PUBLIC" },
    { published_date: "2026-09-30", published_at: null, publication_precision: "date", timestamp_semantics: "html_list_date", issued_by_org_id: "org:강원특별자치도", public_status: "PUBLIC" },
  ]);
  ctx.clock.now += 100_000;
  ctx.body = "<html><body>새 디자인</body></html>";
  const drift = await collectPressSource(db, { source, trigger: "manual" }, ctx.deps);
  assert.equal(drift.errorCode, "FEED_EMPTY");
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM press_item").get().n, 2);
});

test("링크 글자 전체를 제목으로 읽는 잘못된 프로필이어도 담당 정보·본문이 섞인 제목은 저장하지 않는다", async () => {
  const db = database();
  // 춘천시 목록 형태: 링크 안에 제목(<p>)·담당 정보 목록·본문 요약(<span>)이 함께 있다. title "text"는 이것을 모두 이어 붙인다.
  const board = '<ul>' +
    '<li><a href="/press/view?seq=201"><p>춘천의 가을, 세계 탱고인들과 만난다</p><ul><li>문화예술과</li><li>김자영</li><li>033-250-4226</li><li>2026-10-02</li></ul><span>춘천의 가을 본문 요약 돌봄</span></a></li>' +
    '<li><a href="/press/view?seq=202"><p>노인 돌봄 확대</p></a> 2026-10-02</li></ul>';
  db.sqlite.prepare("UPDATE press_source SET adapter_profile = ?, allowed_hosts = ? WHERE source_id = 'src:gangwon:press'")
    .run(JSON.stringify({ link: "/press/view\\?seq=(?<id>\\d+)", url: "https://www.example.go.kr/press/view?seq={id}", title: "text" }), JSON.stringify(["www.example.go.kr"]));
  assert.equal(await setPressApproval(db, "src:gangwon:press", "approve", NOW), true);
  const ctx = collectDeps(async () => response(200, board));
  const run = await collectPressSource(db, { source: await readSource(db, "src:gangwon:press"), trigger: "manual" }, ctx.deps);
  assert.equal(run.counts.rejected, 1);
  assert.deepEqual(db.sqlite.prepare("SELECT title FROM press_item").all().map((row) => row.title), ["노인 돌봄 확대"]);
  assert.equal(suspiciousTitle("2026년 노인일자리 모집(문의 061-270-5000)"), false, "전화번호만 있는 제목은 정상");
  assert.equal(suspiciousTitle("진안군 농민 공익수당 지급 출력문에 테그문 제거함수 --> 본문"), true);
  assert.equal(suspiciousTitle("가".repeat(151)), true);
});


test("robots 금지·확인 필요 Source는 승인할 수 없다", async () => {
  const db = database();
  // 확인 필요 예시는 마이그레이션 결과에서 고른다(경상북도는 2026-10-05 GET 원문 주소를 확인해 ENDPOINT_VERIFIED가 됐다).
  const review = db.sqlite.prepare("SELECT source_id FROM press_source WHERE verification_status = 'NEEDS_REVIEW' ORDER BY source_id LIMIT 1").get();
  assert.ok(review, "NEEDS_REVIEW Source가 있어야 한다");
  // 0082에서 충북·경남도 원문 확인과 운영자 예외 근거를 갖췄다. 별도 차단 fixture로 승인 거절을 계속 검사한다.
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM press_source WHERE verification_status = 'BLOCKED_ROBOTS'").get().n, 0);
  const blockedIds = ["src:chungbuk:press"];
  db.sqlite.prepare("UPDATE press_source SET verification_status = 'BLOCKED_ROBOTS', robots_exempt = '' WHERE source_id = ?").run(blockedIds[0]);
  for (const id of [...blockedIds, review.source_id]) {
    const before = db.sqlite.prepare("SELECT approval_status, enabled FROM press_source WHERE source_id = ?").get(id);
    assert.equal(await setPressApproval(db, id, "approve", NOW), false, id);
    assert.deepEqual(db.sqlite.prepare("SELECT approval_status, enabled FROM press_source WHERE source_id = ?").get(id), before, id);
  }
  const sejong = db.sqlite.prepare("SELECT verification_status, robots_exempt FROM press_source WHERE source_id = 'src:sejong:press'").get();
  assert.equal(sejong.verification_status, "ENDPOINT_VERIFIED");
  assert.ok(sejong.robots_exempt, "세종의 운영자 robots 예외 근거가 유지된다");
  assert.equal(await setPressApproval(db, "src:sejong:press", "approve", NOW), true);
  assert.deepEqual({ ...db.sqlite.prepare("SELECT approval_status, enabled FROM press_source WHERE source_id = 'src:sejong:press'").get() }, { approval_status: "POLICY_APPROVED", enabled: 1 });
  assert.equal(await setPressApproval(db, "src:seoul:press", "approve", NOW), true);
});

test("수집처 재확인 마이그레이션은 승인을 유지하되, 확인 상태가 내려가면 승인을 해제하고 수집을 끈다", async () => {
  const db = database();
  assert.equal(await setPressApproval(db, "src:seoul:press", "approve", NOW), true);
  const statement = readFileSync(new URL("../drizzle/0024_press_metro_recheck.sql", import.meta.url), "utf8")
    .split("--> statement-breakpoint").find((sql) => sql.includes("'src:seoul:press'"));
  db.sqlite.exec(statement);
  assert.deepEqual({ ...db.sqlite.prepare("SELECT approval_status, enabled FROM press_source WHERE source_id = 'src:seoul:press'").get() }, { approval_status: "POLICY_APPROVED", enabled: 1 });
  db.sqlite.exec(statement.replace("'ENDPOINT_VERIFIED'", "'BLOCKED_ROBOTS'"));
  assert.deepEqual({ ...db.sqlite.prepare("SELECT approval_status, enabled, verification_status FROM press_source WHERE source_id = 'src:seoul:press'").get() }, { approval_status: "PENDING_PERMISSION", enabled: 0, verification_status: "BLOCKED_ROBOTS" });
});
