import assert from "node:assert/strict";
import test from "node:test";
import { database } from "./press-test-support.mjs";
import { McpData } from "./mcp/data.ts";
import { handleMcpRequest } from "./mcp/server.ts";
import { createMcpTrace, recordMcpTrace, readMcpTraces, pruneMcpTraces, responseProvenance } from "./mcp/trace.ts";

test("trace stores safe conditions and returned references while dropping sensitive content", async () => {
  const db = database();
  try {
    const context = { requestId: crypto.randomUUID(), callId: crypto.randomUUID(), route: "/mcp", startedAt: Date.now() };
    const secret = "홍길동 010-1234-5678 비밀번호 super-secret";
    const observation = { tool: "search", arguments: { query: "2026년 생계급여 " + secret, region_id: "region:강원특별자치도|강릉시", token: "credential-secret" }, response: { release_bundle_id: "rb:123", evidence: [{ document_id: "doc:42", revision: "rev-7", quote: secret, url: "https://a.test/?key=credential-secret" }] }, failed: false, durationMs: 45, cache: "HIT" };
    const trace = await createMcpTrace(observation, context);
    await recordMcpTrace(db, trace);
    const report = await readMcpTraces(db, { limit: 100, requestId: context.requestId });
    assert.equal(report.rows.length, 1);
    const row = report.rows[0];
    assert.equal(row.request_id, context.requestId);
    assert.equal(row.cache, "HIT");
    assert.match(row.query_hash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.parse(row.conditions_json).year, 2026);
    assert.match(JSON.parse(row.conditions_json).region_id, /강릉/);
    assert.deepEqual(new Set(JSON.parse(row.provenance_json).references), new Set(["release_bundle_id=rb:123", "document_id=doc:42", "revision=rev-7"]));
    for (const marker of ["홍길동", "010-1234-5678", "super-secret", "credential-secret"]) assert.equal(JSON.stringify(report).includes(marker), false);
  } finally { db.sqlite.close(); }
});

test("trace retention removes expired rows and report bounds row count", async () => {
  const db = database();
  try {
    const now = Date.now();
    for (const days of [0, 1, 15]) await recordMcpTrace(db, await createMcpTrace({ tool: "search", failed: false, durationMs: 1 }, { requestId: crypto.randomUUID(), callId: crypto.randomUUID(), route: "/mcp", startedAt: now - days * 86400000 }));
    await pruneMcpTraces(db, now);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM mcp_call_traces").get().n, 2);
    assert.equal((await readMcpTraces(db, { limit: 1 }, now)).rows.length, 1);
    assert.equal((await readMcpTraces(db, { limit: 999 }, now)).limit, 100);
  } finally { db.sqlite.close(); }
});

