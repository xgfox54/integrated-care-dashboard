import assert from "node:assert/strict";
import test from "node:test";
import { database } from "./press-test-support.mjs";
import { McpData } from "./mcp/data.ts";
import { handleMcpRequest } from "./mcp/server.ts";
import { LAW_MCP_TOOL_NAMES } from "./mcp/contract.ts";
import { enforceApiRateLimit } from "./api-rate-limit.ts";
import { recordMcpUsage, flushMcpUsage, readMcpUsage, summarizeMcpUsage, pruneMcpUsage } from "./mcp/usage.ts";
import { createSearchCacheInstance, createSearchResultCache, searchCacheKey } from "./mcp/search-cache.ts";

function quotaDatabase() {
  const db = database();
  let batches = 0;
  db.batch = async (statements) => {
    batches += 1;
    db.sqlite.exec("BEGIN");
    try {
      const values = statements.map((statement) => ({ results: db.sqlite.prepare(statement.sql).all(...statement.values) }));
      db.sqlite.exec("COMMIT");
      return values;
    } catch (error) { db.sqlite.exec("ROLLBACK"); throw error; }
  };
  return { db, batches: () => batches };
}
const request = (ip) => new Request("https://example.test/claude/mcp", { headers: { "cf-connecting-ip": ip } });

test("Claude reservations reduce D1 writes while 120 concurrent calls remain within the IP quota", async () => {
  const fixture = quotaDatabase();
  const responses = await Promise.all(Array.from({ length: 130 }, () => enforceApiRateLimit(request("203.0.113.10"), fixture.db, 600, { weight: 1, reserveCalls: 5 })));
  assert.equal(responses.filter((value) => !value).length, 120);
  assert.equal(responses.filter((value) => value?.status === 429).length, 10);
  assert.equal(fixture.batches(), 25, "24 reservations plus one rejected reservation, then local rejections");
  assert.equal(await enforceApiRateLimit(request("203.0.113.10"), fixture.db, 660, { weight: 1, reserveCalls: 5 }), null);
});

test("Claude reservations preserve the global quota across IPs, batch weights and database boundaries", async () => {
  const fixture = quotaDatabase();
  const responses = await Promise.all(Array.from({ length: 400 }, (_, index) => enforceApiRateLimit(request("203.0.113." + (20 + index % 4)), fixture.db, 1200, { weight: 1, reserveCalls: 5 })));
  assert.equal(responses.filter((value) => !value).length, 300);
  const other = quotaDatabase();
  let admitted = 0;
  for (let index = 0; index < 20; index += 1) if (!await enforceApiRateLimit(request("203.0.113.20"), other.db, 1200, { weight: 7, reserveCalls: 5 })) admitted += 7;
  assert.equal(admitted, 119);
  assert.equal((await enforceApiRateLimit(request("203.0.113.20"), other.db, 1200, { weight: 7, reserveCalls: 5 })).status, 429);
});

test("Claude initialization does not reserve capacity and failed reservations fail closed", async () => {
  const fixture = quotaDatabase();
  assert.equal(await enforceApiRateLimit(request("203.0.113.90"), fixture.db, 60, { weight: 0, reserveCalls: 5 }), null);
  assert.equal(fixture.batches(), 0);
  const broken = { prepare() { throw new Error("DB_DOWN"); } };
  assert.equal((await enforceApiRateLimit(request("203.0.113.90"), broken, 60, { weight: 1, reserveCalls: 5 })).status, 503);
});

