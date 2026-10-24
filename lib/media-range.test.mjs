import assert from "node:assert/strict";
import test from "node:test";

import { parseByteRange, serveRangedAsset } from "./media-range.ts";

test("byte ranges follow RFC 9110 forms used by video players", () => {
  assert.equal(parseByteRange(null, 100), null);
  assert.deepEqual(parseByteRange("bytes=0-1", 100), { start: 0, end: 1 });
  assert.deepEqual(parseByteRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange("bytes=50-500", 100), { start: 50, end: 99 });
  assert.equal(parseByteRange("bytes=100-", 100), "unsatisfiable");
  assert.equal(parseByteRange("bytes=5-2", 100), "unsatisfiable");
  assert.equal(parseByteRange("items=0-1", 100), null);
});

test("ranged asset responses return partial content with exact bytes", async () => {
  const bytes = new Uint8Array(Array.from({ length: 100 }, (_, index) => index));
  const assets = { fetch: async () => new Response(bytes, { headers: { etag: "\"v1\"" } }) };
  const partial = await serveRangedAsset(new Request("https://site.test/video/a.mp4", { headers: { range: "bytes=10-19" } }), assets, "/media/a.mp4", "video/mp4");
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), "bytes 10-19/100");
  assert.equal(partial.headers.get("accept-ranges"), "bytes");
  assert.deepEqual([...new Uint8Array(await partial.arrayBuffer())], Array.from({ length: 10 }, (_, index) => index + 10));
  const full = await serveRangedAsset(new Request("https://site.test/video/a.mp4"), assets, "/media/a.mp4", "video/mp4");
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-length"), "100");
  const outside = await serveRangedAsset(new Request("https://site.test/video/a.mp4", { headers: { range: "bytes=200-" } }), assets, "/media/a.mp4", "video/mp4");
  assert.equal(outside.status, 416);
});

