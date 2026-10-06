import assert from "node:assert/strict";
import test from "node:test";

import { reconcileFunding } from "./fiscal/amount.ts";

test("재원 칸 합계가 예산현액과 같을 때만 재원 구성이 완전하고, 차이는 어느 재원에도 배분하지 않는다(T92)", () => {
  assert.deepEqual(reconcileFunding("310000000", { national: "155000000", province: "155000000", municipal: "0", other: "0" }), {
    funding_sum_krw: "310000000", unallocated_difference_krw: "0", funding_breakdown_complete: true, reconciliation: "SUM_MATCHES_CURRENT_BUDGET",
  });
  const short = reconcileFunding("1000", { national: "400", province: "300", municipal: "200", other: "0" });
  assert.equal(short.funding_breakdown_complete, false);
  assert.equal(short.unallocated_difference_krw, "100", "모자란 100원은 미배분으로 남긴다");
  assert.equal(short.reconciliation, "SUM_DIFFERS_NOT_ALLOCATED");
  assert.equal(reconcileFunding("1000", { national: "600", province: "500", municipal: "0", other: "0" }).unallocated_difference_krw, "-100", "넘치는 경우도 음수 그대로");
  const missing = reconcileFunding("1000", { national: "1000", province: null, municipal: "0", other: "0" });
  assert.equal(missing.funding_breakdown_complete, false);
  assert.equal(missing.funding_sum_krw, null, "칸이 없으면 0으로 채우지 않는다");
  assert.equal(reconcileFunding(null, { national: "1", province: "0", municipal: "0", other: "0" }).reconciliation, "SOURCE_FIELD_MISSING");
  const big = reconcileFunding("90071992547409930000", { national: "90071992547409920000", province: "10000", municipal: "0", other: "0" });
  assert.equal(big.funding_breakdown_complete, true, "큰 정수도 정확히 더한다");
});
