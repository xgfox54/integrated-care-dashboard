import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { database, NOW } from "./press-test-support.mjs";
import { compactSearchSql, compactSearchText } from "./mcp/search-text.ts";
import { profileDatabase } from "./d1-profile.ts";
import { databaseIdentity } from "./sql-database.ts";
import { enforceApiRateLimit, apiRatePolicy, mcpRecentlyActive, mcpToolCallWeight } from "./api-rate-limit.ts";
import { isTransientStoreError, storeErrorKind } from "./store-errors.ts";
import { McpData } from "./mcp/data.ts";
import { handleMcpRequest } from "./mcp/server.ts";
import { searchGov24Services } from "./mcp/gov24.ts";
import { refineWelfareQuery } from "./mcp/query-refiner.ts";
import { advanceSearchFtsBackfill } from "./mcp/search-fts.ts";
import { createSearchCacheInstance, createSearchResultCache } from "./mcp/search-cache.ts";

function seedSearchRows(db) {
  db.sqlite.prepare("INSERT INTO official_sync_run (id, trigger, status, started_at, completed_at) VALUES ('fts-run','manual','succeeded',?,?)").run(NOW - 5, NOW);
  const program = db.sqlite.prepare("INSERT INTO official_service_snapshot (id, service_id, sync_run_id, sido, sigungu, category, subcategory, name, description, target, detail_target, provider, type, serial, detail_url, updated_date, collected_at, application_method) VALUES (?,?,'fts-run','서울특별시',?,'돌봄','방문',?,?,?,'','구청','지자체','1','','2026-01-01',?,'방문')");
  program.run("p1", "A1", "강남구", "노인 맞춤 돌봄 서비스", "65세 이상 어르신 안부 확인", "노인", NOW);
  program.run("p2", "A2", "서초구", "치매 안심센터 운영", "치매 조기검진과 쉼터", "치매환자", NOW);
  program.run("p3", "A3", "강남구", "장애인 활동지원", "활동지원급여 제공", "장애인", NOW);
  program.run("p4", "A4", "강남구", "노인 무료급식", "경로식당 운영(돌봄 연계)", "노인", NOW);
  const gov = db.sqlite.prepare("INSERT INTO gov24_service (service_id, name, org_name, org_type, purpose, target, criteria, benefit, apply_method, detail_url, modified_at, detail_modified_at, detail_status, detail_fetched_at, first_seen_at, last_seen_at, presence, list_run_id) VALUES (?,?,'보건복지부','중앙행정기관',?,?,'선정기준','지원내용','방문',?, '1','1','COLLECTED',?,?,?,'PRESENT','l1')");
  gov.run("G1", "기초연금", "노후 소득 보장", "만 65세 이상", "https://www.gov.kr/G1", NOW, NOW, NOW);
  gov.run("G2", "노인맞춤돌봄서비스", "일상생활 지원", "독거 노인", "https://www.gov.kr/G2", NOW, NOW, NOW);
  gov.run("G3", "장애인활동지원", "활동지원급여", "장애인", "https://www.gov.kr/G3", NOW, NOW, NOW);
}

function sqlSpy(db) {
  const seen = [];
  return { seen, db: { ...db, prepare(sql) { seen.push(sql); return db.prepare(sql); } } };
}

test("검색 전문 인덱스 경로는 전체 조회 경로와 같은 사업·정부24 결과를 낸다", async () => {
  const indexed = database(); seedSearchRows(indexed);
  const scanned = database(); seedSearchRows(scanned);
  scanned.sqlite.prepare("UPDATE search_fts_state SET completed_at = NULL").run();
  const spy = sqlSpy(indexed);
  const programIds = async (db, queryTokens) => (await new McpData(db, async () => new Map()).programs("fts-run", { sido: "", sigungu: "", includeAncestorScope: false, categories: [], targetKeywords: [], queryTokens }, 0, 30)).rows.map((row) => row.serviceId + ":" + row.name);
  for (const tokens of [["노인맞춤"], ["돌봄서비스"], ["노인", "돌봄"], ["활동지원", "장애인"], ["조기검진"], ["없는사업명"]]) {
    assert.deepEqual(await programIds(spy.db, tokens), await programIds(scanned, tokens), tokens.join(" "));
  }
  assert.ok(spy.seen.some((sql) => sql.includes("official_service_search_fts MATCH")), "3글자 이상 낱말은 인덱스 경로를 쓴다");
  for (const question of ["기초연금 신청 방법", "노인맞춤돌봄서비스 대상", "장애인활동지원 급여"]) {
    const plan = refineWelfareQuery(question);
    assert.deepEqual((await searchGov24Services(spy.db, plan, 8)).map((item) => item.id), (await searchGov24Services(scanned, plan, 8)).map((item) => item.id), question);
  }
  assert.ok(spy.seen.some((sql) => sql.includes("gov24_search_fts MATCH")), "정부24도 인덱스 경로를 쓴다");
});

