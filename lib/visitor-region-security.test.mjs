import assert from "node:assert/strict";
import test from "node:test";

import { resolveVisitorSido } from "./visitor-region.ts";

test("visitor region uses only trusted edge metadata and never calls GeoIP providers", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("GeoIP lookup must not run");
  };

  try {
    assert.deepEqual(await resolveVisitorSido({ country: "KR", regionCode: "26" }), {
      sido: "부산광역시",
      source: "edge",
    });
    assert.deepEqual(await resolveVisitorSido(undefined), { sido: null, source: "none" });
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("visitor region rejects foreign and user-controlled header-only locations", async () => {
  assert.deepEqual(await resolveVisitorSido({ country: "US", regionCode: "26" }), {
    sido: null,
    source: "none",
  });
});
