import assert from "node:assert/strict";
import test from "node:test";

import { apiRatePolicy, enforceApiRateLimit, rateLimitFingerprint } from "./api-rate-limit.ts";

test("download limits are stricter than search and geo limits", () => {
  const download = apiRatePolicy("/api/dataset/export");
  const search = apiRatePolicy("/api/dataset/search");
  const geo = apiRatePolicy("/api/geo");
  assert.ok(download);
  assert.ok(search);
  assert.ok(geo);
  assert.ok(download.limit < search.limit);
  assert.ok(download.limit < geo.limit);
  assert.equal(apiRatePolicy("/assets/app.js"), null);
});

test("rate-limit identity is a digest and never contains raw network or session values", async () => {
  const request = new Request("https://example.test/api/dataset/search", {
    headers: {
      "cf-connecting-ip": "203.0.113.42",
      cookie: "session=private-value",
      "user-agent": "test-browser",
    },
  });
  const fingerprint = await rateLimitFingerprint(request);
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(fingerprint, /203\.0\.113\.42|private-value|test-browser/);
});

test("download requests are atomically rejected after the policy limit", async () => {
  const counts = new Map();
  const keys = [];
  const db = {
    prepare() {
      return {
        bind(bucketKey) {
          keys.push(bucketKey);
          return {
            async first() {
              const count = (counts.get(bucketKey) ?? 0) + 1;
              counts.set(bucketKey, count);
              return { request_count: count };
            },
          };
        },
      };
    },
  };
  const request = new Request("https://example.test/api/dataset/export", {
    headers: { "cf-connecting-ip": "203.0.113.42", cookie: "session=private-value" },
  });

  for (let count = 0; count < 10; count += 1) {
    assert.equal(await enforceApiRateLimit(request, db, 60), null);
  }
  const rejected = await enforceApiRateLimit(request, db, 60);
  assert.equal(rejected.status, 429);
  assert.equal(rejected.headers.get("retry-after"), "60");
  assert.doesNotMatch(keys[0], /203\.0\.113\.42|private-value/);
});
