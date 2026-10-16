import assert from "node:assert/strict";
import test from "node:test";
import { CASES, evaluateCase, summarize } from "./evaluate-balanced-search.mjs";

const result = (data) => ({ result: { structuredContent: { data } } });
test("all ten public search functions have equal evaluation weight", () => {
  const counts = new Map();
  for (const item of CASES) counts.set(item.tool, (counts.get(item.tool) ?? 0) + 1);
  assert.equal(counts.size, 10);
  assert.deepEqual([...counts.values()], Array(10).fill(5));
  assert.equal(summarize([]).gate_passed, false);
  assert.equal(summarize(CASES.slice(0, -1).map((item) => ({ ...item, pass: true }))).gate_passed, false);
});

test('duplicated or mislabeled observations cannot pass the balanced completeness gate', () => {
  const duplicate = CASES.map(item => ({ id: CASES.find(other => other.tool === item.tool).id, tool: item.tool, pass: true }));
  assert.equal(summarize(duplicate).gate_passed, false);
  assert.equal(summarize(CASES.map(item => ({ ...item, tool: 'search', pass: true }))).gate_passed, false);
});
test("unknown fiscal properties cannot masquerade as safely withheld amounts", () => {
  const item = CASES.find((row) => row.expect.safeAmounts);
  const payload = (extra) => result({ items: [{ name: "통합돌봄", ...extra }] });
  assert.equal(evaluateCase(item, payload({})).pass, false);
  assert.equal(evaluateCase(item, payload({ amount_status: "NOT_VERIFIED", current_budget_krw: "100", public_expenditure_krw: null })).pass, false);
  assert.equal(evaluateCase(item, payload({ amount_status: "NOT_VERIFIED", current_budget_krw: null, public_expenditure_krw: null })).pass, true);
});
test("tool errors and missing observations do not pass negative search cases", () => {
  const item = CASES.find((row) => row.expect.empty);
  assert.equal(evaluateCase(item, { error: { code: "DATA_SOURCE_BUSY" } }).pass, false);
  assert.equal(evaluateCase(item, undefined).pass, false);
  assert.equal(evaluateCase(item, result({})).pass, false);
  assert.equal(evaluateCase(item, result({ items: [] })).pass, true);
});
test("source unavailability does not treat a server failure as a correct answer", () => {
  const item = CASES.find((row) => row.expect.unavailable);
  assert.equal(evaluateCase(item, { error: { code: "INTERNAL_ERROR" } }).pass, false);
  assert.equal(evaluateCase(item, result({ status: "UNAVAILABLE", reason_code: "NO_PUBLISHED_SNAPSHOT", items: [] })).pass, true);
});
