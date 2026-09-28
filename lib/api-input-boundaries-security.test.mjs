import assert from "node:assert/strict";
import test from "node:test";

import { parseBundleRequest } from "./dataset-bundle-request.ts";
import { parseGovSearchRequest } from "./gov-search-request.ts";
import { createWikiHandler } from "./wiki-handler.ts";

test("bundle requests reject duplicate, unknown, ignored, and non-allowlisted values", () => {
  const valid = parseBundleRequest(new URLSearchParams(
    "scope=sigungu&part=0&per=20&size=30&category=" + encodeURIComponent("보건의료"),
  ));
  assert.deepEqual(valid, {
    scope: "sigungu",
    part: 0,
    per: 20,
    pageSize: 30,
    category: "보건의료",
  });

  for (const query of [
    "scope=sido&scope=sigungu",
    "scope=sido&unknown=value",
    "scope=sido&part=0",
    "scope=sido&size=31",
    "scope=sigungu&part=0&per=21",
    "scope=sido&category=unknown",
  ]) {
    assert.equal(parseBundleRequest(new URLSearchParams(query)), null, query);
  }
});

test("government search accepts one bounded q value only", () => {
  assert.deepEqual(parseGovSearchRequest(new URLSearchParams("q=%20돌봄%20")), {
    success: true,
    keyword: "돌봄",
  });
  for (const query of [
    "",
    "q=",
    "q=돌봄&q=의료",
    "q=돌봄&unknown=value",
    `q=${"가".repeat(81)}`,
  ]) {
    assert.equal(parseGovSearchRequest(new URLSearchParams(query)).success, false, query);
  }
});

test("wiki requests reject duplicate, unknown, oversized, and invalid region parameters", async () => {
  let primaryCalls = 0;
  const handler = createWikiHandler({
    findPrimary: async () => {
      primaryCalls += 1;
      return null;
    },
    logPrimaryFailure: () => undefined,
  });
  const invalidQueries = [
    "name=사업&name=다른사업",
    "name=사업&unknown=value",
    `name=${"가".repeat(121)}`,
    "name=사업&sido=허용되지않는지역",
    "name=사업&sigungu=종로구",
  ];
  for (const query of invalidQueries) {
    const response = await handler(new Request(`https://example.test/api/wiki?${query}`));
    assert.equal(response.status, 400, query);
  }
  assert.equal(primaryCalls, 0);
});
