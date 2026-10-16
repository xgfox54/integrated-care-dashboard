// 2026-10-10 검토 후속: 행정시 조례 검색 보정, 내장 법령 런타임 상태, 지역 표기 중복 제거.
import assert from "node:assert/strict";
import test from "node:test";
import { LawApiClient } from "korean-law-mcp/lib/api-client";
import { normalizeOrdinanceQuery, runLawTool } from "./law/mcp-tools.ts";
import { lawRuntimeDto } from "./mcp/integration-tools.ts";
import { regionLabel } from "./mcp/regions.ts";

test("제주 행정시 이름은 제주특별자치도 조례 검색어로 바꾸고 다른 지역은 그대로 둔다", () => {
  assert.deepEqual(normalizeOrdinanceQuery("서귀포시 돌봄"), { query: "제주특별자치도 돌봄", replaced: ["서귀포시"] });
  assert.deepEqual(normalizeOrdinanceQuery("제주시 서귀포시 노인"), { query: "제주특별자치도 노인", replaced: ["제주시", "서귀포시"] });
  assert.deepEqual(normalizeOrdinanceQuery("부산광역시 금정구 돌봄"), { query: "부산광역시 금정구 돌봄", replaced: [] });
  assert.deepEqual(normalizeOrdinanceQuery("제주특별자치도 돌봄"), { query: "제주특별자치도 돌봄", replaced: [] });
});

test("execute_tool의 조례 검색은 보정한 검색어로 법제처 엔진을 호출한다", async () => {
  const original = LawApiClient.prototype.searchOrdinance;
  const seen = [];
  LawApiClient.prototype.searchOrdinance = async function (params) { seen.push(JSON.stringify(params)); throw new Error("LOCAL_UPSTREAM_SENTINEL"); };
  try {
    await runLawTool("execute_tool", { tool_name: "search_ordinance", params: { query: "서귀포시 돌봄", display: 1 } }, { apiKey: "SYNTHETIC_NOT_A_REAL_KEY" });
    assert.ok(seen.length > 0, "엔진까지 호출되어야 한다");
    assert.ok(seen.every((value) => value.includes("제주특별자치도") && !value.includes("서귀포시")), seen.join("\n"));
  } finally { LawApiClient.prototype.searchOrdinance = original; }
});

test("법령 런타임 상태는 키 값 없이 실시간 조회 가능 여부만 알린다", () => {
  const live = lawRuntimeDto({ embedded: true, configured: true, packageVersion: "4.15.6" });
  assert.equal(live.state, "LIVE_QUERY_AVAILABLE");
  assert.match(live.name, /4\.15\.6/);
  assert.equal(lawRuntimeDto({ embedded: true, configured: false, packageVersion: "4.15.6" }).state, "AUTH_REQUIRED");
  assert.equal(lawRuntimeDto(undefined).state, "DISABLED");
  assert.doesNotMatch(JSON.stringify(live), /SYNTHETIC|apiKey|LAW_OC=/);
});

test("광역 사업의 시·도 이름 중복은 한 번만 표기한다", () => {
  assert.equal(regionLabel("제주특별자치도", "제주특별자치도"), "제주특별자치도");
  assert.equal(regionLabel("제주특별자치도", "서귀포시"), "제주특별자치도 서귀포시");
  assert.equal(regionLabel("세종특별자치시", ""), "세종특별자치시");
  assert.equal(regionLabel("", ""), "");
});

