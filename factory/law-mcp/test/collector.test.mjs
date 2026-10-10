// 로컬 법령 수집기 시험. 도구 출력 형식은 korean-law-mcp 4.15.6 소스(search-hits.js formatHit, law-text.js)와 같게 만들었다.
// 실제 서버(stdio) 시험은 인증값 없이 initialize·tools/list와 인증값 누락 응답만 확인한다(법제처로 요청이 나가지 않는다).
import assert from "node:assert/strict";
import test from "node:test";

import { guardFetch, looksLikeAntibot } from "../src/antibot-guard.mjs";
import { buildBundle, collectItem } from "../src/collect.mjs";
import { articleStatus, failureKind, officialUrl, parseCitations, parseSearchHits, pickExact, upcomingNote, versionStatus } from "../src/parse.mjs";
import { openLawSession, serverEnv } from "../src/session.mjs";

const hit = (index, name, status, lawId, mst, prom, eff, kind) => index + ". " + name + status + "\n   - 법령ID: " + lawId + "\n   - MST: " + mst + "\n   - 공포일: " + prom + (eff ? " / 시행일: " + eff : "") + "\n   - 구분: " + kind + "\n\n";
const SEARCH = "🔍 법령 검색 결과 (2건):\n\n" + hit(1, "노인복지법", " [현행]", "001773", "270001", "20250121", "20250722", "법률") + hit(2, "노인복지법 시행령", " [현행]", "003690", "270100", "20250722", "20250722", "대통령령") + "💡 다음: get_law_text(mst=\"270001\")\n";

test("인용 글에서 법령명·조문을 뽑고 같은 법·시행령을 구분한다", () => {
  assert.deepEqual(parseCitations("노인복지법 제27조의2, 같은 법 시행령 제18조"), [{ lawName: "노인복지법", article: "제27조의2" }, { lawName: "노인복지법 시행령", article: "제18조" }]);
  assert.deepEqual(parseCitations("서울특별시 중랑구 노인복지 조례 제5조"), [{ lawName: "서울특별시 중랑구 노인복지 조례", article: "제5조" }]);
  assert.deepEqual(parseCitations("해당 없음"), []);
});

test("search_law 출력에서 법령ID·MST·공포일·시행일을 읽고, 정확히 같은 이름만 고른다", () => {
  const hits = parseSearchHits(SEARCH);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0], { name: "노인복지법", status: "현행", lawId: "001773", mst: "270001", promulgatedOn: "2025-01-21", effectiveOn: "2025-07-22", kind: "법률" });
  assert.equal(pickExact(hits, "노인복지법").mst, "270001");
  assert.equal(pickExact(hits, "노인복지"), null, "비슷한 이름으로 확정하지 않는다");
  assert.equal(versionStatus(hits[0], "2026-10-05"), "CURRENT");
  assert.equal(versionStatus({ ...hits[0], effectiveOn: "2026-12-01" }, "2026-10-05"), "FUTURE");
  assert.equal(versionStatus({ ...hits[0], status: "연혁" }, "2026-10-05"), "PAST");
  assert.equal(versionStatus(hits[0], "2026-10-05", "노인복지법은 2026. 1. 1. 폐지되었습니다"), "REPEALED");
  assert.equal(versionStatus(null, "2026-10-05"), "UNKNOWN");
  assert.equal(upcomingNote("📅 시행예정 개정: 2026-12-01 시행 (공포 2026-06-01)"), "📅 시행예정 개정: 2026-12-01 시행 (공포 2026-06-01)");
  assert.equal(articleStatus({ isError: true, content: [{ type: "text", text: "[NOT_FOUND] 조문을 찾을 수 없습니다." }] }), "NOT_FOUND");
  assert.equal(articleStatus({ content: [{ type: "text", text: "법령명: 노인복지법\n공포일: 20250121" }] }), "EXISTS");
  assert.equal(officialUrl("노인복지법", "제27조의2", "법률"), "https://www.law.go.kr/법령/" + encodeURIComponent("노인복지법") + "/" + encodeURIComponent("제27조의2"));
  assert.match(officialUrl("서울특별시 중랑구 노인복지 조례", null, null), /자치법규/);
  assert.equal(failureKind("API 키가 필요합니다. 법제처(https://open.law.go.kr/LSO/openApi/guideResult.do)에서 발급받으세요."), "AUTH_MISSING");
});

