import assert from "node:assert/strict";
import test from "node:test";
import { database, NOW } from "./press-test-support.mjs";
import { McpData } from "./mcp/data.ts";
import { handleMcpRequest } from "./mcp/server.ts";
import { createSearchCacheInstance, createSearchResultCache, normalizeSearchCacheQuery, searchCacheKey, SEARCH_CACHE_TTL_SECONDS } from "./mcp/search-cache.ts";
import { flushMcpUsage, readMcpUsage, recordMcpCacheWrite, recordMcpUsage, summarizeMcpUsage } from "./mcp/usage.ts";
import { createMcpTrace, readMcpTraces, recordMcpTrace } from "./mcp/trace.ts";

const QUERY = "기초연금  신청 방법";

function seed(db) {
  db.sqlite.prepare("INSERT INTO official_sync_run (id, trigger, status, started_at, completed_at) VALUES ('cache-run','manual','succeeded',?,?)").run(NOW - 5, NOW);
  const program = db.sqlite.prepare("INSERT INTO official_service_snapshot (id, service_id, sync_run_id, sido, sigungu, category, subcategory, name, description, target, detail_target, provider, type, serial, detail_url, updated_date, collected_at, application_method) VALUES (?,?,'cache-run','서울특별시',?,'돌봄','방문',?,?,?,'','구청','지자체','1','','2026-01-01',?,'방문')");
  program.run("p1", "A1", "강남구", "노인 맞춤 돌봄 서비스", "65세 이상 어르신 안부 확인", "노인", NOW);
  program.run("p2", "A2", "강남구", "기초연금 신청 안내", "기초연금 신청 방법 안내", "노인", NOW);
  const gov = db.sqlite.prepare("INSERT INTO gov24_service (service_id, name, org_name, org_type, purpose, target, criteria, benefit, apply_method, detail_url, modified_at, detail_modified_at, detail_status, detail_fetched_at, first_seen_at, last_seen_at, presence, list_run_id) VALUES (?,?,'보건복지부','중앙행정기관',?,?,'선정기준','지원내용','방문',?, '1','1','COLLECTED',?,?,?,'PRESENT','l1')");
  gov.run("G1", "기초연금", "노후 소득 보장", "만 65세 이상", "https://www.gov.kr/G1", NOW, NOW, NOW);
  return db;
}

function harness({ dataDb, cacheDb = dataDb, instance = createSearchCacheInstance(), now } = {}) {
  const writes = [];
  const observations = [];
  const call = async (query = QUERY, extra = {}) => {
    const response = await handleMcpRequest(new Request("https://dashboard.example/claude/mcp", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search", arguments: { query } } }),
    }), new McpData(dataDb, async () => new Map()), () => {}, { includeLaw: false, observeTool: (value) => observations.push(value), searchCache: createSearchResultCache({ db: cacheDb, defer: (task) => writes.push(task), instance, now }), ...extra });
    return (await response.json()).result.structuredContent;
  };
  return { call, writes, observations, settle: () => Promise.all(writes.splice(0)) };
}

const CACHE_FIELDS = new Set(["cache", "cache_detail", "timings_ms"]);
const withoutCacheFields = (payload) => Object.fromEntries(Object.entries(payload).filter(([key]) => !CACHE_FIELDS.has(key)));

