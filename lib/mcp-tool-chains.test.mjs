import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { database, NOW } from "./press-test-support.mjs";
import { McpData } from "./mcp/data.ts";
import { handleMcpRequest } from "./mcp/server.ts";
import {
  CARE_TOOL_NAMES,
  EXECUTABLE_MCP_TOOL_NAMES,
  LAW_MCP_TOOL_NAMES,
  PUBLIC_MCP_TOOL_NAMES,
  SPECIALIZED_MCP_TOOL_NAMES,
} from "./mcp/contract.ts";

const assets = {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    try {
      return new Response(await readFile(new URL("../public" + path, import.meta.url)));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return new Response("", { status: 404 });
    }
  },
};

function seedChainData(db) {
  db.sqlite.prepare("INSERT INTO official_sync_run (id, trigger, status, started_at, completed_at) VALUES ('chain-run', 'manual', 'succeeded', ?, ?)").run(NOW - 60, NOW);
  db.sqlite.prepare(
    "INSERT INTO official_service_snapshot (id, service_id, sync_run_id, sido, sigungu, category, subcategory, name, description, target, detail_target, provider, type, serial, detail_url, updated_date, collected_at, application_method) " +
    "VALUES ('chain-s1', 'CH100', 'chain-run', '강원특별자치도', '강릉시', '일상생활돌봄', '안부확인', '1촌돌봄단', '홀몸 어르신 안부 확인', '만 65세 이상 독거노인', '', '강릉시', '지자체', '1', 'https://www.mohw.go.kr', '2026-07-01', ?, '읍면동 주민센터 방문 신청')",
  ).run(NOW);
  db.sqlite.prepare(
    "INSERT INTO gov24_service (service_id, name, org_name, org_type, purpose, target, criteria, benefit, apply_method, detail_url, modified_at, detail_modified_at, detail_status, detail_fetched_at, first_seen_at, last_seen_at, presence, list_run_id) " +
    "VALUES ('SSE000000170', '기초연금', '보건복지부', '중앙행정기관', '노후 소득 보장', '만 65세 이상 소득하위 70%', '2026년 선정기준액 이하', '2026년 단독가구 최고 349,700원', '읍면동 행정복지센터 또는 복지로 신청', 'https://www.gov.kr/portal/rcvfvrSvc/dtlEx/SSE000000170', '20261001120000', '20261001120000', 'COLLECTED', ?, ?, ?, 'PRESENT', 'chain-gov')",
  ).run(NOW, NOW, NOW);
  return db;
}

