import assert from "node:assert/strict";
import test from "node:test";
import { restorationFixture } from "./business-data-test-support.mjs";
import { correctFromRepositoryBaseline } from "./official-correction.ts";
import { readRepositoryBaseline } from "./repository-baseline.ts";

test("baseline return preserves exact 30 verified IDs and dates plus current edited semantic fields", () => {
  const rows = restorationFixture.map(({ live }) => ({ ...live, description: "사람이 편집한 설명", provider: "편집 제공기관", target: "편집 대상" }));
  const corrected = correctFromRepositoryBaseline(rows, readRepositoryBaseline());
  for (const [i, row] of corrected.entries()) {
    assert.equal(row.serviceId, rows[i].serviceId);
    assert.equal(row.subcategory, restorationFixture[i].expected.subcategory, row.serviceId);
    assert.equal(row.type, restorationFixture[i].expected.type, row.serviceId);
    for (const field of ["description", "provider", "target"]) assert.equal(row[field], rows[i][field]);
  }
});

test("baseline post-restoration does not change IDs outside the map or a later revision", () => {
  const live = restorationFixture.find(({ live }) => live.serviceId === "0085:1489596:1:2:2").live;
  for (const row of [{ ...live, serviceId: "other" }, { ...live, updatedDate: "2026-04" }]) {
    assert.deepEqual(correctFromRepositoryBaseline([row], []), [row]);
  }
});
