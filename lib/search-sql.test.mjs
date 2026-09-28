// 서버 검색 SQL(D1과 같은 SQLite)이 lib/search-terms.ts의 브라우저 판정과 같은 결과를 내는지.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
  CATEGORY_TEXT_SQL,
  NAME_TEXT_SQL,
  SEARCH_TEXT_FROM_COLUMNS,
  SEARCH_TEXT_LOOKUP,
  searchTermSql,
} from "./official-search-text.ts";
import { parseSearch, searchableText, termMatches } from "./search-terms.ts";

const COLUMNS = ["sido", "sigungu", "category", "subcategory", "name", "description", "target", "detail_target", "application_method", "provider", "type"];
const MIGRATION = readFileSync(new URL("../drizzle/0015_search_text_word_boundaries.sql", import.meta.url), "utf8");

const ROWS = [
  ["서울특별시", "강동구", "주거복지", "주택지원", "1인가구 전월세 안심 계약 도움 서비스", "1인가구의 전월세 계약 상담, 집보기 동행 등 지원", "1인가구", "", "전화 신청", "강동구청", "자체"],
  ["서울특별시", "관악구", "주거복지", "주거지지원", "관악형 케어안심주택(단기 회복형) 운영", "퇴원 후 회복기 동안 1개월 이내 요양원\n입소  지원", "퇴원 환자", "", "", "", "자체"],
  ["전남광주통합특별시", "강진군", "일상생활돌봄", "생활지원", "우리동네 복지기동대", "집수리 기동 지원", "", "", "", "우리동네 복지기동대", "자체"],
  ["부산광역시", "해운대구", "보건의료", "방문의료", "보건의료 방문 진료", "퇴원 후 돌봄\t및 사회 활동", "", "", "", "", "국비"],
];

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE official_service_snapshot (id INTEGER PRIMARY KEY, ${COLUMNS.map((column) => column + " TEXT").join(", ")}, search_text TEXT NOT NULL DEFAULT '')`);
  const insert = db.prepare(`INSERT INTO official_service_snapshot (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`);
  for (const row of ROWS) insert.run(...row);
  db.exec(MIGRATION);
  return db;
}

test("마이그레이션은 서버 코드와 같은 검색용 본문 식으로 기존 행을 다시 계산한다", () => {
  assert.equal(MIGRATION.trim(), "UPDATE `official_service_snapshot` SET `search_text` = " + SEARCH_TEXT_FROM_COLUMNS + ";");
});

test("SQL로 만든 검색용 본문은 브라우저의 searchableText와 같다", () => {
  const db = database();
  const stored = db.prepare("SELECT search_text AS text FROM official_service_snapshot ORDER BY id").all().map((row) => row.text);
  assert.deepEqual(stored, ROWS.map((row) => searchableText(row) + "\u001e" + searchableText(row).replaceAll(" ", "")));
});

test("마이그레이션 전 예전 형식(띄어쓰기 없는 본문)에서도 검색이 끊기지 않는다", () => {
  const db = database();
  db.exec("UPDATE official_service_snapshot SET search_text = REPLACE(SUBSTR(search_text, 1, INSTR(search_text, char(30)) - 1), ' ', '')");
  const [term] = parseSearch("방문진료").terms;
  const condition = searchTermSql(term, SEARCH_TEXT_LOOKUP);
  const ids = db.prepare(`SELECT id FROM official_service_snapshot WHERE ${condition.sql}`).all(...condition.values).map((row) => row.id);
  assert.deepEqual(ids, [4]);
});

test("SQL 검색 조건은 브라우저 판정과 같은 사업을 찾는다", () => {
  const db = database();
  const queries = ["기동", "집보기동행", "보기동행", "회복기동안", "방문진료", "퇴원후돌봄", "후돌봄", "해운대 방문진료", "주택지원1인가구", "주거복지주택지원", "지원", "부산 퇴원후돌봄"];
  for (const query of queries) {
    const parsed = parseSearch(query);
    const conditions = parsed.terms.map((term) => searchTermSql(term, SEARCH_TEXT_LOOKUP));
    const found = db
      .prepare(`SELECT id FROM official_service_snapshot WHERE ${conditions.map((condition) => condition.sql).join(" AND ")} ORDER BY id`)
      .all(...conditions.flatMap((condition) => condition.values))
      .map((row) => row.id);
    const expected = ROWS.flatMap((row, index) => (parsed.terms.every((term) => termMatches(searchableText(row), term)) ? [index + 1] : []));
    assert.deepEqual(found, expected, query);
  }
});

test("기동으로 찾으면 띄어쓰기로 갈린 「기 동」만 있는 사업은 빠진다", () => {
  const db = database();
  const [term] = parseSearch("기동").terms;
  const condition = searchTermSql(term, SEARCH_TEXT_LOOKUP);
  const names = db.prepare(`SELECT name FROM official_service_snapshot WHERE ${condition.sql} ORDER BY id`).all(...condition.values).map((row) => row.name);
  assert.deepEqual(names, ["우리동네 복지기동대"]);
});

test("관련도용 사업명·분류 SQL 본문도 같은 규칙을 쓴다", () => {
  const db = database();
  const [term] = parseSearch("방문진료").terms;
  const inName = searchTermSql(term, NAME_TEXT_SQL);
  const inCategory = searchTermSql(term, CATEGORY_TEXT_SQL);
  const row = db
    .prepare(`SELECT (${inName.sql}) AS name, (${inCategory.sql}) AS category FROM official_service_snapshot WHERE id = 4`)
    .get(...inName.values, ...inCategory.values);
  assert.deepEqual({ ...row }, { name: 1, category: 0 });
});
