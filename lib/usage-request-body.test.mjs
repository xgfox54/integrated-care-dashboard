import assert from "node:assert/strict";
import test from "node:test";
import { readUsageBody } from "./usage/request-body.ts";
import { MAX_REQUEST_BYTES } from "./usage/codes.ts";

function request(body, headers = {}) {
  return new Request("https://localhost/api/usage/collect", {
    method: "POST", body, headers, duplex: "half",
  });
}

test("usage body stops an oversized stream before its end, even with a false length", async () => {
  for (const headers of [{}, { "content-length": "1" }]) {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_REQUEST_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel() { cancelled = true; },
    });
    assert.equal(await readUsageBody(request(stream, headers)), null);
    assert.equal(cancelled, true);
  }
});

test("usage body preserves valid UTF-8 and accepts the exact byte limit", async () => {
  assert.equal(await readUsageBody(request('{"text":"통계"}')), '{"text":"통계"}');
  assert.equal((await readUsageBody(request("a".repeat(MAX_REQUEST_BYTES)))).length, MAX_REQUEST_BYTES);
});

test("usage body rejects declared oversize, empty, malformed UTF-8 and aborted input", async () => {
  assert.equal(await readUsageBody(request("{}", { "content-length": String(MAX_REQUEST_BYTES + 1) })), null);
  assert.equal(await readUsageBody(request("")), null);
  assert.equal(await readUsageBody(request(new Uint8Array([0xff]))), null);
  const controller = new AbortController();
  controller.abort();
  const aborted = new Request("https://localhost/api/usage/collect", { method: "POST", body: "{}", signal: controller.signal });
  assert.equal(await readUsageBody(aborted), null);
});
