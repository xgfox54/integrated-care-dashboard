import assert from "node:assert/strict";
import test from "node:test";

import { serviceWikiKey } from "./dataset.ts";
import { McpData } from "./mcp/data.ts";
import { canonicalProgramRegion } from "./mcp/regions.ts";
import { database, NOW } from "./press-test-support.mjs";

const JEJU = "제주특별자치도";
const SEO = "서귀포시";
const CITY = "제주시";

function fixture() {
  const db = database();
  db.sqlite.prepare("INSERT INTO official_sync_run (id, trigger, status, started_at, completed_at) VALUES ('region-current', 'manual', 'succeeded', ?, ?), ('region-older', 'manual', 'succeeded', ?, ?)")
    .run(NOW, NOW, NOW - 100, NOW - 100);
  const insertService = db.sqlite.prepare(
    "INSERT INTO official_service_snapshot (id, service_id, sync_run_id, sido, sigungu, category, subcategory, name, description, target, detail_target, provider, type, serial, detail_url, updated_date, collected_at, application_method) " +
    "VALUES (?, ?, ?, ?, ?, '일상생활돌봄', '식사지원', ?, '식사와 일상생활을 지원합니다.', '돌봄이 필요한 주민', '', ?, '지자체', '1', 'https://www.mohw.go.kr/', '2026-07', ?, '')",
  );
  const service = (id, sido, sigungu, name, runId = "region-current") => insertService.run(runId + ":" + id, id, runId, sido, sigungu, name, sido, NOW);
  service("0075:8801:1:01", JEJU, JEJU, "제주가치돌봄");
  service("0075:8801:1:02", JEJU, "", "제주 광역 식사 지원");
  service("0075:8802:1:01", JEJU, SEO, "서귀포시 자체 식사 지원");
  service("0075:8803:1:01", JEJU, CITY, "제주시 자체 식사 지원");
  service("0075:8804:1:01", "강원특별자치도", "강원특별자치도", "강원 광역 식사 지원");
  service("0075:8805:1:01", "세종특별자치시", "세종특별자치시", "세종 돌봄");
  // 통합 이전 광주 관할을 새 통합 시·도 전체로 늘리지 않는다.
  service("0075:8806:1:01", "광주광역시", "광주광역시", "광주 이전 관할 사업");
  service("0075:8807:1:01", JEJU, SEO, "과거 공개본 전용 사업", "region-older");
  const insertDocument = db.sqlite.prepare(
    "INSERT INTO official_source_document (id, document_id, sync_run_id, province, municipality, title, published_at, data_as_of, detail_url, download_url, file_name, collected_at) " +
    "VALUES (?, ?, 'region-current', ?, ?, ?, '2026-03-20', '2026-07', ?, '', '', ?)",
  );
  for (const [id, municipality, title] of [
    ["0075:8801:1", JEJU, "제주특별자치도 통합돌봄 서비스 메뉴판"],
    ["0075:8802:1", SEO, "서귀포시 통합돌봄 서비스 메뉴판"],
    ["0075:8803:1", CITY, "제주시 통합돌봄 서비스 메뉴판"],
  ]) insertDocument.run("region-current:" + id, id, JEJU, municipality, title, "https://www.mohw.go.kr/board.es?list_no=" + id, NOW);
  const data = new McpData(db, async () => new Map());
  return { db, data };
}

const filter = (sigungu, includeAncestorScope = false, queryTokens = []) => ({
  sido: JEJU, sigungu, includeAncestorScope, categories: [], targetKeywords: [], queryTokens,
});

test("광역 이름이 정확히 중복된 범위만 정규화하고 다른 지방자치단체를 승격하지 않는다", () => {
  assert.deepEqual(canonicalProgramRegion(JEJU, JEJU), { sido: JEJU, sigungu: "" });
  assert.deepEqual(canonicalProgramRegion("세종특별자치시", "세종특별자치시"), { sido: "세종특별자치시", sigungu: "" });
  assert.deepEqual(canonicalProgramRegion(JEJU, SEO), { sido: JEJU, sigungu: SEO });
  assert.deepEqual(canonicalProgramRegion(JEJU, CITY), { sido: JEJU, sigungu: CITY });
  assert.deepEqual(canonicalProgramRegion("알수없는도", "알수없는도"), { sido: "알수없는도", sigungu: "알수없는도" });
  assert.deepEqual(canonicalProgramRegion("전남광주통합특별시", "광주광역시"), { sido: "전남광주통합특별시", sigungu: "광주광역시" });
});

test("제주가치돌봄은 상위범위 포함 시 서귀포·제주시에 동일한 시행사업 ID로 검색된다", async () => {
  const { data, db } = fixture();
  const province = await data.programs("region-current", filter("", false, ["제주가치돌봄"]), 0, 20);
  const seogwipo = await data.programs("region-current", filter(SEO, true, ["제주가치돌봄"]), 0, 20);
  const jejuCity = await data.programs("region-current", filter(CITY, true, ["제주가치돌봄"]), 0, 20);
  const localOnly = await data.programs("region-current", filter(SEO, false, ["제주가치돌봄"]), 0, 20);
  assert.equal(province.total, 1);
  assert.equal(seogwipo.total, 1);
  assert.equal(jejuCity.total, 1);
  assert.equal(localOnly.total, 0);
  assert.equal(serviceWikiKey(province.rows[0]), serviceWikiKey(seogwipo.rows[0]));
  assert.equal(serviceWikiKey(province.rows[0]), serviceWikiKey(jejuCity.rows[0]));
  assert.ok(serviceWikiKey(province.rows[0]).includes(`|${JEJU}|${JEJU}|`), "기존 원자료 기반 ID를 유지한다");
  assert.equal((await data.programByKey("region-current", serviceWikiKey(seogwipo.rows[0]))).serviceId, province.rows[0].serviceId);
  assert.equal(db.sqlite.prepare("SELECT sigungu FROM official_service_snapshot WHERE service_id = '0075:8801:1:01'").get().sigungu, JEJU);
});

