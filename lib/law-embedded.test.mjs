import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { apiRatePolicy } from "./api-rate-limit.ts";
import { handleLawHttpRequest } from "./law/http.ts";
import { SimpleCache } from "./law/worker-cache.ts";
import {
  KOREAN_LAW_PACKAGE_VERSION,
  LAW_TOOL_NAMES,
  detectLawApiEnvelopeFailure,
  runLawTool,
} from "./law/mcp-tools.ts";

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

test("법령 도구 10개는 LAW_OC 없이 클라이언트 키·다른 환경변수로 외부 호출을 하지 않는다", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const envKeys = ["KOREAN_LAW_API_KEY", "LAW_OC", "LAW_API_KEY", "OC", "API_KEY"];
  const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("법제처를 호출하면 안 됩니다.");
  };
  for (const key of envKeys) process.env[key] = "ENV_KEY_MUST_NOT_BE_USED";
  try {
    for (const name of LAW_TOOL_NAMES) {
      const result = await runLawTool(name, {
        apiKey: "CLIENT_KEY_MUST_NOT_BE_USED",
        OC: "CLIENT_KEY_MUST_NOT_BE_USED",
        params: { api_key: "CLIENT_KEY_MUST_NOT_BE_USED", options: { law_oc: "CLIENT_KEY_MUST_NOT_BE_USED" } },
      }, { apiKey: " \t " });
      assert.equal(result.isError, true, name);
      assert.equal(JSON.parse(result.content[0].text).code, "LAW_API_NOT_CONFIGURED", name);
      assert.doesNotMatch(JSON.stringify(result), /CLIENT_KEY_MUST_NOT_BE_USED|ENV_KEY_MUST_NOT_BE_USED/);
    }
    const response = await handleLawHttpRequest(jsonRequest({
      tool: "search_law", args: { query: "통합돌봄", apiKey: "CLIENT_KEY_MUST_NOT_BE_USED" },
    }), {});
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "LAW_API_NOT_CONFIGURED");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("법령 API는 선언 길이 없이 전달된 큰 본문도 64 KiB에서 취소한다", async () => {
  for (const declaredLength of [undefined, "8"]) {
    let pulledChunks = 0;
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) {
        pulledChunks += 1;
        controller.enqueue(new Uint8Array(8 * 1024).fill(32));
        if (pulledChunks === 100) controller.close();
      },
      cancel() { cancelled = true; },
    });
    const request = new Request(ORIGIN + "/api/law", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        ...(declaredLength ? { "content-length": declaredLength } : {}),
      },
      body: stream,
      duplex: "half",
    });
    const response = await handleLawHttpRequest(request, { LAW_OC: "server-only" });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error, "REQUEST_TOO_LARGE");
    assert.equal(cancelled, true);
    assert.ok(pulledChunks <= 10, `본문을 끝까지 읽으면 안 됩니다: ${pulledChunks}`);
  }
});

test("법령 API는 64 KiB 경계와 나뉜 UTF-8을 허용하고 잘못된 JSON을 거절한다", async () => {
  const exactBody = JSON.stringify({ tool: "unsupported", args: {} }).padEnd(64 * 1024, " ");
  const exactResponse = await handleLawHttpRequest(new Request(ORIGIN + "/api/law", {
    method: "POST", headers: { "content-type": "application/json" }, body: exactBody,
  }), { LAW_OC: "server-only" });
  assert.equal(exactResponse.status, 400);
  assert.equal((await exactResponse.json()).error, "UNSUPPORTED_TOOL");

  const encoded = new TextEncoder().encode(JSON.stringify({ tool: "없는_도구" }));
  let offset = 0;
  const splitRequest = new Request(ORIGIN + "/api/law", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: new ReadableStream({
      pull(controller) {
        if (offset === encoded.length) controller.close();
        else controller.enqueue(encoded.slice(offset, ++offset));
      },
    }),
    duplex: "half",
  });
  const splitResponse = await handleLawHttpRequest(splitRequest, { LAW_OC: "server-only" });
  assert.equal((await splitResponse.json()).error, "UNSUPPORTED_TOOL");
  const malformed = await handleLawHttpRequest(new Request(ORIGIN + "/api/law", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{",
  }), { LAW_OC: "server-only" });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, "INVALID_REQUEST");
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