test("검색 전문 인덱스의 기존 행 채우기는 구간별로 끝까지 채우고 완료를 기록한다", async () => {
  const db = database(); seedSearchRows(db);
  db.sqlite.exec("DELETE FROM official_service_search_fts; DELETE FROM gov24_search_fts;");
  db.sqlite.prepare("UPDATE search_fts_state SET completed_at = NULL, next_rowid = 0, backfill_limit = (SELECT MAX(rowid) FROM official_service_search) WHERE name = 'official_service_search'").run();
  db.sqlite.prepare("UPDATE search_fts_state SET completed_at = NULL, next_rowid = 0, backfill_limit = (SELECT MAX(rowid) FROM gov24_search) WHERE name = 'gov24_search'").run();
  const progress = await advanceSearchFtsBackfill(db);
  assert.deepEqual(progress.map((item) => [item.name, item.done]), [["gov24_search", true], ["official_service_search", true]]);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM official_service_search_fts").get().n, 4);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM gov24_search_fts").get().n, 3);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM search_fts_state WHERE completed_at IS NULL").get().n, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM official_service_search_fts WHERE official_service_search_fts MATCH '\"노인맞춤\"'").get().n, 1);
  assert.deepEqual(await advanceSearchFtsBackfill(db), [], "완료 뒤에는 할 일이 없다");
});

test("Claude 공개 경로 한도는 oc 키별로 따로 세고 경로 전체 총량으로 묶는다", async () => {
  const counts = new Map();
  const db = { prepare: () => ({ bind: (key) => ({ key }) }), batch: async (statements) => statements.map((item) => { const n = (counts.get(item.key) ?? 0) + 1; counts.set(item.key, n); return { results: [{ request_count: n }] }; }) };
  const request = (ip) => new Request("https://owned.test/claude/mcp", { headers: { "cf-connecting-ip": ip } });
  const policy = apiRatePolicy("/claude/mcp");
  const at = 1800000120;
  for (let n = 0; n < policy.subjectLimit; n++) assert.equal(await enforceApiRateLimit(request("203.0.113.70"), db, at, { clientKey: "kim" }), null);
  assert.equal((await enforceApiRateLimit(request("203.0.113.70"), db, at, { clientKey: "kim" })).status, 429, "같은 키는 키 한도에서 막힌다");
  assert.equal(await enforceApiRateLimit(request("203.0.113.70"), db, at, { clientKey: "lee" }), null, "같은 출구 IP의 다른 키는 따로 센다");
  assert.ok([...counts.keys()].some((key) => key.includes(":client-v1:")) && [...counts.keys()].some((key) => key.endsWith(":global-v1")));
  let i = 0;
  while ((counts.get("mcp-claude:" + Math.floor(at / 60) + ":global-v1") ?? 0) < policy.globalLimit) {
    assert.equal(await enforceApiRateLimit(request("198.51.100." + (i % 200)), db, at, { clientKey: "user-" + i }), null);
    i++;
  }
  assert.equal((await enforceApiRateLimit(request("198.51.100.250"), db, at, { clientKey: "new-user" })).status, 429, "경로 총량을 넘으면 새 키도 막힌다");
});

test("통합 검색은 같은 질문을 공유 캐시에서 재사용한다", async () => {
  const db = database(); seedSearchRows(db);
  const writes = [];
  const searchCache = createSearchResultCache({ db, defer: (task) => writes.push(task), instance: createSearchCacheInstance() });
  const call = async () => (await (await handleMcpRequest(new Request("https://dashboard.example/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: { query: "기초연금  신청 방법" } } }),
  }), new McpData(db, async () => new Map()), () => {}, { includeLaw: false, searchCache })).json()).result.structuredContent;
  const first = await call();
  assert.equal(first.cache, "MISS");
  await Promise.all(writes);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM mcp_search_cache").get().n, 1);
  const second = await call();
  assert.equal(second.cache, "HIT");
  assert.deepEqual(second.results, first.results);
  assert.equal(second.release_bundle_id, first.release_bundle_id);
});