test("usage aggregation retains tool errors, cache and latency distributions without identities or unknown names", async () => {
  const db = database();
  const now = Date.parse("2026-10-11T03:00:00Z");
  for (const value of [
    { tool: "search", durationMs: 100, failed: false, cache: "HIT" },
    { tool: "search", durationMs: 500, failed: false, cache: "MISS" },
    { tool: "fetch", durationMs: 11000, failed: true },
    { tool: "private-question-with-secret", durationMs: 5, failed: true },
    { tool: "__request__", durationMs: 3000, failed: true, rateLimited: true },
  ]) recordMcpUsage(db, { ...value, route: "/claude/mcp" }, now);
  await Promise.all([flushMcpUsage(db, 0), flushMcpUsage(db, 0)]);
  const report = await readMcpUsage(db, 1, now + 1000);
  assert.equal(report.rows.reduce((total, row) => total + row.calls, 0), 5);
  assert.ok(!JSON.stringify(report).includes("private-question-with-secret"));
  const summary = summarizeMcpUsage(report.rows.filter((row) => row.tool !== "__request__"));
  assert.deepEqual([summary.calls, summary.errors, summary.hits, summary.misses, summary.meanMs, summary.maxMs, summary.p95], [4, 2, 1, 1, 2901, 11000, ">10 s"]);
  recordMcpUsage(db, { tool: "search", durationMs: 50, failed: false, cache: "HIT", route: "/claude/mcp" }, now);
  await flushMcpUsage(db, 0);
  assert.equal((await readMcpUsage(db, 1, now + 1000)).rows.find((row) => row.tool === "search").calls, 3);
  recordMcpUsage(db, { tool: "search", durationMs: 1, failed: false, route: "/mcp" }, now - 91 * 86400_000);
  await flushMcpUsage(db, 0);
  await pruneMcpUsage(db, now);
  assert.equal(db.sqlite.prepare("SELECT SUM(calls) AS n FROM mcp_usage_hourly").get().n, 6);
});

test("usage report uses Korean midnight and separates database buffers", async () => {
  const db = database();
  const other = database();
  const now = Date.parse("2026-10-11T00:10:00+09:00");
  recordMcpUsage(db, { tool: "search", durationMs: 10, failed: false, route: "/mcp" }, now - 20 * 60_000);
  recordMcpUsage(db, { tool: "search", durationMs: 20, failed: false, route: "/mcp" }, now);
  await flushMcpUsage(db, 0);
  assert.equal((await readMcpUsage(db, 1, now)).rows.length, 1);
  assert.equal((await readMcpUsage(db, 7, now)).rows.length, 2);
  assert.equal((await readMcpUsage(other, 1, now)).rows.length, 0);
});

test("large search responses evict older cached entries before exhausting Worker memory", async () => {
  const cache = createSearchResultCache({ instance: createSearchCacheInstance() });
  const keys = await Promise.all(Array.from({ length: 12 }, (_, index) => searchCacheKey(["large", index])));
  for (const key of keys) cache.put(key, { text: "가".repeat(200000) });
  assert.equal((await cache.get(keys[0])).value, null);
  assert.equal((await cache.get(keys[11])).value.text.length, 200000);
});

test("MCP law tools and law fetch cannot be reenabled through request options or a configured key", async () => {
  const db = database();
  const data = new McpData(db, async () => ({}));
  const observations = [];
  async function rpc(method, params = {}) {
    const response = await handleMcpRequest(new Request("https://example.test/claude/mcp?oc=test", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }), data, undefined, { includeLaw: true, lawApiKey: "MUST_NOT_BE_USED", observeTool: (value) => observations.push(value) });
    return response.json();
  }
  const listed = (await rpc("tools/list")).result.tools;
  assert.equal(listed.length, 32);
  for (const name of LAW_MCP_TOOL_NAMES) {
    assert.ok(!listed.some((tool) => tool.name === name));
    const blocked = await rpc("tools/call", { name, arguments: {} });
    assert.ok(blocked.result?.isError || blocked.error, name);
  }
  const fetch = await rpc("tools/call", { name: "fetch", arguments: { id: "law:123:제1조" } });
  assert.equal(fetch.result.isError, true);
  assert.match(JSON.stringify(fetch), /LAW_MCP_DISABLED/);
  const search = await rpc("tools/call", { name: "search", arguments: { query: "노인복지법 제27조 의무" } });
  assert.equal(search.result.structuredContent.legal_lookup.status, "DISABLED");
  assert.ok(search.result.structuredContent.results.every((row) => row.entity_type !== "law"));
  const status = await rpc("tools/call", { name: "get_integration_status", arguments: {} });
  assert.equal(status.result.structuredContent.data.law_runtime.state, "DISABLED");
  assert.equal(observations.length, LAW_MCP_TOOL_NAMES.size + 3);
  assert.equal(observations.filter((row) => row.failed).length, LAW_MCP_TOOL_NAMES.size + 1);
  assert.ok(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='law_reference'").get(), "law storage remains intact");
});
