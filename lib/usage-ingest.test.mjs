// 이용통계 집계기 시험: D1과 같은 SQL을 Node 내장 SQLite로 실행한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { USAGE_POLICY_VERSION, USAGE_SCHEMA_VERSION } from "./usage/codes.ts";
import { ingestUsageEvents } from "./usage/ingest.ts";
import { parseUsageEnvelope, parseUsageEvent } from "./usage/schema.ts";

const MIGRATION = readFileSync(new URL("../drizzle/0013_usage_statistics.sql", import.meta.url), "utf8");

class Statement {
  constructor(raw, sql, values = []) {
    this.raw = raw;
    this.sql = sql;
    this.values = values;
  }
  bind(...values) {
    return new Statement(this.raw, this.sql, values);
  }
  exec() {
    return this.raw.prepare(this.sql).run(...this.values);
  }
  async first() {
    return this.raw.prepare(this.sql).get(...this.values) ?? null;
  }
  async all() {
    return { results: this.raw.prepare(this.sql).all(...this.values) };
  }
  async run() {
    return this.exec();
  }
}

function createDb() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("CREATE TABLE app_setting (key text PRIMARY KEY NOT NULL, value text NOT NULL, updated_at integer NOT NULL);");
  raw.exec(MIGRATION);
  const db = {
    raw,
    prepare: (sql) => new Statement(raw, sql),
    async batch(statements) {
      raw.exec("BEGIN");
      try {
        const out = statements.map((statement) => statement.exec());
        raw.exec("COMMIT");
        return out;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return db;
}

let counter = 0;
function id() {
  counter += 1;
  return ("t" + String(counter).padStart(21, "0")).slice(0, 22);
}

const CARE_KEY = "service:0089148968911|전남광주통합특별시|화순군|보건의료|방문진료|방문의료지원사업";
const CARE_KEY_2 = "service:0089148968912|전남광주통합특별시|화순군|보건의료|방문진료|마을주치의사업";
const WELFARE_KEY = "livelihood-benefit";
const ENTITIES = new Map([
  ["care_program:" + CARE_KEY, 1],
  ["care_program:" + CARE_KEY_2, 2],
  ["welfare_policy:" + WELFARE_KEY, 3],
]);

// 2026-09-24 14:00 KST
const BASE = Date.parse("2026-09-24T05:00:00Z");

function deps(now = BASE) {
  let nonce = 0;
  return {
    now,
    nonce: () => "claim-" + now + "-" + (nonce += 1) + "-" + Math.random().toString(36).slice(2),
    resolveEntity: async (kind, key) => ENTITIES.get(kind + ":" + key) ?? null,
    isAllowedFilter: async (filter, code) => filter === "care_region" ? code === "전남광주통합특별시" || code === "전남광주통합특별시|화순군" : filter === "welfare_topic",
  };
}

const rows = (db, sql, ...values) => db.raw.prepare(sql).all(...values).map((row) => ({ ...row }));
const one = (db, sql, ...values) => ({ ...db.raw.prepare(sql).get(...values) });

test("작업지시서 12장 검산 예제: 검색·무결과·매칭·상세·전환이 기대값과 같고, 재전송해도 그대로다", async () => {
  const db = createDb();
  const s1 = id();
  const s2 = id();
  const events = [
    { type: "search", id: id(), search: s1, scope: "care_dashboard", status: "ok", results: "0", match: "unmatched" },
    { type: "search", id: id(), search: s2, scope: "care_dashboard", status: "ok", results: "1", match: "matched", key: CARE_KEY },
    // 같은 사업 상세를 닫고 두 번 연다(열람 ID가 서로 다르다).
    { type: "entity_view", id: id(), kind: "care_program", key: CARE_KEY, route: "search", search: s2 },
    { type: "entity_view", id: id(), kind: "care_program", key: CARE_KEY, route: "search", search: s2 },
    // 목록에서 복지제도 상세를 한 번 연다.
    { type: "entity_view", id: id(), kind: "welfare_policy", key: WELFARE_KEY, route: "list" },
  ];
  const first = await ingestUsageEvents(db, events, deps());
  assert.deepEqual(first, { accepted: 5, duplicate: 0, rejected: 0 });

  const check = () => {
    const search = one(db, "SELECT SUM(searches) AS searches, SUM(converted) AS converted, SUM(CASE WHEN results = '0' THEN searches END) AS zero, SUM(CASE WHEN match = 'matched' THEN searches END) AS matched FROM usage_daily_search");
    assert.deepEqual(search, { searches: 2, converted: 1, zero: 1, matched: 1 });
    assert.deepEqual(one(db, "SELECT views, search_matches, search_opens FROM usage_daily_entity WHERE entity_id = 1"), {
      views: 2,
      search_matches: 1,
      search_opens: 2,
    });
    assert.deepEqual(one(db, "SELECT views, search_matches, search_opens FROM usage_daily_entity WHERE entity_id = 3"), {
      views: 1,
      search_matches: 0,
      search_opens: 0,
    });
    assert.equal(one(db, "SELECT day FROM usage_daily_search LIMIT 1").day, "2026-09-24");
  };
  check();
  // 같은 요청을 그대로 다시 보내면(재전송) 모두 중복으로 처리되고 값이 그대로다.
  const again = await ingestUsageEvents(db, events, deps(BASE + 5000));
  assert.deepEqual(again, { accepted: 0, duplicate: 5, rejected: 0 });
  check();
});

test("검색 결과 50건이 표시되기만 해서는 사업별 검색·상세 조회가 늘지 않는다", async () => {
  const db = createDb();
  await ingestUsageEvents(db, [{ type: "search", id: id(), search: id(), scope: "care_wiki", status: "ok", results: "11-50", match: "unmatched" }], deps());
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM usage_daily_entity").n, 0);
  assert.equal(one(db, "SELECT SUM(searches) AS n FROM usage_daily_search").n, 1);
});

test("상세 열람이 검색보다 먼저 도착해도 전환은 검색 1건으로 한 번만 센다", async () => {
  const db = createDb();
  const s = id();
  await ingestUsageEvents(db, [{ type: "entity_view", id: id(), kind: "care_program", key: CARE_KEY, route: "search", search: s }], deps());
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM usage_daily_search").n, 0);
  await ingestUsageEvents(db, [{ type: "entity_view", id: id(), kind: "care_program", key: CARE_KEY_2, route: "search", search: s }], deps());
  await ingestUsageEvents(db, [{ type: "search", id: id(), search: s, scope: "care_wiki", status: "ok", results: "2-10", match: "unmatched" }], deps());
  assert.deepEqual(one(db, "SELECT searches, converted FROM usage_daily_search"), { searches: 1, converted: 1 });
  assert.equal(one(db, "SELECT SUM(search_opens) AS n FROM usage_daily_entity").n, 2);
});

test("검색 오류는 결과 0건과 따로 집계된다", async () => {
  const db = createDb();
  await ingestUsageEvents(
    db,
    [
      { type: "search", id: id(), search: id(), scope: "care_dashboard", status: "error", results: "0", match: "unmatched" },
      { type: "search", id: id(), search: id(), scope: "care_dashboard", status: "ok", results: "0", match: "unmatched" },
    ],
    deps(),
  );
  assert.deepEqual(rows(db, "SELECT status, searches FROM usage_daily_search ORDER BY status"), [
    { status: "error", searches: 1 },
    { status: "ok", searches: 1 },
  ]);
});

test("활동시간: 누적값 재전송·역순 도착은 중복 합산되지 않고, 구간 분포가 이동한다", async () => {
  const db = createDb();
  const m = id();
  const update = (ms) => ({ type: "activity", id: id(), measure: m, tab: "wiki", ms });
  const first = update(15_000);
  await ingestUsageEvents(db, [first], deps(BASE));
  await ingestUsageEvents(db, [first], deps(BASE + 1000));
  const second = update(40_000);
  await ingestUsageEvents(db, [second], deps(BASE + 26_000));
  // 늦게 도착한 옛 누적값(20초)은 반영하지 않는다.
  await ingestUsageEvents(db, [update(20_000)], deps(BASE + 27_000));
  assert.deepEqual(one(db, "SELECT active_ms, measures FROM usage_daily_tab WHERE tab = 'wiki'"), { active_ms: 40_000, measures: 1 });
  assert.deepEqual(rows(db, "SELECT bucket, measures FROM usage_daily_duration WHERE scope = 'tab:wiki' ORDER BY bucket"), [
    { bucket: 0, measures: 0 },
    { bucket: 1, measures: 1 },
  ]);
});

test("활동시간: 서버 경과시간보다 크게 부풀린 누적값과 너무 큰 첫 보고는 반영하지 않는다", async () => {
  const db = createDb();
  const m = id();
  await ingestUsageEvents(db, [{ type: "activity", id: id(), measure: m, tab: "sources", ms: 10_000 }], deps(BASE));
  await ingestUsageEvents(db, [{ type: "activity", id: id(), measure: m, tab: "sources", ms: 3_600_000 }], deps(BASE + 60_000));
  assert.equal(one(db, "SELECT active_ms FROM usage_daily_tab").active_ms, 10_000);
  const tooBig = await ingestUsageEvents(db, [{ type: "activity", id: id(), measure: id(), tab: "sources", ms: 900_000 }], deps(BASE));
  assert.deepEqual(tooBig, { accepted: 0, duplicate: 0, rejected: 1 });
  const negative = await ingestUsageEvents(db, [{ type: "activity", id: id(), measure: id(), tab: "sources", ms: -5 }], deps(BASE));
  assert.equal(negative.rejected, 1);
});

test("활동시간: 한국시간 자정을 넘는 증가분은 어제와 오늘로 나눈다", async () => {
  const db = createDb();
  const m = id();
  const beforeMidnight = Date.parse("2026-09-24T14:59:55Z"); // 23:59:55 KST
  const afterMidnight = Date.parse("2026-09-24T15:00:10Z"); // 다음날 00:00:10 KST
  await ingestUsageEvents(db, [{ type: "activity", id: id(), measure: m, kind: "care_program", key: CARE_KEY, ms: 5_000 }], deps(beforeMidnight));
  await ingestUsageEvents(db, [{ type: "activity", id: id(), measure: m, kind: "care_program", key: CARE_KEY, ms: 20_000 }], deps(afterMidnight));
  assert.deepEqual(rows(db, "SELECT day, active_ms, active_views FROM usage_daily_entity ORDER BY day"), [
    { day: "2026-09-24", active_ms: 10_000, active_views: 1 },
    { day: "2026-09-25", active_ms: 10_000, active_views: 0 },
  ]);
});

test("만료된 측정은 이어 받지 않는다", async () => {
  const db = createDb();
  const m = id();
  await ingestUsageEvents(db, [{ type: "activity", id: id(), measure: m, tab: "wiki", ms: 5_000 }], deps(BASE));
  const late = await ingestUsageEvents(db, [{ type: "activity", id: id(), measure: m, tab: "wiki", ms: 6_000 }], deps(BASE + 24 * 3600_000));
  assert.equal(late.rejected, 1);
});

test("허용값 검증: 미등록 사업, 모르는 필드, 목록에 없는 지역, 같은 ID의 다른 내용은 거절한다", async () => {
  const db = createDb();
  const shared = id();
  const result = await ingestUsageEvents(
    db,
    [
      { type: "entity_view", id: id(), kind: "care_program", key: "service:x|y|z|a|b|c", route: "list" },
      { type: "page_view", id: id(), page: "wiki", screen: "desktop", url: "https://example.com/?q=홍길동" },
      { type: "filter", id: id(), filter: "care_region", code: "서울 강남구 역삼동 123" },
      { type: "filter", id: shared, filter: "care_region", code: "전남광주통합특별시" },
      { type: "filter", id: shared, filter: "care_region", code: "전남광주통합특별시|화순군" },
      { type: "search", id: id(), search: id(), scope: "care_wiki", status: "ok", results: "1", match: "unmatched", query: "010-1234-5678" },
    ],
    deps(),
  );
  assert.deepEqual(result, { accepted: 1, duplicate: 0, rejected: 5 });
  assert.deepEqual(rows(db, "SELECT code, uses FROM usage_daily_filter"), [{ code: "전남광주통합특별시", uses: 1 }]);
  const stored = JSON.stringify(rows(db, "SELECT * FROM usage_seen_event")) + JSON.stringify(rows(db, "SELECT * FROM usage_daily_filter"));
  assert.ok(!stored.includes("010-1234-5678") && !stored.includes("홍길동"));
});

test("요청 본문: 판이 다르거나 이벤트가 20건을 넘으면 거절한다", () => {
  const event = { type: "page_view", id: id(), page: "wiki", screen: "mobile" };
  assert.ok(parseUsageEnvelope(JSON.stringify({ v: USAGE_SCHEMA_VERSION, p: USAGE_POLICY_VERSION, events: [event] })));
  assert.equal(parseUsageEnvelope(JSON.stringify({ v: 99, p: USAGE_POLICY_VERSION, events: [event] })), null);
  assert.equal(parseUsageEnvelope(JSON.stringify({ v: USAGE_SCHEMA_VERSION, p: USAGE_POLICY_VERSION, events: Array(21).fill(event) })), null);
  assert.equal(parseUsageEnvelope(JSON.stringify({ v: USAGE_SCHEMA_VERSION, p: USAGE_POLICY_VERSION, events: [event], extra: 1 })), null);
  assert.equal(parseUsageEnvelope("not json"), null);
});

test("기능 실행: 시작·성공·실패·취소를 따로 세고, 끝 소식이 먼저 와도 시작을 한 번만 센다", async () => {
  const db = createDb();
  const a = id();
  const b = id();
  const c = id();
  await ingestUsageEvents(
    db,
    [
      { type: "action", id: id(), action: "care_csv", outcome: "start", op: a },
      { type: "action", id: id(), action: "care_csv", outcome: "success", op: a, ms: 1200 },
      { type: "action", id: id(), action: "care_csv", outcome: "failure", op: b, error: "http_5xx", ms: 300 },
      { type: "action", id: id(), action: "care_compare", outcome: "start", op: c },
      { type: "action", id: id(), action: "care_compare", outcome: "cancel", op: c },
      { type: "action", id: id(), action: "source_link", outcome: "click", dest: "bokjiro" },
    ],
    deps(),
  );
  // b의 시작 소식이 늦게 도착한다.
  await ingestUsageEvents(db, [{ type: "action", id: id(), action: "care_csv", outcome: "start", op: b }], deps(BASE + 1000));
  // a의 두 번째 성공 소식(다른 이벤트 ID)은 무시한다.
  await ingestUsageEvents(db, [{ type: "action", id: id(), action: "care_csv", outcome: "success", op: a, ms: 50 }], deps(BASE + 2000));
  assert.deepEqual(rows(db, "SELECT action, outcome, dest, count, ms_sum, ms_count FROM usage_daily_action ORDER BY action, outcome"), [
    { action: "care_compare", outcome: "cancel", dest: "", count: 1, ms_sum: 0, ms_count: 0 },
    { action: "care_compare", outcome: "start", dest: "", count: 1, ms_sum: 0, ms_count: 0 },
    { action: "care_csv", outcome: "failure", dest: "", count: 1, ms_sum: 300, ms_count: 1 },
    { action: "care_csv", outcome: "start", dest: "", count: 2, ms_sum: 0, ms_count: 0 },
    { action: "care_csv", outcome: "success", dest: "", count: 1, ms_sum: 1200, ms_count: 1 },
    { action: "source_link", outcome: "click", dest: "bokjiro", count: 1, ms_sum: 0, ms_count: 0 },
  ]);
  assert.deepEqual(rows(db, "SELECT op, code, count FROM usage_daily_error"), [{ op: "care_csv", code: "http_5xx", count: 1 }]);
});

test("페이지·탭·성능 이벤트와 마지막 반영 시각", async () => {
  const db = createDb();
  await ingestUsageEvents(
    db,
    [
      { type: "page_view", id: id(), page: "dashboard", screen: "mobile" },
      { type: "tab_view", id: id(), tab: "dashboard_search", entry: "initial" },
      { type: "tab_view", id: id(), tab: "dashboard_compare", entry: "selected" },
      { type: "perf", id: id(), metric: "lcp", value: 1800, page: "dashboard" },
      { type: "perf", id: id(), metric: "cls", value: 0.12, page: "dashboard" },
      { type: "perf", id: id(), metric: "search_care", value: 340 },
      { type: "error", id: id(), op: "welfare_detail", code: "network" },
    ],
    deps(),
  );
  assert.deepEqual(rows(db, "SELECT tab, initial_views, selected_views FROM usage_daily_tab ORDER BY tab"), [
    { tab: "dashboard_compare", initial_views: 0, selected_views: 1 },
    { tab: "dashboard_search", initial_views: 1, selected_views: 0 },
  ]);
  assert.deepEqual(rows(db, "SELECT metric, bucket, value_sum FROM usage_daily_perf ORDER BY metric"), [
    { metric: "cls", bucket: 1, value_sum: 120 },
    { metric: "lcp", bucket: 3, value_sum: 1800 },
    { metric: "search_care", bucket: 1, value_sum: 340 },
  ]);
  assert.equal(one(db, "SELECT value FROM app_setting WHERE key = 'usage_last_ingest_at'").value, String(BASE));
});

test("새 기능: 이름 대조가 없는 검색은 unmatched만, 클릭 기능은 연결 기관·작업 ID 없이 클릭만 받는다", () => {
  const id = "A".repeat(22);
  const search = "B".repeat(22);
  const news = { type: "search", id, search, scope: "press_news", status: "ok", results: "2-10", match: "unmatched" };
  assert.deepEqual(parseUsageEvent(news), news);
  assert.equal(parseUsageEvent({ ...news, match: "matched", key: "livelihood-benefit" }), null);
  assert.equal(parseUsageEvent({ ...news, scope: "budget_project", match: "ambiguous" }), null);
  const click = { type: "action", id, action: "news_original", outcome: "click" };
  assert.deepEqual(parseUsageEvent(click), click);
  assert.equal(parseUsageEvent({ ...click, dest: "gov" }), null);
  assert.equal(parseUsageEvent({ ...click, outcome: "start", op: search }), null);
  assert.deepEqual(parseUsageEvent({ type: "tab_view", id, tab: "budget", entry: "selected" }), { type: "tab_view", id, tab: "budget", entry: "selected" });
  assert.deepEqual(parseUsageEvent({ type: "filter", id, filter: "news_category", code: "senior" }), { type: "filter", id, filter: "news_category", code: "senior" });
});