test("같은 검색 5회는 첫 요청만 원본을 조회하고 나머지 4회는 같은 결과를 캐시에서 돌려준다", async () => {
  const db = seed(database());
  const run = harness({ dataDb: db });
  const responses = [];
  for (let index = 0; index < 5; index += 1) {
    responses.push(await run.call());
    await run.settle();
  }
  assert.deepEqual(responses.map((item) => item.cache), ["MISS", "HIT", "HIT", "HIT", "HIT"]);
  assert.deepEqual(responses.map((item) => item.cache_detail.status), ["MISS", "HIT", "HIT", "HIT", "HIT"]);
  assert.equal(responses[0].cache_detail.lookup, "cold");
  for (const hit of responses.slice(1)) assert.deepEqual(withoutCacheFields(hit), withoutCacheFields(responses[0]));
  assert.ok(responses[0].results.length > 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM mcp_search_cache").get().n, 1);
});

test("한 인스턴스가 저장한 결과를 메모리를 공유하지 않는 다른 인스턴스가 D1에서 재사용한다", async () => {
  const db = seed(database());
  const first = harness({ dataDb: db });
  const other = harness({ dataDb: db });
  const miss = await first.call();
  assert.equal(miss.cache_detail.status, "MISS");
  assert.deepEqual(await first.settle(), ["stored"]);
  const fromD1 = await other.call();
  assert.equal(fromD1.cache, "HIT");
  assert.deepEqual(fromD1.cache_detail, { status: "HIT", layer: "d1" });
  assert.deepEqual(withoutCacheFields(fromD1), withoutCacheFields(miss));
  assert.deepEqual((await other.call()).cache_detail, { status: "HIT", layer: "memory" });
});

test("600초가 지나면 메모리·D1 어느 쪽도 이전 결과를 쓰지 않고, 만료 행은 다음 저장 때 지운다", async () => {
  const db = seed(database());
  let clock = Date.parse("2026-10-15T01:00:00Z");
  const now = () => clock;
  const instance = createSearchCacheInstance();
  const cache = createSearchResultCache({ db, instance, now });
  const key = await searchCacheKey(["ttl", 1]);
  await cache.put(key, { value: 1 }).write;
  clock += (SEARCH_CACHE_TTL_SECONDS - 1) * 1000;
  assert.equal((await createSearchResultCache({ db, now, instance: createSearchCacheInstance() }).get(key)).layer, "d1");
  clock += 2000;
  assert.deepEqual(await cache.get(key), { value: null, layer: null, miss: "expired" });
  assert.deepEqual(await createSearchResultCache({ db, now, instance: createSearchCacheInstance() }).get(key), { value: null, layer: null, miss: "expired" });
  clock += 300_000;
  await cache.put(await searchCacheKey(["ttl", 2]), { value: 2 }).write;
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM mcp_search_cache").get().n, 1);
});

test("공개본·정부24·서버·배포·날짜·질문이 다르면 다른 키가 되어 이전 결과를 쓰지 않는다", async () => {
  const db = database();
  const cache = createSearchResultCache({ db, instance: createSearchCacheInstance() });
  const base = ["search-v2", "1.13.2", "build-a", "rb_1", "manual-1", true, false, "2026-10-15", "gov24:1", "기초연금"];
  const original = await searchCacheKey(base);
  await cache.put(original, { results: ["old"] }).write;
  for (const index of [1, 2, 3, 4, 7, 8, 9]) {
    const changed = [...base];
    changed[index] = String(changed[index]) + "-changed";
    const key = await searchCacheKey(changed);
    assert.notEqual(key.id, original.id);
    assert.deepEqual(await createSearchResultCache({ db, instance: createSearchCacheInstance() }).get(key), { value: null, layer: null, miss: "cold" });
  }
});

test("D1에는 질문 원문·응답 평문이 남지 않고 같은 질문으로만 복호화된다", async () => {
  const db = seed(database());
  const run = harness({ dataDb: db });
  await run.call();
  await run.settle();
  const row = db.sqlite.prepare("SELECT cache_key, body FROM mcp_search_cache").get();
  assert.match(row.cache_key, /^[a-f0-9]{64}$/);
  for (const marker of ["기초연금", "query_plan", "raw_query", "results"]) assert.equal(row.body.includes(marker), false, marker);
  db.sqlite.prepare("UPDATE mcp_search_cache SET body = ?").run(Buffer.from(row.body, "base64").reverse().toString("base64"));
  const other = harness({ dataDb: db });
  const tampered = await other.call();
  assert.equal(tampered.cache_detail.status, "ERROR");
  assert.ok(tampered.results.length > 0, "캐시가 깨져도 원본 검색 결과를 돌려준다");
  assert.deepEqual(await other.settle(), ["stored"], "깨진 행은 새 결과로 덮어쓴다");
  assert.deepEqual((await harness({ dataDb: db }).call()).cache_detail, { status: "HIT", layer: "d1" });
});

test("개인정보가 보이는 질문은 메모리·D1 어디에도 저장하지 않는다", async () => {
  const db = seed(database());
  const run = harness({ dataDb: db });
  const first = await run.call("기초연금 신청 900101-1234567");
  const second = await run.call("기초연금 신청 900101-1234567");
  await run.settle();
  assert.deepEqual([first.cache_detail, second.cache_detail], [{ status: "BYPASS", reason: "sensitive_query" }, { status: "BYPASS", reason: "sensitive_query" }]);
  assert.equal(first.cache, undefined);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM mcp_search_cache").get().n, 0);
});

test("출처 하나가 실패한 결과는 저장하지 않고 NOT_STORED로 구분한다", async () => {
  const db = seed(database());
  const failing = { ...db, prepare: (sql) => (sql.includes("faq_129") ? { bind: () => { throw new Error("D1_ERROR: Network connection lost."); } } : db.prepare(sql)) };
  const run = harness({ dataDb: failing, cacheDb: db });
  const result = await run.call();
  await run.settle();
  assert.ok(result.source_errors?.length);
  assert.equal(result.cache, "MISS");
  assert.deepEqual(result.cache_detail, { status: "NOT_STORED", lookup: "cold", reason: "source_error" });
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM mcp_search_cache").get().n, 0);
});

test("1MB를 넘는 결과는 저장하지 않는다", async () => {
  const cache = createSearchResultCache({ db: database(), instance: createSearchCacheInstance() });
  const put = cache.put(await searchCacheKey(["large"]), { text: "가".repeat(400_000) });
  assert.deepEqual(put, { reason: "too_large", write: null });
});

test("D1 캐시 장애에도 검색은 원본으로 응답하고, 60초 뒤 다시 D1을 시도한다", async () => {
  const db = seed(database());
  let clock = Date.parse("2026-10-15T01:00:00Z");
  let broken = true;
  let attempts = 0;
  const cacheDb = { ...db, prepare: (sql) => { attempts += 1; if (broken) throw new Error("D1_ERROR: Database is overloaded. Requests queued for too long."); return db.prepare(sql); }, batch: (statements) => db.batch(statements) };
  const instance = createSearchCacheInstance();
  const run = harness({ dataDb: db, cacheDb, instance, now: () => clock });
  const failed = await run.call();
  assert.deepEqual(failed.cache_detail, { status: "ERROR", lookup: "lookup_error" });
  assert.ok(failed.results.length > 0);
  assert.equal(await run.observations.at(-1).cacheWrite, "memory_only");
  const cooling = await run.call("노인 맞춤 돌봄 대상");
  assert.deepEqual(cooling.cache_detail, { status: "ERROR", lookup: "backend_cooldown" });
  assert.equal(attempts, 1, "쉬는 동안에는 D1을 다시 부르지 않는다");
  broken = false;
  clock += 61_000;
  const recovered = await run.call("장애인 활동지원 신청");
  assert.equal(recovered.cache_detail.status, "MISS");
  assert.deepEqual(await run.settle(), ["stored"]);
});

test("D1 저장 실패는 결과에 영향 없이 실패 사유로 남고 저장 성공·실패를 따로 센다", async () => {
  const db = seed(database());
  const cacheDb = { ...db, batch: async () => { throw new Error("D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset."); } };
  const run = harness({ dataDb: db, cacheDb });
  const result = await run.call();
  assert.equal(result.cache_detail.status, "MISS");
  assert.deepEqual(await run.settle(), ["failed:D1_TIMEOUT"]);
  const usage = database();
  recordMcpCacheWrite(usage, { route: "/mcp", tool: "search", outcome: "failed:D1_TIMEOUT" });
  recordMcpCacheWrite(usage, { route: "/mcp", tool: "search", outcome: "stored" });
  recordMcpCacheWrite(usage, { route: "/mcp", tool: "search", outcome: "memory_only" });
  await flushMcpUsage(usage, 0);
  const [row] = (await readMcpUsage(usage, 1)).rows;
  assert.deepEqual([row.calls, row.cache_write_ok, row.cache_write_errors], [0, 1, 1]);
});

test("사용통계는 HIT 계층·MISS·만료·저장 생략·오류·우회를 서로 겹치지 않게 센다", async () => {
  const db = database();
  const detail = (cacheDetail) => recordMcpUsage(db, { route: "/claude/mcp", tool: "search", durationMs: 10, failed: false, cache: cacheDetail.status === "HIT" ? "HIT" : cacheDetail.status === "BYPASS" ? undefined : "MISS", cacheDetail });
  detail({ status: "HIT", layer: "memory" });
  detail({ status: "HIT", layer: "d1" });
  detail({ status: "MISS", lookup: "cold" });
  detail({ status: "MISS", lookup: "expired" });
  detail({ status: "NOT_STORED", lookup: "cold", reason: "source_error" });
  detail({ status: "ERROR", lookup: "lookup_error" });
  detail({ status: "BYPASS", reason: "sensitive_query" });
  recordMcpUsage(db, { route: "/claude/mcp", tool: "search", durationMs: 10, failed: false, cache: "MISS" });
  await flushMcpUsage(db, 0);
  const summary = summarizeMcpUsage((await readMcpUsage(db, 1)).rows);
  assert.deepEqual(
    [summary.calls, summary.hits, summary.misses, summary.memoryHits, summary.d1Hits, summary.expired, summary.notStored, summary.cacheErrors, summary.bypass],
    [8, 2, 5, 1, 1, 1, 1, 1, 1],
  );
  assert.equal(summary.hits + summary.misses + summary.bypass, summary.calls, "모든 검색 호출이 한 가지 상태로만 집계된다");
});

test("사용통계 D1 기록이 실패하면 집계 행을 지우지 않고 다음 기록 때 보낸다", async () => {
  const db = database();
  const realBatch = db.batch.bind(db);
  let fail = true;
  db.batch = async (statements) => { if (fail) throw new Error("D1_ERROR: Network connection lost."); return realBatch(statements); };
  recordMcpUsage(db, { route: "/mcp", tool: "search", durationMs: 40, failed: false, cacheDetail: { status: "HIT", layer: "d1" }, cache: "HIT" });
  await flushMcpUsage(db, 0);
  assert.equal((await readMcpUsage(db, 1)).rows.length, 0);
  fail = false;
  recordMcpUsage(db, { route: "/mcp", tool: "search", durationMs: 60, failed: false, cacheDetail: { status: "MISS", lookup: "cold" }, cache: "MISS" });
  await flushMcpUsage(db, 0);
  const [row] = (await readMcpUsage(db, 1)).rows;
  assert.deepEqual([row.calls, row.cache_hits, row.cache_hit_d1, row.cache_misses, row.max_ms], [2, 1, 1, 1, 60]);
});

test("호출 추적은 캐시 상태·저장 결과·진단값을 질문 없이 남긴다", async () => {
  const db = database();
  const context = { requestId: crypto.randomUUID(), callId: crypto.randomUUID(), route: "/mcp", startedAt: Date.now() };
  const trace = await createMcpTrace({ tool: "search", arguments: { query: "기초연금 신청 방법" }, failed: false, durationMs: 30, cache: "MISS", cacheDetail: { status: "MISS", lookup: "expired" }, cacheWrite: Promise.resolve("stored") }, context);
  await recordMcpTrace(db, { ...trace, instance_id: "a1b2c3d4", colo: "ICN", edge_probe: "match_error:Error", d1_statements: 12, d1_rows_read: 340, d1_ms: 25 });
  const [row] = (await readMcpTraces(db, { limit: 1, requestId: context.requestId })).rows;
  assert.deepEqual([row.cache_status, row.cache_reason, row.cache_write, row.instance_id, row.colo, row.edge_probe, row.d1_statements], ["MISS", "expired", "stored", "a1b2c3d4", "ICN", "match_error:Error", 12]);
  assert.equal(JSON.stringify(row).includes("기초연금"), false);
});

test("어미·문장부호·복합어 띄어쓰기가 다른 같은 의미의 질문은 캐시를 함께 쓰고 질문 계획은 호출자 원문으로 돌려준다", async () => {
  const db = seed(database());
  const first = harness({ dataDb: db });
  const other = harness({ dataDb: db });
  const variants = [
    "기초연금  신청 방법",
    "기초연금 신청 방법?",
    "기초연금 신청 방법 알려줘",
    "기초연금 신청 방법은 어떻게 되나요?",
    "기초연금 신청방법 알려주세요",
  ];
  for (const variant of variants) {
    assert.equal(normalizeSearchCacheQuery(variant), "기초연금 신청방법", variant);
  }
  const miss = await first.call(variants[0]);
  assert.equal(miss.cache, "MISS");
  await first.settle();
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM mcp_search_cache").get().n, 1);
  assert.equal(miss.results.find((item) => item.id === "gov24_service:G1")?.target_preview, "만 65세 이상");
  for (const [index, variant] of variants.slice(1).entries()) {
    const runner = index === 0 ? other : first;
    const hit = await runner.call(variant);
    assert.equal(hit.cache, "HIT", variant);
    assert.equal(hit.cache_detail.layer, index === 0 ? "d1" : "memory", variant);
    assert.equal(hit.query_plan.raw_query, variant);
    assert.deepEqual(hit.results, miss.results);
  }
});

