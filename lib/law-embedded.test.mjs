import assert from "node:assert/strict";
import test from "node:test";

import { apiRatePolicy } from "./api-rate-limit.ts";
import { handleLawHttpRequest } from "./law/http.ts";
import { KOREAN_LAW_PACKAGE_VERSION, LAW_TOOL_NAMES } from "./law/mcp-tools.ts";

const ORIGIN = "https://dashboard.example";

function jsonRequest(body, headers = {}) {
  return new Request(ORIGIN + "/api/law", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("내장 법령 API 상태는 외부 MCP 주소 없이 고정 버전과 설정 여부를 알린다", async () => {
  const response = await handleLawHttpRequest(new Request(ORIGIN + "/api/law"), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.implementation, "embedded");
  assert.equal(body.package, "korean-law-mcp");
  assert.equal(body.package_version, KOREAN_LAW_PACKAGE_VERSION);
  assert.equal(body.configured, false);
  assert.ok(!JSON.stringify(body).includes("mcp.gomdori.app"));
});

test("법령 API는 서버 LAW_OC가 없으면 호출하지 않고 명확히 거절한다", async () => {
  const response = await handleLawHttpRequest(jsonRequest({ tool: "search_law", args: { query: "통합돌봄" } }), {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "LAW_API_NOT_CONFIGURED");
});

test("법령 API는 교차 출처와 메타 도구 실행을 거절한다", async () => {
  const crossOrigin = await handleLawHttpRequest(new Request(ORIGIN + "/api/law", {
    method: "POST",
    headers: { origin: "https://attacker.example", "content-type": "application/json" },
    body: JSON.stringify({ tool: "search_law", args: { query: "통합돌봄" } }),
  }), { LAW_OC: "server-only" });
  assert.equal(crossOrigin.status, 403);

  const meta = await handleLawHttpRequest(jsonRequest({ tool: "execute_tool", args: {} }), { LAW_OC: "server-only" });
  assert.equal(meta.status, 400);
  assert.equal((await meta.json()).error, "UNSUPPORTED_TOOL");
});

test("법령 MCP 공개 스키마는 10개 도구이며 클라이언트 인증값을 오류에도 노출하지 않는다", async () => {
  assert.equal(LAW_TOOL_NAMES.length, 10);
  const secret = "CLIENT_SECRET_MUST_NOT_LEAK";
  const response = await handleLawHttpRequest(jsonRequest({
    tool: "legal_analysis",
    args: { mode: "not-a-valid-mode", apiKey: secret, nested: { LAW_OC: secret } },
  }), { LAW_OC: "server-only" });
  assert.equal(response.status, 422);
  assert.ok(!JSON.stringify(await response.json()).includes(secret));
});

test("법령 공개 API는 분당 30회 별도 보호 정책을 쓴다", () => {
  assert.deepEqual(apiRatePolicy("/api/law"), { name: "law", limit: 30, windowSeconds: 60 });
});
