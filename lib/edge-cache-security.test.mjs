import assert from "node:assert/strict";
import test from "node:test";

import { sharedCacheKey, withSharedCache } from "./edge-cache.ts";

test("shared cache key keeps only canonical allowlisted parameters", () => {
  const first = new Request("https://example.test/api/dataset/search?page=1&sido=%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C");
  const second = new Request("https://example.test/api/dataset/search?sido=%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C&page=1");
  assert.equal(sharedCacheKey(first), sharedCacheKey(second));
  assert.equal(
    sharedCacheKey(first),
    "https://example.test/api/dataset/search?page=1&sido=%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C",
  );
});

test("shared cache bypasses unknown and duplicate parameters before route validation", () => {
  assert.equal(sharedCacheKey(new Request("https://example.test/api/dataset/search?page=1&random=one")), null);
  assert.equal(sharedCacheKey(new Request("https://example.test/api/dataset/search?page=1&page=2")), null);
});

test("shared cache bypasses requests containing free-text search", () => {
  assert.equal(sharedCacheKey(new Request("https://example.test/api/dataset/search?q=%EB%AF%BC%EA%B0%90%ED%95%9C%20%EA%B2%80%EC%83%89%EC%96%B4")), null);
});

test("free-text bypass responses are private even when the route builder used a public header", async () => {
  const request = new Request("https://example.test/api/dataset/search?q=private");
  const response = await withSharedCache(request, async () =>
    Response.json({ ok: true }, { headers: { "cache-control": "public, s-maxage=300" } }),
  );
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-shared-cache"), "bypass");
});