test("지역상속은 형제 시·군·구와 다른 시·도 및 다른 공개본의 사업을 섞지 않는다", async () => {
  const { data } = fixture();
  const inherited = await data.programs("region-current", filter(SEO, true), 0, 20);
  assert.deepEqual(inherited.rows.map((row) => row.name).sort(), ["서귀포시 자체 식사 지원", "제주 광역 식사 지원", "제주가치돌봄"].sort());
  const local = await data.programs("region-current", filter(SEO), 0, 20);
  assert.deepEqual(local.rows.map((row) => row.name), ["서귀포시 자체 식사 지원"]);
  const city = await data.programs("region-current", filter(CITY), 0, 20);
  assert.deepEqual(city.rows.map((row) => row.name), ["제주시 자체 식사 지원"]);
  const older = await data.programs("region-older", filter(SEO, true), 0, 20);
  assert.deepEqual(older.rows.map((row) => row.name), ["과거 공개본 전용 사업"]);
  const merged = await data.programs("region-current", { ...filter("순천시", true), sido: "전남광주통합특별시" }, 0, 20);
  assert.equal(merged.total, 0, "과거 광주 관할 행을 순천시 광역 사업으로 취급하지 않는다");
});

test("광역 집계와 시·군·구 목록은 중복 광역 이름을 가짜 municipality로 세지 않는다", async () => {
  const { data } = fixture();
  assert.deepEqual(await data.regionMunicipalities("region-current", JEJU), [SEO, CITY]);
  assert.deepEqual(await data.regionMunicipalities("region-current", "세종특별자치시"), []);
  assert.equal(await data.regionProgramCount("region-current", JEJU, ""), 4);
  assert.equal(await data.regionProgramCount("region-current", JEJU, JEJU), 4, "기존 중복 지역 ID는 광역으로 조회한다");
  assert.equal(await data.regionProgramCount("region-current", JEJU, SEO), 1);
  const totals = await data.knowledgeTotals("region-current");
  assert.equal(totals.rows, 7);
  assert.equal(totals.sido, 4);
  assert.equal(totals.sigungu, 3, "광주 이전 관할은 별도 범위를 보존하며 제주·강원·세종 중복을 제외한다");
});

test("서귀포 출처 후보는 제주 광역문서를 포함하되 제주시 전용 문서는 제외하고 원본 출처를 보존한다", async () => {
  const { data } = fixture();
  const documents = await data.sourceDocuments("region-current", JEJU, SEO);
  assert.deepEqual(documents.map((row) => row.document_id).sort(), ["0075:8801:1", "0075:8802:1"]);
  const original = await data.sourceDocumentFor("region-current", "0075:8801:1:01");
  assert.equal(original.document_id, "0075:8801:1");
  assert.equal(original.municipality, JEJU, "원문 지역 필드는 수정하지 않는다");
  assert.equal(original.detail_url, "https://www.mohw.go.kr/board.es?list_no=0075:8801:1");
});

test("공개 MCP는 제주 광역 card scope와 기존 시행사업 fetch ID를 함께 보존한다", async () => {
  const { handleMcpRequest } = await import("./mcp/server.ts");
  const { data } = fixture();
  const call = async (name, args) => {
    const response = await handleMcpRequest(new Request("https://dashboard.example/mcp", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }), data, (error) => { throw error; });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.result && !body.result.isError, JSON.stringify(body));
    return body.result.structuredContent;
  };
  const province = await call("find_programs", { region_id: "region:" + JEJU, query: "제주가치돌봄" });
  const inherited = await call("find_programs", { region_id: "region:" + JEJU + "|" + SEO, query: "제주가치돌봄", include_ancestor_scope: true });
  assert.equal(inherited.data.length, 1);
  const card = inherited.data[0];
  assert.equal(card.implementation_id, province.data[0].implementation_id);
  assert.deepEqual(card.region, { region_id: "region:" + JEJU, sido: JEJU, sigungu: null });
  assert.equal(card.scope_level, "province");
  assert.ok(card.match_reasons.some((reason) => reason.startsWith("상위 광역 범위 포함:")));
  const local = await call("find_programs", { region_id: "region:" + JEJU + "|" + SEO, query: "제주가치돌봄", include_ancestor_scope: false });
  assert.equal(local.data.length, 0);
  const fetched = await call("fetch", { id: card.implementation_id });
  assert.equal(fetched.id, card.implementation_id);
  assert.equal(fetched.metadata.region_id, "region:" + JEJU);
  assert.ok(fetched.metadata.sources.some((source) => source.url === "https://www.mohw.go.kr/board.es?list_no=0075:8801:1"));
  const legacyRegion = await call("get_entity", { entity_id: "region:" + JEJU + "|" + JEJU });
  assert.equal(legacyRegion.data.level, "province");
  assert.equal(legacyRegion.data.facts.find((fact) => fact.predicate_id === "municipality_count").value, 2);
});
