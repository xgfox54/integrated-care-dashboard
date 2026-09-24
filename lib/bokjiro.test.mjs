import assert from "node:assert/strict";
import test from "node:test";

import { findBundledBokjiroExplanation } from "./bokjiro.ts";

test("bundled Bokjiro records preserve the primary source when live lookup is unavailable", () => {
  const source = findBundledBokjiroExplanation("노인맞춤돌봄서비스");
  assert.equal(source?.tier, "bokjiro");
  assert.equal(source?.label, "1차 · 복지로 인용");
  assert.match(source?.url ?? "", /^https:\/\/www\.bokjiro\.go\.kr\//);
});

test("bundled Bokjiro records do not claim a municipal variant as the national service", () => {
  const source = findBundledBokjiroExplanation("노인맞춤돌봄서비스 종사자 교통비 지원");
  assert.equal(source, null);
});
