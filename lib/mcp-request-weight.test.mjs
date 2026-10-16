import test from "node:test";
import assert from "node:assert/strict";
import { mcpToolCallWeight } from "./api-rate-limit.ts";

test("MCP accounting preserves batch counts and the original request", async () => {
  const messages = [{ method: "initialize" }, { method: "tools/call" }, { method: "tools/call" }];
  const request = new Request("https://example.test/chatgpt/mcp", { method: "POST", body: JSON.stringify(messages) });
  assert.equal(await mcpToolCallWeight(request), 2);
  assert.deepEqual(await request.json(), messages);
});

test("MCP accounting stops reading oversized streamed input without a declared length", async () => {
  let reads = 0;
  const stream = new ReadableStream({ pull(controller) {
    reads += 1;
    if (reads > 100) controller.close();
    else controller.enqueue(new Uint8Array(128 * 1024).fill(32));
  } }, { highWaterMark: 0 });
  const request = new Request("https://example.test/chatgpt/mcp", { method: "POST", body: stream, duplex: "half" });
  assert.equal(await mcpToolCallWeight(request), 1);
  assert.ok(reads < 10, `read ${reads} chunks`);
  await request.body.cancel();
});