// 검색 가속 표는 요청 때 계산하던 정규화 식과 같은 값을 저장해야 한다(결과 불변).
test("검색 가속 마이그레이션은 코드의 정규화 식을 그대로 쓴다", () => {
  const sql = readFileSync(new URL("../drizzle/0113_search_acceleration.sql", import.meta.url), "utf8");
  for (const field of ["name", "description", "target", "provider", "subcategory"]) assert.ok(sql.includes(compactSearchSql("NEW." + field)), field);
  assert.ok(sql.includes(compactSearchSql("NEW.name || ' ' || COALESCE(NEW.purpose,'') || ' ' || COALESCE(NEW.target,'') || ' ' || COALESCE(NEW.criteria,'') || ' ' || COALESCE(NEW.benefit,'')")));
});

test("D1 오류는 원문 없이 종류로 나누고 일시 오류만 재시도 대상으로 본다", () => {
  assert.equal(storeErrorKind(new Error("D1_ERROR: Database is overloaded. Requests queued for too long.")), "D1_OVERLOADED");
  assert.equal(storeErrorKind(new Error("D1_ERROR: Network connection lost.")), "D1_NETWORK");
  assert.equal(storeErrorKind(new Error("D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.")), "D1_TIMEOUT");
  assert.equal(storeErrorKind(new Error("D1_ERROR: no such column: x")), "D1_OTHER");
  assert.equal(storeErrorKind(new Error("plain failure")), null);
  assert.equal(isTransientStoreError(new Error("D1_ERROR: Database is overloaded")), true);
  assert.equal(isTransientStoreError(new Error("D1_ERROR: no such column: x")), false);
});

test("통합 검색은 일시적인 D1 오류를 한 번 다시 시도하고 retried_sources로 알린다", async () => {
  const base = database();
  let failed = 0;
  const flaky = { ...base, prepare(sql) { const statement = base.prepare(sql); if (!/(?:FROM|CROSS JOIN) gov24_service g\b/.test(sql)) return statement; const wrap = (inner) => ({ bind: (...values) => wrap(inner.bind(...values)), all: async () => { if (failed++ === 0) throw new Error("D1_ERROR: Database is overloaded."); return inner.all(); }, first: async () => inner.first(), run: async () => inner.run() }); return wrap(statement); } };
  const response = await handleMcpRequest(new Request("https://dashboard.example/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: { query: "기초연금 신청방법" } } }),
  }), new McpData(flaky, async () => new Map()), () => {}, { includeLaw: false });
  const result = (await response.json()).result.structuredContent;
  assert.deepEqual(result.retried_sources, ["gov24"]);
  assert.equal(result.source_errors, undefined, "재시도가 성공하면 출처 오류로 남기지 않는다");
  assert.equal(failed, 2);
});

test("최근 1~2분 안의 MCP 한도 기록이 있으면 배경 수집이 양보한다", async () => {
  const db = database();
  const now = 1800000000;
  const window = Math.floor(now / 60);
  assert.equal(await mcpRecentlyActive(db, now), false);
  db.sqlite.prepare("INSERT INTO api_rate_limit (bucket_key, request_count, expires_at) VALUES (?, 1, ?)").run("law:" + (window + 1) + ":ip-v2:abc", now + 120);
  assert.equal(await mcpRecentlyActive(db, now + 60), false, "다른 경로의 기록은 세지 않는다");
  db.sqlite.prepare("INSERT INTO api_rate_limit (bucket_key, request_count, expires_at) VALUES (?, 1, ?)").run("mcp:" + (window + 1) + ":ip-v2:abc", now + 180);
  assert.equal(await mcpRecentlyActive(db, now + 120), true, "직전 창의 MCP 기록도 활동으로 본다");
  assert.equal(await mcpRecentlyActive(db, now + 240), false, "2분이 지나면 다시 수집한다");
});