test("법제처의 HTTP 200 사용자 검증 오류 봉투를 JSON·XML 모두 판별한다", () => {
  const expected = /운영 서버의 IP 주소 또는 도메인/;
  assert.match(detectLawApiEnvelopeFailure(JSON.stringify({
    result: "사용자 정보 검증에 실패하였습니다.",
    msg: "정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요.",
  }))?.message ?? "", expected);
  assert.match(detectLawApiEnvelopeFailure(
    "<response><result>사용자 정보 검증에 실패하였습니다.</result><msg><![CDATA[정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요.]]></msg></response>",
  )?.message ?? "", expected);
});

test("법제처 사용자 검증 실패를 검색 결과 0건으로 오인하지 않는다", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    result: "사용자 정보 검증에 실패하였습니다.",
    msg: "OPEN API 호출 시 정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요.",
  }), { status: 200, headers: { "content-type": "application/json;charset=UTF-8" } });
  try {
    const result = await runLawTool("search_law", { query: "노인복지법" }, { apiKey: "test-only" });
    const text = result.content.map((item) => item.text).join("\n");
    assert.equal(result.isError, true);
    assert.match(text, /EXTERNAL_API_ERROR/);
    assert.match(text, /IP 주소 또는 도메인/);
    assert.doesNotMatch(text, /NOT_FOUND/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("직접·메타 법령 실행은 클라이언트 OC 대신 서버 인증값만 공식 API에 전달한다", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.KOREAN_LAW_API_KEY;
  const serverKey = "SERVER_ONLY_KEY_FOR_MOCK";
  const clientKey = "CLIENT_KEY_MUST_NOT_OVERRIDE";
  const calledUrls = [];
  process.env.KOREAN_LAW_API_KEY = "ENV_KEY_MUST_NOT_OVERRIDE";
  globalThis.fetch = async (input) => {
    calledUrls.push(new URL(input instanceof Request ? input.url : String(input)));
    return new Response(JSON.stringify({
      result: "사용자 정보 검증에 실패하였습니다.",
      msg: "정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요.",
    }), { status: 200, headers: { "content-type": "application/json;charset=UTF-8" } });
  };
  try {
    const direct = await runLawTool("search_law", {
      query: "서버 인증값 격리 확인", display: 1, apiKey: clientKey, OC: clientKey,
    }, { apiKey: ` ${serverKey} ` });
    const directCalls = calledUrls.length;
    assert.ok(directCalls > 0, "직접 도구가 모킹된 법제처 API를 호출해야 합니다.");
    const meta = await runLawTool("execute_tool", {
      tool_name: "search_decisions",
      params: {
        domain: "precedent", query: "메타 인증값 격리 확인", display: 1,
        apiKey: clientKey, options: { OC: clientKey, api_key: clientKey, KOREAN_LAW_API_KEY: clientKey },
      },
    }, { apiKey: serverKey });
    assert.ok(calledUrls.length > directCalls, "메타 도구도 모킹된 법제처 API를 호출해야 합니다.");
    for (const url of calledUrls) {
      assert.equal(url.hostname, "www.law.go.kr");
      assert.equal(url.searchParams.get("OC"), serverKey);
      assert.doesNotMatch(url.href, /CLIENT_KEY_MUST_NOT_OVERRIDE|ENV_KEY_MUST_NOT_OVERRIDE/);
    }
    for (const result of [direct, meta]) {
      assert.equal(result.isError, true);
      assert.doesNotMatch(JSON.stringify(result), /SERVER_ONLY_KEY_FOR_MOCK|CLIENT_KEY_MUST_NOT_OVERRIDE|ENV_KEY_MUST_NOT_OVERRIDE/);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnv === undefined) delete process.env.KOREAN_LAW_API_KEY;
    else process.env.KOREAN_LAW_API_KEY = originalEnv;
  }
});

test("법령 공개 API는 분당 30회 별도 보호 정책을 쓴다", () => {
  assert.deepEqual(apiRatePolicy("/api/law"), { name: "law", limit: 30, windowSeconds: 60 });
});

test("Worker 법령 캐시는 전역 타이머 없이 TTL·LRU 동작을 제공하고 빌드 별칭으로 교체된다", async () => {
  const cache = new SimpleCache(2);
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.get("a"), 1);
  cache.set("c", 3);
  assert.equal(cache.get("b"), null);
  assert.equal(cache.get("c"), 3);

  const [cacheSource, viteSource] = await Promise.all([
    readFile(new URL("./law/worker-cache.ts", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(cacheSource, /setInterval\s*\(/);
  assert.match(viteSource, /LAW_WORKER_CACHE_MODULE/);
  assert.match(viteSource, /source === "\.\/cache\.js" \|\| source === "\.\.\/lib\/cache\.js"/);
});
