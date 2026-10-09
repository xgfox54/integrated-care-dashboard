import assert from "node:assert/strict";
import test from "node:test";
import { pressPeriodQuery, selectPressPeriod } from "./press-period.ts";

const NOW = Date.parse("2026-10-07T02:00:00Z");
const CUSTOM = { period: "custom", from: "2026-08-01", to: "2026-08-31" };

for (const [period, from] of [["today", "2026-10-07"], ["7", "2026-10-01"], ["30", "2026-09-08"], ["90", "2026-07-10"]]) {
  test(`preset ${period} includes today and synchronizes both query bounds`, () => {
    // Given an old custom range, When selecting a preset, Then UI and query have the same inclusive bounds.
    const range = selectPressPeriod(period, CUSTOM, NOW);
    assert.deepEqual(range, { period, from, to: "2026-10-07" });
    assert.deepEqual(Object.fromEntries(pressPeriodQuery(range)), { from, to: "2026-10-07" });
  });
}

test("preset uses the Korean date across UTC midnight boundaries", () => {
  // Given UTC is still October 6, When selecting today, Then both bounds are October 7 in Korea.
  const range = selectPressPeriod("today", CUSTOM, Date.parse("2026-10-06T15:00:00Z"));
  assert.deepEqual(range, { period: "today", from: "2026-10-07", to: "2026-10-07" });
});

test("seven-day preset crosses leap-day and year boundaries correctly", () => {
  // Given calendar boundaries, When selecting seven days, Then exactly seven calendar dates are covered.
  assert.equal(selectPressPeriod("7", CUSTOM, Date.parse("2024-03-02T00:00:00Z")).from, "2024-02-25");
  assert.equal(selectPressPeriod("7", CUSTOM, Date.parse("2026-01-02T00:00:00Z")).from, "2025-12-27");
});

test("all periods clears previous dates and sends no date constraint", () => {
  const range = selectPressPeriod("", CUSTOM, NOW);
  assert.deepEqual(range, { period: "", from: "", to: "" });
  assert.equal(pressPeriodQuery(range).toString(), "");
});

test("unknown date selection clears bounds and requests only undated news", () => {
  const range = selectPressPeriod("unknown", CUSTOM, NOW);
  assert.deepEqual(range, { period: "unknown", from: "", to: "" });
  assert.equal(pressPeriodQuery(range).toString(), "date_unknown=1");
});

test("custom selection preserves the displayed preset bounds", () => {
  const current = { period: "7", from: "2026-10-01", to: "2026-10-07" };
  assert.deepEqual(selectPressPeriod("custom", current, NOW), { ...current, period: "custom" });
});

test("one-sided custom date sends only the filled bound", () => {
  const range = { period: "custom", from: "", to: "2026-10-02" };
  assert.deepEqual(Object.fromEntries(pressPeriodQuery(range)), { to: "2026-10-02" });
});