test("MCP HTTP success and validation failures correlate trace IDs with response headers", async () => {
  const db = database();
  try {
    const data = new McpData(db, async () => new Map());
    for (const [name, args, failed] of [["get_dataset_status", {}, 0], ["unknown-private-tool", {}, 1], ["fetch", {}, 1]]) {
      const traces = [];
      const aggregates = [];
      const response = await handleMcpRequest(new Request("https://example.test/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: "sensitive-rpc-id", method: "tools/call", params: { name, arguments: args } }) }), data, undefined, { observeTrace: (trace) => traces.push(trace), observeTool: (observation) => aggregates.push(observation) });
      const payload = await response.json();
      const rows = await Promise.all(traces);
      assert.equal(rows.length, 1);
      assert.equal(aggregates.length, 1);
      assert.equal(rows[0].request_id, response.headers.get("x-mcp-request-id"));
      assert.equal(rows[0].call_id, response.headers.get("x-mcp-call-ids"));
      assert.equal(rows[0].failed, failed);
      assert.equal(JSON.stringify(rows).includes("sensitive-rpc-id"), false);
      if (!failed) { assert.ok(payload.result); assert.match(rows[0].provenance_json, /rb:/); }
    }
  } finally { db.sqlite.close(); }
});

test("response provenance caps large result sets and marks truncation", () => {
  const result = responseProvenance({ items: Array.from({ length: 200 }, (_, index) => ({ document_id: "doc:" + index })) });
  assert.equal(result.references.length, 100);
  assert.equal(result.truncated, true);
});

test("trace preserves explicit fiscal year and safe news date and region filters without a query", async () => {
  const trace = await createMcpTrace({ tool: "search_news", failed: false, durationMs: 4, arguments: {
    fiscal_year: "2025", region_ids: ["region:서울특별시", "region:제주특별자치도|서귀포시"],
    date_from: "2024-02-29", date_to: "2026-10-12", as_of: "2025-12-31",
  }, response: { dataset_id: "city:seogwipo-population" } }, { requestId: crypto.randomUUID(), callId: crypto.randomUUID(), route: "/mcp", startedAt: Date.now() });
  const conditions = JSON.parse(trace.conditions_json);
  assert.equal(trace.query_hash, null);
  assert.equal(conditions.year, 2025);
  assert.equal(conditions.fiscal_year, 2025);
  assert.deepEqual(conditions.region_ids, ["region:서울특별시", "region:제주특별자치도|서귀포시"]);
  assert.equal(conditions.date_from, "2024-02-29");
  assert.equal(conditions.date_to, "2026-10-12");
  assert.equal(conditions.as_of, "2025-12-31");
  assert.deepEqual(JSON.parse(trace.provenance_json).references, ["dataset_id=city:seogwipo-population"]);
});

for (const invalid of ["private-person", "2025-02-29", "2026-13-01", "2026-10-12T00:00:00Z"]) {
  test("trace drops invalid dates and unregistered regions when supplied: " + invalid, async () => {
    const trace = await createMcpTrace({ tool: "search_news", failed: true, durationMs: 0, arguments: {
      fiscal_year: "2026 private-person", region_ids: ["region:서울특별시|private-person"], date_from: invalid, date_to: invalid, as_of: invalid,
    } }, { requestId: crypto.randomUUID(), callId: crypto.randomUUID(), route: "/mcp", startedAt: Date.now() });
    const conditions = JSON.parse(trace.conditions_json);
    assert.equal(conditions.fiscal_year, null);
    assert.deepEqual(conditions.region_ids, []);
    for (const field of ["date_from", "date_to", "as_of"]) assert.equal(conditions[field], null);
    assert.equal(trace.conditions_json.includes("private-person"), false);
  });
}

test("trace bounds region arrays and preserves distinct valid explicit year fields", async () => {
  const trace = await createMcpTrace({ tool: "search", failed: false, durationMs: 0, arguments: {
    year: "1900", fiscal_year: 2200, region_ids: Array(11).fill("region:전국"),
  } }, { requestId: crypto.randomUUID(), callId: crypto.randomUUID(), route: "/mcp", startedAt: Date.now() });
  const conditions = JSON.parse(trace.conditions_json);
  assert.equal(conditions.year, 1900);
  assert.equal(conditions.fiscal_year, 2200);
  assert.deepEqual(conditions.region_ids, []);
});

test("trace strips unregistered personal-name municipalities from explicit and inferred regions", async () => {
  for (const args of [{ query: "서울특별시 홍길동시 생활 지원 문의" }, { region_id: "region:서울특별시|홍길동시" }]) {
    const trace = await createMcpTrace({ tool: "search", failed: false, durationMs: 1, arguments: args }, { requestId: crypto.randomUUID(), callId: crypto.randomUUID(), route: "/mcp", startedAt: Date.now() });
    assert.equal(JSON.parse(trace.conditions_json).region_id, "region:서울특별시");
    assert.equal(trace.conditions_json.includes("홍길동"), false);
  }
});

test("trace retains public municipalities from the existing search taxonomy", async () => {
  const trace = await createMcpTrace({ tool: "search_news", failed: false, durationMs: 1, arguments: { region_id: "region:강원특별자치도|강릉시", region_ids: ["region:강원특별자치도|강릉시", "region:부산광역시|해운대구"] } }, { requestId: crypto.randomUUID(), callId: crypto.randomUUID(), route: "/mcp", startedAt: Date.now() });
  const conditions = JSON.parse(trace.conditions_json);
  assert.equal(conditions.region_id, "region:강원특별자치도|강릉시");
  assert.deepEqual(conditions.region_ids, ["region:강원특별자치도|강릉시", "region:부산광역시|해운대구"]);
});

test("trace preserves source IDs and prioritizes outer release revisions ahead of large result lists", () => {
  const provenance = responseProvenance({ results: Array.from({ length: 100 }, (_, index) => ({ id: "manual:" + index })), release_bundle_id: "rb:public", manual_revision: "manual:revision", source_version_id: "version:42", source_id: "source:public" });
  assert.equal(provenance.references.length, 100);
  assert.equal(provenance.truncated, true);
  for (const reference of ["release_bundle_id=rb:public", "manual_revision=manual:revision", "source_version_id=version:42", "source_id=source:public"]) assert.equal(provenance.references.includes(reference), true);
});
