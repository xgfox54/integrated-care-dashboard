import assert from "node:assert/strict";
import test from "node:test";

import { createWikiHandler } from "./wiki-handler.ts";

const PRIMARY_SOURCE = {
  tier: "bokjiro",
  label: "1차 · 복지로 인용",
  title: "테스트 공식 서비스",
  summary: "복지로 공식 설명",
  publisher: "복지로",
  url: "https://www.bokjiro.go.kr/example",
  matchedTerm: "테스트 공식 서비스",
};

test("wiki route returns a live Bokjiro explanation before every fallback", async () => {
  const handler = createWikiHandler({
    findPrimary: async () => PRIMARY_SOURCE,
    logPrimaryFailure: () => {},
  });

  const response = await handler(new Request("https://example.test/api/wiki?name=테스트%20공식%20서비스"));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.source.tier, "bokjiro");
  assert.equal(payload.source.title, "테스트 공식 서비스");
});

test("wiki route uses the generated Welfare Talk snapshot after Bokjiro misses", async () => {
  const handler = createWikiHandler({
    findPrimary: async () => null,
    logPrimaryFailure: () => {},
  });

  const response = await handler(new Request("https://example.test/api/wiki?name=다제약물관리사업"));
  const payload = await response.json();

  assert.equal(payload.source.tier, "local");
  assert.match(payload.source.sectionId, /^[0-9a-f]{20}$/);
});

test("wiki route returns no supplemental source when an exact match is unavailable", async () => {
  const handler = createWikiHandler({
    findPrimary: async () => null,
    logPrimaryFailure: () => {},
  });

  const response = await handler(new Request("https://example.test/api/wiki?name=완전히%20새로운%20지역특화%20사업"));
  const payload = await response.json();

  assert.equal(payload.source, null);
});

test("wiki route records a Bokjiro failure and continues the source chain", async () => {
  const failures = [];
  const handler = createWikiHandler({
    findPrimary: async () => {
      throw new Error("upstream unavailable");
    },
    logPrimaryFailure: (message) => failures.push(message),
  });

  const response = await handler(new Request("https://example.test/api/wiki?name=다제약물관리사업"));
  const payload = await response.json();

  assert.equal(payload.source.tier, "local");
  assert.equal(failures.length, 1);
});
