import assert from "node:assert/strict";
import test from "node:test";

import { resolveFallbackKnowledge } from "./wiki-knowledge.ts";

test("an exact Welfare Talk heading returns its traceable local citation", () => {
  const source = resolveFallbackKnowledge("긴급돌봄 지원사업");
  assert.equal(source.tier, "local");
  assert.equal(source.label, "2차 · 복지톡 DB 인용");
  assert.match(source.sectionId ?? "", /^[0-9a-f]{20}$/);
  assert.match(source.sourceSha256 ?? "", /^[0-9a-f]{64}$/);
  assert.match(source.sourceDatabaseSha256 ?? "", /^[0-9a-f]{64}$/);
  assert.ok((source.startLine ?? 0) > 0);
  assert.ok((source.endLine ?? 0) >= (source.startLine ?? 0));
});

test("unmatched services do not receive a generic or unrelated source", () => {
  const source = resolveFallbackKnowledge("완전히 새로운 지역특화 사업");
  assert.equal(source, null);
});

test("partial keyword overlap does not attach a different Welfare Talk article", () => {
  const source = resolveFallbackKnowledge("긴급돌봄 종사자 교통비 지원");
  assert.equal(source, null);
});
