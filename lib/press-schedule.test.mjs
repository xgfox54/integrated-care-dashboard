import assert from "node:assert/strict";
import test from "node:test";

import { nextCollectionSlot } from "./press/schedule.ts";

const kst = (day, hour, minute = 0) => Date.UTC(2026, 9, day, hour - 9, minute) / 1000;

test("정기 수집 시각은 한국시간 09·12·15·18시이며, 같은 시각이면 다음 시각으로 넘어간다", () => {
  assert.equal(nextCollectionSlot(kst(4, 7, 30)), kst(4, 9));
  assert.equal(nextCollectionSlot(kst(4, 9)), kst(4, 12));
  assert.equal(nextCollectionSlot(kst(4, 9, 1)), kst(4, 12));
  assert.equal(nextCollectionSlot(kst(4, 13)), kst(4, 15));
  assert.equal(nextCollectionSlot(kst(4, 17, 59)), kst(4, 18));
});

test("18시 이후와 자정 직후는 다음 09시로 잡는다", () => {
  assert.equal(nextCollectionSlot(kst(4, 18)), kst(5, 9));
  assert.equal(nextCollectionSlot(kst(4, 23, 59)), kst(5, 9));
  assert.equal(nextCollectionSlot(kst(5, 0, 0)), kst(5, 9));
  assert.equal(nextCollectionSlot(kst(31, 20)), Date.UTC(2026, 10, 1, 0) / 1000);
});
