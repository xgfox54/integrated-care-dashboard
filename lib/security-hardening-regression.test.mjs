import assert from "node:assert/strict";
import test from "node:test";
import { rateLimitFingerprint, enforceApiRateLimit, apiRatePolicy } from "./api-rate-limit.ts";
import { readBoundedBody, readBoundedJson } from "./request-body.ts";
import { redactLogText, logServerError } from "./errors.ts";
import { redactCredentialValue } from "./credential-redaction.ts";

function database() {
  const counts = new Map();
  return { counts, prepare() { return { bind(key) { return { async first() { const count = (counts.get(key) ?? 0) + 1; counts.set(key, count); return { request_count: count }; } }; } }; } };
}
const request = (headers = {}, route = "/mcp") => new Request("https://owned.test" + route, { headers: { "cf-connecting-ip": "203.0.113.20", ...headers } });

test("S1: mutable headers cannot create a new IP quota", async () => {
  const db = database();
  const { limit } = apiRatePolicy("/mcp");
  for (let n = 0; n < limit; n++) assert.equal(await enforceApiRateLimit(request(), db, 1800000000), null);
  for (const headers of [{}, {cookie: "a=2"}, {"user-agent": "different"}, {"accept-language": "en"}, {"x-forwarded-for": "192.0.2.2"}, {authorization: "Bearer synthetic"}]) {
    assert.equal((await enforceApiRateLimit(request(headers), db, 1800000000)).status, 429);
  }
  assert.equal([...db.counts.keys()].filter((key) => key.includes(":ip-v2:")).length, 1);
});
test("S1: separate trusted IPs and time windows retain independent quotas", async () => {
  const db = database();
  for (let n = 0; n < apiRatePolicy("/mcp").limit; n++) await enforceApiRateLimit(request(), db, 1800000000);
  assert.equal(await enforceApiRateLimit(request({"cf-connecting-ip":"203.0.113.21"}), db, 1800000000), null);
  assert.equal(await enforceApiRateLimit(request(), db, 1800000060), null);
});
test("S1: stable fingerprint ignores cookies and unsupported proxy headers", async () => {
  assert.equal(await rateLimitFingerprint(request()), await rateLimitFingerprint(request({cookie:"new=1", "user-agent":"new", "x-forwarded-for":"192.0.2.5"})));
  assert.equal(await rateLimitFingerprint(new Request("https://owned.test/mcp", {headers:{"x-forwarded-for":"192.0.2.5"}})), await rateLimitFingerprint(new Request("https://owned.test/mcp", {headers:{"x-forwarded-for":"192.0.2.6"}})));
});

test("S2: an undeclared oversized stream is cancelled early", async () => {
  let emitted = 0, cancelled = false;
  const stream = new ReadableStream({ pull(c) { if (emitted < 12) { emitted++; c.enqueue(new Uint8Array(16384).fill(32)); } else c.close(); }, cancel() { cancelled = true; } });
  const req = new Request("https://owned.test", {method:"POST",body:stream,duplex:"half"});
  await assert.rejects(readBoundedJson(req, {maxBytes:65536}), e => e.status === 413);
  assert.ok(emitted < 12); assert.equal(cancelled, true);
});
test("S2: a small declared length cannot override the observed byte limit", async () => {
  const req = new Request("https://owned.test", {method:"POST",headers:{"content-length":"1"},body:'"' + "a".repeat(100) + '"'});
  await assert.rejects(readBoundedJson(req,{maxBytes:20}),e=>e.status===413);
});
test("S2: exact UTF-8 byte limit accepts valid JSON", async () => {
  const body = JSON.stringify({q:"돌봄"});
  assert.deepEqual(await readBoundedJson(new Request("https://owned.test",{method:"POST",body}),{maxBytes:Buffer.byteLength(body)}),{q:"돌봄"});
});
for (const [label, body, code] of [["empty", "", "EMPTY_BODY"], ["malformed", "{", "INVALID_JSON"], ["utf8", new Uint8Array([0xff]), "INVALID_UTF8"]]) {
  test("S2: " + label + " yields a bounded public error", async () => {
    await assert.rejects(readBoundedJson(new Request("https://owned.test",{method:"POST",body}),{maxBytes:128}),e=>e.code===code);
  });
}
test("S2: timeout covers body delivery, not just headers", async () => {
  let cancelled = false;
  const stream = new ReadableStream({cancel(){cancelled=true;}});
  await assert.rejects(readBoundedBody(new Request("https://owned.test",{method:"POST",body:stream,duplex:"half"}),{maxBytes:128,timeoutMs:20}),e=>e.status===408);
  assert.equal(cancelled,true);
});
test("S2: already-aborted input is rejected without reading", async () => {
  const controller = new AbortController();controller.abort();
  await assert.rejects(readBoundedBody(new Request("https://owned.test",{method:"POST",body:"{}",signal:controller.signal}),{maxBytes:128}),e=>e.code==="REQUEST_ABORTED");
});

for (const [label, input] of [
  ["URL", "https://api.example.invalid/x?serviceKey=AUDIT_SECRET&OC=AUDIT_SECRET"],
  ["JSON", '{"token":"AUDIT_SECRET"}'],
  ["embedded JSON", 'Error: {"nested":{"LAW_OC":"AUDIT_SECRET"}}'],
  ["encoded key", '%74oken=AUDIT_SECRET'],
  ["encoded JSON", '%7B%22authKey%22%3A%22AUDIT_SECRET%22%7D'],
  ["mixed-case key", 'SeRvIcE_KeY=AUDIT_SECRET'],
  ["header", 'Authorization: Bearer AUDIT_SECRET'],
]) test("S3: " + label + " does not leak synthetic credentials", () => assert.doesNotMatch(redactLogText(input), /AUDIT_SECRET/));
test("S3: structured nested objects are masked without mutating source",()=>{
  const input={nested:{refresh_token:"AUDIT_SECRET"},q:"safe"};
  const output=redactCredentialValue(input);
  assert.doesNotMatch(JSON.stringify(output),/AUDIT_SECRET/);assert.equal(input.nested.refresh_token,"AUDIT_SECRET");
});
test("S3: production logger never stores exception message, stack or query",()=>{
  const original=console.error;let line="";console.error=value=>{line=String(value);};
  try { logServerError(new Error("AUDIT_SECRET private question"),{path:"/api/law?q=AUDIT_SECRET",status:500,code:"LAW_FAILED"}); }
  finally {console.error=original;}
  assert.doesNotMatch(line,/AUDIT_SECRET|private question|stack/);assert.equal(JSON.parse(line).path,"/api/law");
});