async function rpc(db, method, params = {}, options = {}) {
  const response = await handleMcpRequest(
    new Request("https://dashboard.example/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
    new McpData(db, async () => new Map()),
    (error) => { throw error; },
    { welfareAssets: assets, ...options },
  );
  assert.equal(response.status, 200);
  return response.json();
}

const call = async (db, name, args = {}, options = {}) => (await rpc(db, "tools/call", { name, arguments: args }, options)).result;

test("스윗스팟 도구 노출: 돌봄자원과 법령을 제외하고 tools/list에 16개 핵심 도구만 노출하며 전체 32개 복지 도구를 실행한다", async (t) => {
  const db = seedChainData(database());
  t.after(() => db.sqlite.close());
  const listedRes = await rpc(db, "tools/list");
  const tools = listedRes.result.tools;
  assert.equal(tools.length, 16);
  assert.equal(PUBLIC_MCP_TOOL_NAMES.length, 16);
  assert.equal(SPECIALIZED_MCP_TOOL_NAMES.length, 16);
  assert.equal(EXECUTABLE_MCP_TOOL_NAMES.length, 32);
  const compactBytes = Buffer.byteLength(JSON.stringify(listedRes));
  assert.ok(compactBytes < 25_000, `tools/list compact bytes should be < 25KB, got ${compactBytes}`);
  for (const withheldTool of [...LAW_MCP_TOOL_NAMES, ...CARE_TOOL_NAMES]) {
    assert.ok(!tools.some((tool) => tool.name === withheldTool), withheldTool);
    assert.ok(!EXECUTABLE_MCP_TOOL_NAMES.includes(withheldTool), withheldTool);
  }
});

test("search(auto_detail=true)와 연속 호출 추천: 상위 후보의 상세 도구를 자동 체이닝하고 source_identity를 보존한다", async (t) => {
  const db = seedChainData(database());
  t.after(() => db.sqlite.close());
  const searchRes = await call(db, "search", { query: "2026년 기초연금 신청 조건", auto_detail: true, detail_limit: 2 });
  assert.equal(searchRes.isError, undefined);
  const payload = searchRes.structuredContent;
  assert.ok(Array.isArray(payload.suggested_tool_calls) && payload.suggested_tool_calls.length > 0);
  assert.match(payload.next_actions_text, /이어서 할 수 있는 조회/);
  assert.ok(Array.isArray(payload.chained_details) && payload.chained_details.length > 0);
  assert.equal(payload.chain_summary.requested_limit, 2);
  assert.ok(payload.chain_summary.succeeded_count >= 1);
  const govDetail = payload.chained_details.find((item) => item.id === "gov24_service:SSE000000170");
  assert.ok(govDetail, "정부24 기초연금 상세가 자동 체이닝되어야 한다");
  assert.equal(govDetail.tool, "get_welfare_context");
  assert.equal(govDetail.status, "SUCCEEDED");
  assert.equal(govDetail.detail.program.implementation_id, "gov24_service:SSE000000170");
  assert.equal(govDetail.detail.program.source_identity.canonical_id, "gov24_service:SSE000000170");
});

test("welfare_research: 질문 의도별로 task를 자동 판정하고 검색부터 상세·지역·통계까지 원스톱 체이닝한다", async (t) => {
  const db = seedChainData(database());
  t.after(() => db.sqlite.close());

  // 1) 신청자격·조건 질문 -> eligibility_check
  const elig = (await call(db, "welfare_research", { query: "2026년 기초연금 신청 자격과 지원금액", detail_limit: 2 })).structuredContent;
  assert.equal(elig.data.task_resolved, "eligibility_check");
  assert.ok(elig.data.chain_execution.steps_executed.some((step) => step.step === "primary_search" && step.status === "SUCCEEDED"));
  assert.ok(elig.data.chained_details.length >= 1);
  assert.ok(elig.data.suggested_tool_calls.length >= 1);

  // 2) 통계 추이 질문 -> statistics_trend (search_statistics + get_statistics_data 자동 체이닝)
  const stat = (await call(db, "welfare_research", { query: "국민기초생활보장 수급자 수 통계 추이", detail_limit: 1 })).structuredContent;
  assert.equal(stat.data.task_resolved, "statistics_trend");
  const hasStatDetail = stat.data.chained_details.some((item) => item.tool === "get_statistics_data" && item.status === "SUCCEEDED") || Boolean(stat.data.statistics_data);
  assert.equal(hasStatDetail, true);

  // 3) 지역 비교 질문 -> regional_compare (지역 대장 체이닝, 돌봄 수요는 비제공 제외)
  const regional = (await call(db, "welfare_research", { query: "서귀포시 통합돌봄 사업 목록 비교", detail_limit: 1 })).structuredContent;
  assert.equal(regional.data.task_resolved, "regional_compare");
  assert.ok(regional.data.regional_welfare_catalog, "지역 복지제도100 목록이 함께 조회되어야 한다");
  assert.equal(regional.data.care_demand, undefined, "돌봄자원 비제공 상태에서는 care_demand를 포함하지 않는다");
});

test("discover_tools와 execute_tool: 2-hop 전문 도구를 탐색·실행하고 메타 재귀와 비활성 도구(돌봄자원·법령)는 차단한다", async (t) => {
  const db = seedChainData(database());
  t.after(() => db.sqlite.close());

  const disc = (await call(db, "discover_tools", { intent: "129 상담 자주하는 질문 get_faq 온톨로지 관계" })).structuredContent.data;
  assert.equal(disc.law_status, "DISABLED");
  assert.equal(disc.care_status, "DISABLED");
  assert.equal(disc.exposed_tool_count, 16);
  assert.equal(disc.executable_tool_count, 32);
  assert.match(disc.text, /get_faq/);
  assert.match(disc.text, /execute_tool/);
  assert.doesNotMatch(disc.text, /find_care_institutions|get_care_demand|get_care_institution/);

  // 2-hop 전문 도구(get_ontology_schema, get_entity)를 execute_tool로 실행
  const schemaViaExec = await call(db, "execute_tool", {
    tool_name: "get_ontology_schema",
    params: { section: "entity_types" },
  });
  assert.equal(schemaViaExec.isError, undefined);
  assert.ok(schemaViaExec.structuredContent.data.some((item) => item.id === "welfare100_service"));

  const entityViaExec = await call(db, "execute_tool", {
    tool_name: "get_entity",
    params: { entity_id: "welfare100_service:seogwipo-warm-store" },
  });
  assert.equal(entityViaExec.isError, undefined);
  assert.equal(entityViaExec.structuredContent.data.source_identity.canonical_id, "welfare100_service:seogwipo-warm-store");

  // 메타 도구 재귀 호출 차단
  const recursion = await call(db, "execute_tool", {
    tool_name: "execute_tool",
    params: { tool_name: "get_dataset_status", params: {} },
  });
  assert.equal(recursion.isError, true);
  assert.equal(recursion.structuredContent.error.code, "META_TOOL_RECURSION");

  // 비활성 법령 도구 차단
  for (const lawTool of ["search_law", "legal_research", "get_law_text"]) {
    const blocked = await call(db, "execute_tool", {
      tool_name: lawTool,
      params: { query: "기초연금법" },
    });
    assert.equal(blocked.isError, true, lawTool);
    assert.equal(blocked.structuredContent.error.code, "LAW_MCP_DISABLED", lawTool);
  }

  // 비활성 돌봄자원 도구 차단
  for (const careTool of ["find_care_institutions", "get_care_institution", "get_care_demand"]) {
    const blocked = await call(db, "execute_tool", {
      tool_name: careTool,
      params: { region_id: "region:제주특별자치도|서귀포시" },
    });
    assert.equal(blocked.isError, true, careTool);
    assert.equal(blocked.structuredContent.error.code, "CARE_MCP_DISABLED", careTool);
  }
});

