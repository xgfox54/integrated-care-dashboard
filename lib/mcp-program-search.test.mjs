import assert from "node:assert/strict";
import test from "node:test";
import { serviceWikiKey } from "./dataset.ts";
import { McpData } from "./mcp/data.ts";
import { database, NOW } from "./press-test-support.mjs";

function fixture(rows) {
  const db = database();
  db.sqlite.prepare("INSERT INTO official_sync_run (id, trigger, status, started_at, completed_at) VALUES ('search-fixture', 'manual', 'succeeded', ?, ?)").run(NOW, NOW);
  const insert = db.sqlite.prepare(
    "INSERT INTO official_service_snapshot (id, service_id, sync_run_id, sido, sigungu, category, subcategory, name, description, target, detail_target, provider, type, serial, detail_url, updated_date, collected_at, application_method) " +
    "VALUES (?, ?, 'search-fixture', '제주특별자치도', '서귀포시', ?, ?, ?, ?, ?, '', ?, '지자체', '1', '', '2026-07', ?, '')",
  );
  rows.forEach((row, index) => insert.run("row" + index, "search:" + index, row.category ?? "일상생활돌봄", row.subcategory ?? "", row.name, row.description ?? "", row.target ?? "", row.provider ?? "", NOW));
  return new McpData(db, async () => new Map());
}
const filter = (queryTokens, extra = {}) => ({ sido: "", sigungu: "", includeAncestorScope: false, categories: [], targetKeywords: [], queryTokens, ...extra });

test("MCP 사업 검색은 띄어쓰기·가운뎃점 차이를 허용하고 원본 이름과 ID를 보존한다", async () => {
  const data = fixture([
    { name: "장애인 활동지원" },
    { name: "장애인활동지원" },
    { name: "의료·요양 통합돌봄" },
  ]);
  const compact = await data.programs("search-fixture", filter(["장애인활동지원"]), 0, 20);
  const spaced = await data.programs("search-fixture", filter(["장애인 활동지원"]), 0, 20);
  const split = await data.programs("search-fixture", filter(["장애인", "활동지원"]), 0, 20);
  assert.equal(compact.total, 2);
  assert.deepEqual(compact.rows.map(serviceWikiKey), spaced.rows.map(serviceWikiKey));
  assert.deepEqual(compact.rows.map(serviceWikiKey), split.rows.map(serviceWikiKey));
  assert.deepEqual(compact.rows.map((row) => row.name).sort(), ["장애인 활동지원", "장애인활동지원"].sort());
  const dotted = await data.programs("search-fixture", filter(["의료요양통합돌봄"]), 0, 20);
  assert.equal(dotted.rows[0].name, "의료·요양 통합돌봄");
});

test("MCP 사업명 완전일치가 수많은 주변 사업보다 LIMIT 이전에 우선하고 다음 페이지도 안정적이다", async () => {
  const data = fixture([
    ...Array.from({ length: 90 }, (_, index) => ({ name: "가나다 안전하우징 " + index, target: "기초연금 수급자" })),
    { name: "기초연금 추가 안내" },
    { name: "기초연금" },
  ]);
  const first = await data.programs("search-fixture", filter(["기초연금"]), 0, 1);
  const second = await data.programs("search-fixture", filter(["기초연금"]), 1, 1);
  const third = await data.programs("search-fixture", filter(["기초연금"]), 2, 1);
  assert.equal(first.total, 92);
  assert.equal(first.rows[0].name, "기초연금");
  assert.equal(second.rows[0].name, "기초연금 추가 안내");
  assert.match(third.rows[0].name, /^가나다 안전하우징/);
  assert.notEqual(serviceWikiKey(first.rows[0]), serviceWikiKey(second.rows[0]));
});

test("띄어쓰기 보완 검색은 기존 낱말 AND와 분류·대상·지역 조건을 유지한다", async () => {
  const data = fixture([
    { name: "장애인 활동지원", description: "방문 상담", target: "등록 장애인", category: "장애지원" },
    { name: "장애인활동지원", description: "전화 상담", target: "등록 장애인", category: "장애지원" },
    { name: "장애인활동지원", description: "방문 상담", target: "성인", category: "기타" },
  ]);
  const selected = await data.programs("search-fixture", filter(["장애인활동지원", "방문상담"], {
    sido: "제주특별자치도", sigungu: "서귀포시", categories: [{ category: "장애지원", subcategory: "" }], targetKeywords: ["등록 장애인"],
  }), 0, 10);
  assert.equal(selected.total, 1);
  assert.equal(selected.rows[0].description, "방문 상담");
  assert.equal(selected.rows[0].category, "장애지원");
  const sibling = await data.programs("search-fixture", filter(["장애인활동지원"], { sido: "제주특별자치도", sigungu: "제주시" }), 0, 10);
  assert.equal(sibling.total, 0);
});

test("보완 검색의 %와 밑줄은 와일드카드가 아닌 문자이며 검색어 없는 정렬은 유지한다", async () => {
  const data = fixture([{ name: "100% 지원" }, { name: "1000 지원" }, { name: "코드_1" }, { name: "코드01" }]);
  const percent = await data.programs("search-fixture", filter(["100%"]), 0, 10);
  const underscore = await data.programs("search-fixture", filter(["코드_1"]), 0, 10);
  assert.deepEqual(percent.rows.map((row) => row.name), ["100% 지원"]);
  assert.deepEqual(underscore.rows.map((row) => row.name), ["코드_1"]);
  assert.equal((await data.programs("search-fixture", filter([]), 0, 10)).total, 4);
});