test("차단 페이지(location.assign)는 우회하지 않고 403으로 바꾸며, 다른 응답은 그대로 둔다", async () => {
  let blocked = 0;
  const html = (body) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  const guarded = guardFetch(async (url) => (String(url).includes("api") ? new Response("{\"a\":1}", { headers: { "content-type": "application/json" } }) : html("<script>x={t:'/a',h:'b',o:'c'};location.assign(x.t+x.h+x.o)</script>")), () => { blocked += 1; });
  const challenge = await guarded("https://www.law.go.kr/DRF/lawSearch.do?OC=secret&query=x");
  assert.equal(challenge.status, 403);
  assert.equal(blocked, 1);
  assert.equal((await guarded("https://www.law.go.kr/DRF/api")).status, 200);
  assert.equal((await guarded("https://example.org/page")).status, 200, "법제처가 아닌 호스트는 판정하지 않는다");
  assert.equal(looksLikeAntibot("text/html", "<html><body>법령</body></html>"), false);
  assert.deepEqual(Object.keys(serverEnv("")).sort(), ["NODE_ENV", "NO_COLOR", "PATH", "SYSTEMROOT"], "인증값이 없으면 LAW_OC를 넘기지 않고, 부모 환경 전체를 넘기지 않는다");
});

test("가짜 도구 응답으로 후보 한 건을 대조해 서버 반입 형식(필드 순서·해시)과 같은 묶음을 만든다", async () => {
  const calls = [];
  const callTool = async (name, args) => {
    calls.push([name, args]);
    if (name === "search_law") return { content: [{ type: "text", text: SEARCH }] };
    if (name === "get_law_text") return { content: [{ type: "text", text: "법령명: 노인복지법\n공포일: 20250121\n시행일: 20250722\n\n제27조의2(홀로 사는 노인에 대한 지원) ..." }] };
    return { content: [{ type: "text", text: "✅ 인용 2건 중 2건 실존 확인" }] };
  };
  const candidate = { candidate_id: "WLF0001:법령:service:x", target_kind: "service", target_id: "service:s1|서울특별시|중랑구|a|b|c", target_label: "식사배달", citation_text: "노인복지법 제27조의2", source: { kind: "GOV24_FIELD", id: "WLF0001", field: "법령" } };
  const item = await collectItem(candidate, "2026-10-05", callTool);
  assert.equal(item.status, "OK");
  assert.deepEqual(calls.map(([name]) => name), ["search_law", "get_law_text", "legal_analysis"]);
  assert.deepEqual(calls[1][1], { mst: "270001", jo: "제27조의2" });
  assert.equal(item.references[0].article_status, "EXISTS");
  assert.match(item.references[0].text_sha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(item).includes("홀로 사는 노인"), false, "조문 본문은 묶음에 넣지 않는다");
  const bundle = buildBundle([item], { queryDate: "2026-10-05", server: { name: "korean-law", version: "4.15.6" }, protocolSha: "a".repeat(64), blockedCount: 0 });
  const { importLawBundle } = await import("../../../lib/integrations/law-bundle.ts");
  const { database } = await import("../../../lib/press-test-support.mjs");
  const db = database();
  const report = await importLawBundle(db, JSON.stringify(bundle), 1_791_000_000);
  assert.equal(report.candidate_links, 1, "사이트 반입 검사(스키마·고정 버전·items_sha256)를 통과한다");
  assert.equal(db.sqlite.prepare("SELECT status FROM program_ext_link WHERE source_kind = 'LAW'").get().status, "CANDIDATE");
});

test("실제 korean-law-mcp 4.15.6(stdio): 인증값 없이 initialize·tools/list가 되고, 도구 호출은 인증값 누락으로 끝난다", { timeout: 60_000 }, async () => {
  const session = await openLawSession({ lawOc: "" });
  try {
    const server = session.client.getServerVersion();
    assert.deepEqual({ name: server.name, version: server.version }, { name: "korean-law", version: "4.15.6" });
    const { tools } = await session.client.listTools();
    for (const name of ["search_law", "get_law_text", "legal_analysis", "ordinance_radar", "legal_research", "execute_tool", "discover_tools"]) assert.ok(tools.some((tool) => tool.name === name), name);
    const item = await collectItem({ candidate_id: "c", target_kind: "service", target_id: "service:x", target_label: "", citation_text: "노인복지법 제27조의2", source: { kind: "MANUAL", id: "t", field: "법령" } }, "2026-10-05", (name, args) => session.client.callTool({ name, arguments: args }));
    assert.equal(item.status, "AUTH_MISSING");
    assert.equal(session.blocked.count, 0);
  } finally {
    await session.close();
  }
});
