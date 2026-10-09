import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test, { after } from "node:test";

import { businessDatabase } from "./business-data-test-support.mjs";
import { insertServicesStatement } from "./official-sync-writes.ts";

// D-04(2026-10-09): 관계성 지도 대상자 묶음 집계와 클릭 목록·API·CSV·메모리 조회가 같은 조건(target_group)을 쓴다.
// 아래 사업 행은 회귀시험용 합성 자료이며, 중랑구 행은 감사 보고서의 누락 사례(ID·사업명·대상 문구)를 그대로 옮겼다.

const db = businessDatabase();
globalThis.targetGroupFixtureDb = db;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/server") return { url: "data:text/javascript,export function after() {}", shortCircuit: true };
    if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env = { DB: globalThis.targetGroupFixtureDb };", shortCircuit: true };
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const url = new URL(specifier + ".ts", context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const { searchOfficialServices, exportOfficialServices } = await import("./official-query.ts");
const { parseDatasetSearchRequest, parseDatasetFilterRequest } = await import("./dataset-request.ts");
const { readDashboardFilters, dashboardPagePath, dashboardCsvUrl } = await import("./dashboard-url.ts");
const { searchQueryString } = await import("./search-query.ts");
const { filterRows } = await import("./dataset.ts");
const { targetGroupSql, SERVICE_TARGET_COLUMNS } = await import("./target-groups.ts");
const { parsePressSearch } = await import("./press/query.ts");
const { parseBudgetRequest } = await import("./fiscal/public.ts");
after(() => {
  hooks.deregister();
  db.sqlite.close();
  delete globalThis.targetGroupFixtureDb;
});

const base = { sido: "서울특별시", sigungu: "강북구", category: "일상생활돌봄", subcategory: "안부확인", name: "", description: "", target: "", detailTarget: "", applicationMethod: "", provider: "구청", type: "지역특화", serial: "1", detailUrl: "https://www.mohw.go.kr/board.es?mid=a60611000000&bid=0075&act=view&list_no=1", updatedDate: "2026-09" };
const services = [
  { ...base, serviceId: "0075:1489545:1:3:11", sigungu: "중랑구", category: "건강관리예방", subcategory: "구강건강", name: "구강건조증 및 관리 지원 서비스", target: "65세 이상 돌봄통합지원대상", serial: "11" },
  { ...base, serviceId: "t:only-noin", name: "방문 안부 돌봄", target: "홀몸 노인" },
  { ...base, serviceId: "t:only-eoreusin-detail", name: "안부 확인", detailTarget: "어르신 및 보호자" },
  { ...base, serviceId: "t:only-name", name: "어르신 행복택시", target: "교통약자" },
  { ...base, serviceId: "t:youth", name: "청년 월세 지원", target: "청년" },
  { ...base, serviceId: "t:none", name: "가사 지원", target: "중장년" },
  ...Array.from({ length: 25 }, (_, index) => ({ ...base, serviceId: "t:bulk-" + String(index).padStart(2, "0"), name: "노인 돌봄 " + index, target: "노인", serial: String(100 + index) })),
];
for (const statement of insertServicesStatement(db, "fixture", services, 0, 1791182652)) await statement.run();

const empty = { sido: "", sigungu: "", category: "", subcategory: "", type: "", keyword: "", sort: "region" };
const ids = (rows) => rows.map((row) => row.serviceId).sort();

async function allPages(filters, size = 20) {
  const seen = [];
  let total = null;
  for (let page = 1; page <= 20; page += 1) {
    const result = await searchOfficialServices(filters, page, size);
    total ??= result.totalCount;
    seen.push(...result.rows);
    if (seen.length >= result.totalCount || result.rows.length === 0) break;
  }
  return { ids: ids(seen), total };
}

function mapCountIds() {
  const { sql, values } = targetGroupSql("elderly", SERVICE_TARGET_COLUMNS);
  return db.sqlite.prepare("SELECT service_id AS serviceId FROM official_service_snapshot WHERE sync_run_id = 'fixture' AND " + sql).all(...values).map((row) => row.serviceId).sort();
}

test("T09 지도 집계·클릭 목록 전체 쪽·CSV·메모리 조회의 사업 ID 집합이 같고, 「노인」「어르신」「65세」만 있는 사업과 중랑구 사례를 포함한다", async () => {
  const expected = mapCountIds();
  assert.equal(expected.length, 29);
  for (const id of ["0075:1489545:1:3:11", "t:only-noin", "t:only-eoreusin-detail", "t:only-name"]) assert.ok(expected.includes(id), id);
  assert.ok(!expected.includes("t:youth") && !expected.includes("t:none"));
  const filters = { ...empty, targetGroup: "elderly" };
  const listed = await allPages(filters);
  assert.equal(listed.total, expected.length, "목록 총건수 = 지도 집계");
  assert.deepEqual(listed.ids, expected, "여러 쪽을 합친 목록 = 지도 집계 대상");
  assert.deepEqual(ids(await exportOfficialServices(filters)), expected, "CSV = 지도 집계 대상");
  const everything = await exportOfficialServices(empty);
  assert.deepEqual(ids(filterRows(everything, filters)), expected, "메모리 대체 조회 = SQL 조회");
});

test("T09 감사 당시 클릭 링크(q=노인)는 중랑구·어르신·65세 사업을 빠뜨렸다(회귀 근거)", async () => {
  const old = await allPages({ ...empty, keyword: "노인" });
  assert.ok(!old.ids.includes("0075:1489545:1:3:11"));
  assert.ok(!old.ids.includes("t:only-eoreusin-detail"));
});

test("T08 대상자 묶음은 지역·분류·중분류·검색어와 AND로 결합되고, 그룹 안 낱말은 OR이다", async () => {
  const jungnang = await allPages({ ...empty, targetGroup: "elderly", sido: "서울특별시", sigungu: "중랑구", category: "건강관리예방", subcategory: "구강건강" });
  assert.deepEqual(jungnang.ids, ["0075:1489545:1:3:11"]);
  const withKeyword = await allPages({ ...empty, targetGroup: "elderly", keyword: "택시" });
  assert.deepEqual(withKeyword.ids, ["t:only-name"]);
  assert.deepEqual((await allPages({ ...empty, targetGroup: "youth" })).ids, ["t:youth"]);
});

test("T08 요청·주소: 유효한 묶음은 유지, 알 수 없는 묶음·중복 키는 거절, 공유주소·CSV·검색 주소가 조건을 그대로 싣는다", () => {
  const ok = parseDatasetSearchRequest(new URLSearchParams("target_group=elderly&sido=서울특별시&sigungu=중랑구&category=건강관리예방&subcategory=구강건강&q=구강&page=2&size=20"));
  assert.equal(ok.success, true);
  assert.deepEqual([ok.data.filters.targetGroup, ok.data.filters.sigungu, ok.data.filters.subcategory, ok.data.filters.keyword, ok.data.page], ["elderly", "중랑구", "구강건강", "구강", 2]);
  assert.equal(parseDatasetFilterRequest(new URLSearchParams("target_group=target:elderly")).data.targetGroup, "elderly", "MCP 묶음 ID도 받는다");
  assert.equal(parseDatasetSearchRequest(new URLSearchParams("target_group=unknown")).success, false, "알 수 없는 묶음을 버리고 전체 결과를 보이지 않는다");
  assert.equal(parseDatasetSearchRequest(new URLSearchParams("target_group=elderly&target_group=child")).success, false, "중복 키 거절");
  const filters = readDashboardFilters("?target_group=elderly&category=건강관리예방&subcategory=구강건강");
  assert.equal(filters.targetGroup, "elderly");
  assert.equal(readDashboardFilters("?target_group=nope").targetGroup ?? "", "", "알 수 없는 값은 화면 조건으로 쓰지 않는다");
  const shared = new URL(dashboardPagePath("/", filters, "#search-results"), "https://example.test");
  assert.equal(shared.searchParams.get("target_group"), "elderly", "새로고침·공유 주소에 남는다");
  assert.equal(new URL(dashboardCsvUrl(filters), "https://example.test").searchParams.get("target_group"), "elderly");
  const api = new URLSearchParams(searchQueryString(filters, 3, 20));
  assert.deepEqual([api.get("target_group"), api.get("page")], ["elderly", "3"], "페이지 이동에도 조건 유지");
  assert.notEqual(searchQueryString(filters, 1, 20), searchQueryString({ ...filters, targetGroup: "" }, 1, 20), "캐시 키가 조건마다 다르다");
});

test("T08 보도자료·예산 조회도 같은 묶음 ID를 받고, 알 수 없는 묶음·중복 키를 거절한다", () => {
  assert.equal(parsePressSearch(new URLSearchParams("target_group=elderly")).search.targetGroup, "elderly");
  assert.equal(parsePressSearch(new URLSearchParams("target_group=nope")).ok, false);
  assert.equal(parsePressSearch(new URLSearchParams("target_group=elderly&target_group=child")).ok, false);
  assert.equal(parseBudgetRequest(new URLSearchParams("mode=social_welfare&target_group=elderly")).request.targetGroup, "elderly");
  assert.equal(parseBudgetRequest(new URLSearchParams("target_group=nope")).ok, false);
});