test("사업 스냅샷 검색 표는 삽입·수정·삭제를 따라가고 요청 시 계산값과 같다", () => {
  const db = database();
  db.sqlite.prepare("INSERT INTO official_sync_run (id, trigger, status, started_at, completed_at) VALUES ('r1','manual','succeeded',?,?)").run(NOW - 5, NOW);
  const insert = db.sqlite.prepare("INSERT INTO official_service_snapshot (id, service_id, sync_run_id, sido, sigungu, category, subcategory, name, description, target, detail_target, provider, type, serial, detail_url, updated_date, collected_at, application_method) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  insert.run("s1", "svc1", "r1", "서울특별시", "강남구", "돌봄", "식사·지원", "노인 (맞춤) 돌봄 · ABC", "설명 - 본문/내용", "대상: 65세", "", "강남구 보건소", "지자체", "1", "", "2026-01-01", NOW, "방문");
  const check = () => {
    const row = db.sqlite.prepare("SELECT c.*, " + ["name", "description", "target", "provider", "subcategory"].map((field) => compactSearchSql("s." + field) + " AS expected_" + field).join(", ") + " FROM official_service_snapshot s JOIN official_service_search c ON c.snapshot_id = s.id WHERE s.id = 's1'").get();
    for (const field of ["name", "description", "target", "provider", "subcategory"]) assert.equal(row[field + "_c"], row["expected_" + field], field);
    return row;
  };
  assert.equal(check().name_c, compactSearchText("노인 (맞춤) 돌봄 · ABC"));
  db.sqlite.prepare("UPDATE official_service_snapshot SET name = '치매 · 안심 Center' WHERE id = 's1'").run();
  assert.equal(check().name_c, "치매안심center");
  db.sqlite.prepare("DELETE FROM official_service_snapshot WHERE id = 's1'").run();
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM official_service_search").get().n, 0);
});

test("정부24 검색 표는 서비스 변경을 따라가고 요청 시 계산값과 같다", () => {
  const db = database();
  const insert = db.sqlite.prepare("INSERT INTO gov24_service (service_id, name, org_name, org_type, purpose, target, criteria, benefit, apply_method, detail_url, modified_at, detail_modified_at, detail_status, detail_fetched_at, first_seen_at, last_seen_at, presence, list_run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  insert.run("G1", "기초 연금(Basic)", "보건복지부", "중앙행정기관", "목적 · 내용", null, "선정-기준", "월 30만원", "방문", "https://www.gov.kr/G1", "1", "1", "COLLECTED", NOW, NOW, NOW, "PRESENT", "l1");
  const content = "g.name || ' ' || COALESCE(g.purpose,'') || ' ' || COALESCE(g.target,'') || ' ' || COALESCE(g.criteria,'') || ' ' || COALESCE(g.benefit,'')";
  const read = () => db.sqlite.prepare("SELECT c.name_c, c.content_c, " + compactSearchSql("g.name") + " AS en, " + compactSearchSql(content) + " AS ec FROM gov24_service g JOIN gov24_search c ON c.service_id = g.service_id WHERE g.service_id = 'G1'").get();
  let row = read();
  assert.equal(row.name_c, row.en); assert.equal(row.content_c, row.ec);
  db.sqlite.prepare("UPDATE gov24_service SET benefit = '월 40만원 지급', detail_status = 'COLLECTED' WHERE service_id = 'G1'").run();
  row = read();
  assert.equal(row.content_c, row.ec); assert.match(row.content_c, /40만원지급/);
  db.sqlite.prepare("DELETE FROM gov24_service WHERE service_id = 'G1'").run();
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM gov24_search").get().n, 0);
});

test("D1 프로파일러는 문장별 비용을 모으고 원래 문장으로 batch를 실행하며 원본 식별자를 알려 준다", async () => {
  const seen = [];
  const statement = (sql) => ({ sql, bind: () => statement(sql), all: async () => ({ results: [{ v: 1 }], meta: { duration: 2.5, rows_read: 10 } }), first: async () => { throw new Error("first() must not be used"); }, run: async () => ({ meta: { duration: 1, rows_read: 0 } }) });
  const raw = { prepare: statement, batch: async (statements) => { seen.push(...statements); return statements.map(() => ({ meta: { duration: 3 } })); } };
  const { db, report } = profileDatabase(raw);
  assert.deepEqual(await db.prepare("SELECT  v\n FROM t WHERE x = ?").bind(1).first(), { v: 1 });
  await db.prepare("SELECT v FROM t WHERE x = ?").bind(2).all();
  const prepared = db.prepare("UPDATE t SET v = 1");
  await db.batch([prepared]);
  assert.equal(seen[0].sql, "UPDATE t SET v = 1");
  assert.ok(!("bind" in seen[0] && seen[0] === prepared), "batch에는 래퍼가 아니라 원래 문장을 넘긴다");
  const result = report();
  assert.equal(result.top.find((item) => item.sql === "SELECT v FROM t WHERE x = ?").calls, 2);
  assert.equal(result.rows_read, 20);
  assert.equal(databaseIdentity(db), raw);
});

test("인증없는 /mcp 요청 한도는 IP·경로 총량 버킷을 D1 왕복 한 번(batch)으로 센다", async () => {
  const counts = new Map(); let batches = 0, singles = 0;
  const statement = (sql) => ({ bind: (key) => ({ key, first: async () => { singles++; return { request_count: 1 }; } }) });
  const db = { prepare: statement, batch: async (statements) => { batches++; return statements.map((item) => { const n = (counts.get(item.key) ?? 0) + 1; counts.set(item.key, n); return { results: [{ request_count: n }] }; }); } };
  const request = (ip) => new Request("https://owned.test/mcp", { headers: { "cf-connecting-ip": ip } });
  const policy = apiRatePolicy("/mcp");
  assert.equal(policy.subjectLimit, undefined, "/mcp는 로그인 사용자 단위 한도를 두지 않는다");
  for (let n = 0; n < policy.limit; n++) assert.equal(await enforceApiRateLimit(request("203.0.113.40"), db, 1800000000), null);
  assert.equal((await enforceApiRateLimit(request("203.0.113.40"), db, 1800000000)).status, 429);
  assert.equal(batches, policy.limit + 1); assert.equal(singles, 0);
  assert.equal(await enforceApiRateLimit(request("203.0.113.41"), db, 1800000000), null, "다른 출구 IP는 경로 총량 안에서 계속 쓸 수 있다");
});

test("검증된 사용자 지연 기록 모드는 즉시 판단하고 D1 기록을 응답 뒤로 미루며 한도를 넘기면 막는다", async () => {
  const counts = new Map(); const deferred = [];
  let open; const gate = new Promise((resolve) => { open = resolve; });
  const statement = () => ({ bind: (key) => ({ key }) });
  const db = { prepare: statement, batch: async (statements) => { await gate; return statements.map((item) => { const n = (counts.get(item.key) ?? 0) + 1; counts.set(item.key, n); return { results: [{ request_count: n }] }; }); } };
  const request = () => new Request("https://owned.test/claude/mcp", { headers: { "cf-connecting-ip": "203.0.113.50" } });
  const limit = apiRatePolicy("/claude/mcp").subjectLimit;
  const context = { verifiedSubject: "deferred-user", defer: (task) => deferred.push(task) };
  for (let n = 0; n < limit; n++) assert.equal(await enforceApiRateLimit(request(), db, 1800000060, context), null);
  assert.equal(counts.size, 0, "판단 시점에는 D1을 기다리지 않는다");
  open();
  await Promise.all(deferred);
  assert.equal([...counts.values()].includes(limit), true, "미룬 기록은 모두 D1에 반영된다");
  const blocked = await enforceApiRateLimit(request(), db, 1800000060, context);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
});

test("/mcp 한도는 tools/call만 세고 초기화·알림·도구 목록은 D1에 기록하지 않는다", async () => {
  const post = (body) => new Request("https://owned.test/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(await mcpToolCallWeight(post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })), 0);
  assert.equal(await mcpToolCallWeight(post({ jsonrpc: "2.0", method: "notifications/initialized" })), 0);
  assert.equal(await mcpToolCallWeight(post({ jsonrpc: "2.0", id: 2, method: "tools/list" })), 0);
  assert.equal(await mcpToolCallWeight(post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search" } })), 1);
  assert.equal(await mcpToolCallWeight(post([1, 2, 3].map((id) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "fetch" } })))), 3, "배치는 호출 수만큼");
  assert.equal(await mcpToolCallWeight(new Request("https://owned.test/mcp", { method: "POST", body: "{not json" })), 1, "읽지 못하면 1로 센다");
  assert.equal(await mcpToolCallWeight(new Request("https://owned.test/mcp", { method: "GET" })), 0);
  const request = post({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search" } });
  assert.equal(await request.clone().text() !== "", true, "본문을 엿본 뒤에도 원래 요청 본문을 읽을 수 있다");
  let prepared = 0;
  const db = { prepare: () => { prepared++; return { bind: () => ({ first: async () => ({ request_count: 1 }) }) }; } };
  assert.equal(await enforceApiRateLimit(post({ method: "initialize" }), db, 1800000000, { weight: 0 }), null);
  assert.equal(prepared, 0, "가중치 0은 D1을 쓰지 않는다");
  const counted = new Map();
  const counting = { prepare: () => ({ bind: (key, add) => ({ first: async () => { const n = (counted.get(key) ?? 0) + add; counted.set(key, n); return { request_count: n }; } }) }) };
  const limit = apiRatePolicy("/mcp").limit;
  assert.equal(await enforceApiRateLimit(request, counting, 1800000000, { weight: limit }), null);
  assert.equal((await enforceApiRateLimit(request, counting, 1800000000, { weight: 1 })).status, 429, "배치 가중치도 같은 한도를 쓴다");
});

test("통합 검색은 느린 출처를 시간 한도에서 끊고 SOURCE_TIMEOUT으로 표시한 부분 결과를 돌려준다", { timeout: 10000 }, async () => {
  const base = database();
  let release;
  let completedReads = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const slow = { ...base, prepare(sql) { const statement = base.prepare(sql); if (!/(?:FROM|CROSS JOIN) gov24_service g\b/.test(sql)) return statement; const delayed = (inner) => ({ bind: (...values) => delayed(inner.bind(...values)), all: async () => { await pending; completedReads += 1; return inner.all(); }, first: async () => inner.first(), run: async () => inner.run() }); return delayed(statement); } };
  try {
  const response = await handleMcpRequest(new Request("https://dashboard.example/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: { query: "기초연금 신청방법" } } }),
  }), new McpData(slow, async () => new Map()), (error) => { throw error; }, { includeLaw: false, searchSourceDeadlineMs: 100 });
  const body = await response.json();
  assert.equal(body.result.isError, undefined, JSON.stringify(body.result.structuredContent ?? body.result.content));
  const result = body.result.structuredContent;
  assert.ok(result.source_errors.some((item) => item.source === "gov24" && item.code === "SOURCE_TIMEOUT"), JSON.stringify(result.source_errors));
  assert.ok(result.reason_codes.includes("UPSTREAM_ERROR"));
  assert.equal(completedReads, 0, "출처가 응답하기 전에 부분 결과가 반환되어야 한다");
  assert.ok(result.results.every((item) => item.entity_type !== "gov24_service"), "시간 초과한 출처의 결과를 확정 근거로 포함하지 않는다");
  } finally {
    release();
    await new Promise((resolve) => setImmediate(resolve));
  }
});

test("운영 Worker의 공개본 상태 캐시는 같은 D1에서 두 번째 요청의 조회 문장을 다시 쓰지 않는다", async () => {
  const base = database();
  const call = async (options) => {
    const profiled = profileDatabase(base);
    const response = await handleMcpRequest(new Request("https://dashboard.example/mcp", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_dataset_status", arguments: {} } }),
    }), new McpData(profiled.db, async () => new Map()), (error) => { throw error; }, { includeLaw: false, ...options });
    assert.equal(response.status, 200);
    // 공개본 상태 조회 문장(활성 공개본·수집 실행)만 센다. 다른 출처의 캐시와 섞이지 않게 한다.
    return profiled.report(100).top.filter((item) => /platform_active_bundle|FROM official_sync_run WHERE status = 'succeeded'/.test(item.sql)).reduce((sum, item) => sum + item.calls, 0);
  };
  const uncached = [await call({}), await call({})];
  assert.ok(uncached[0] > 0 && uncached[0] === uncached[1], "기본값은 매 요청 조회: " + uncached);
  const first = await call({ stateCacheMs: 30000 });
  const second = await call({ stateCacheMs: 30000 });
  assert.ok(first > 0 && second === 0, first + " -> " + second);
});

