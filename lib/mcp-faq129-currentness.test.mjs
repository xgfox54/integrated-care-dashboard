import assert from "node:assert/strict";
import test from "node:test";
import { database } from "./press-test-support.mjs";
import { faq129Freshness, getFaq129, searchFaq129 } from "./mcp/faq129.ts";
import { refineWelfareQuery } from "./mcp/query-refiner.ts";
import { faq129Conditions } from "./mcp/faq129-conditions.ts";

test("recent year mention does not independently verify policy criteria", () => {
  // Given / When
  const result = faq129Freshness("2026-09-01", "2026년 기준", Date.parse("2026-10-12"), 2026, { requested_year: 2026 });
  // Then
  assert.equal(result.status, "CURRENT");
  assert.equal(result.source_recency.status, "RECENT");
  assert.equal(result.criteria_verification.status, "NOT_INDEPENDENTLY_VERIFIED");
  assert.equal(result.requested_year_verification.status, "MENTIONED_NOT_VERIFIED");
});

for (const [date, answer, requested, recency, yearStatus] of [
  ["2025-01-01", "안내", 2026, "OLD", "UNCONFIRMED"],
  ["2026-10-13", "2026년 기준", 2026, "FUTURE_DATE", "MENTIONED_NOT_VERIFIED"],
  ["invalid", "2025년 기준", 2026, "UNKNOWN", "CONFLICTING"],
  ["2026-10-01", "2025년과 2026년", 2026, "RECENT", "CONFLICTING"],
  ["2026-10-01", "안내", undefined, "RECENT", "NOT_REQUESTED"],
]) test(`source recency and requested year are independent: ${date}/${yearStatus}`, () => {
  // Given / When
  const result = faq129Freshness(date, answer, Date.parse("2026-10-12"), 2026, { requested_year: requested });
  // Then
  assert.equal(result.source_recency.status, recency);
  assert.equal(result.requested_year_verification.status, yearStatus);
  assert.equal(result.criteria_verification.status, "NOT_INDEPENDENTLY_VERIFIED");
});

for (const id of ["7170", "14238", "13140", "10734", "14013", "6334", "9710", "861"]) {
  test(`reviewed conditions preserve source and structured logic for ${id}`, async () => {
    // Given
    const db = database();
    const original = db.sqlite.prepare("SELECT * FROM faq_129 WHERE faq_id = ?").get(id);
    // When
    const detail = await getFaq129(db, "faq129:" + id);
    // Then
    assert.equal(detail.answer, original.answer);
    assert.equal(detail.content_sha256, original.content_sha256);
    assert.equal(detail.structured_conditions.verification_status, "SOURCE_REVIEWED");
    assert.ok(detail.structured_conditions.rules.length >= 2);
    for (const rule of detail.structured_conditions.rules) {
      assert.ok(detail.condition_checklist[rule.source_block - 1].text.includes(rule.source_quote));
      for (const operand of rule.operands) assert.ok(rule.source_quote.includes(operand));
      if (rule.applies_to) assert.ok(detail.structured_conditions.rules.some((candidate) => candidate.id === rule.applies_to));
    }
  });
}

test("changed source never receives stale reviewed condition logic", async () => {
  // Given
  const db = database();
  db.sqlite.prepare("UPDATE faq_129 SET answer = '새로운 조건', content_sha256 = 'changed' WHERE faq_id = '7170'").run();
  // When
  const detail = await getFaq129(db, "faq129:7170");
  // Then
  assert.equal(detail.structured_conditions.verification_status, "UNREVIEWED");
  assert.deepEqual(detail.structured_conditions.rules, []);
  assert.equal(detail.answer, "새로운 조건");
});

test("search carries the same source reviewed conditions as detail", async () => {
  // Given
  const db = database();
  const original = db.sqlite.prepare("SELECT question FROM faq_129 WHERE faq_id = '7170'").get();
  // When
  const result = await searchFaq129(db, refineWelfareQuery(original.question));
  // Then
  assert.equal(result.hits[0].structured_conditions.verification_status, "SOURCE_REVIEWED");
});

for (const [id, relations] of [
  ["7170", [["normal-tests", "AND", null, 4], ["ivf-age-exception", "EXCEPTION", "ivf-period", 2], ["iui-age-exception", "EXCEPTION", "iui-period", 2]]],
  ["14238", [["certification-options", "OR", "domestic-authority-certification", 2], ["notarization-translation", "OPTIONAL_IF_NEEDED", "domestic-authority-certification", 1]]],
  ["13140", [["hospital-capabilities", "AND", "hospital-definition", 3]]],
  ["10734", [["household-inclusion", "AND", null, 5], ["registration", "OR", "household-inclusion", 2]]],
  ["14013", [["household-inclusion", "AND", null, 5], ["registration", "OR", "household-inclusion", 2]]],
  ["6334", [["selection-exception", "EXCEPTION", "selection-discouraged", 1], ["activity-exception", "EXCEPTION", "activity-priority", 1]]],
  ["9710", [["separate-transport", "AND", null, 4], ["separate-basic-fee", "REQUIRED", "separate-transport", 1]]],
  ["861", [["livelihood-only", "REQUIRED", "repeat-support", 2]]],
]) test(`condition operators and exception scope remain bound for ${id}`, async () => {
  // Given / When
  const detail = await getFaq129(database(), "faq129:" + id);
  // Then
  for (const [ruleId, operator, parent, count] of relations) {
    const rule = detail.structured_conditions.rules.find((item) => item.id === ruleId);
    assert.equal(rule?.operator, operator);
    assert.equal(rule?.applies_to, parent);
    assert.equal(rule?.operands.length, count);
  }
});

test("unreviewed FAQ has no inferred operator tree", async () => {
  // Given / When
  const detail = await getFaq129(database(), "faq129:18484");
  // Then
  assert.equal(detail.structured_conditions.verification_status, "UNREVIEWED");
  assert.deepEqual(detail.structured_conditions.rules, []);
  assert.ok(detail.condition_checklist.length > 1);
});

test("Reviewed constraints preserve branch scope", () => {
  // Given
  const db = database();
  try {
    const rows = db.sqlite.prepare("SELECT * FROM faq_129 WHERE faq_id IN ('7170','14238','13140','10734','14013','6334')").all();
    // When
    const results = rows.map(row => faq129Conditions(row.faq_id, row.content_sha256, row.answer));
    // Then
    for (const result of results) {
      assert.equal(result.verification_status, "SOURCE_REVIEWED");
      assert.ok(result.scope_constraints.length);
      for (const scope of result.scope_constraints) {
        const target = result.rules.find(rule => rule.id === scope.target_rule_id);
        assert.ok(target);
        assert.ok(result.rules.some(rule => rule.id === scope.rule_id));
        assert.equal(scope.source_content_sha256, result.source_content_sha256);
        const original = rows.find(row => row.content_sha256 === scope.source_content_sha256);
        assert.equal(scope.source_quote, original.answer.split(/\r?\n[\t ]*\r?\n+/).filter(text => text.trim())[scope.source_block - 1]);
        if (scope.target_operand) assert.ok(target.operands.includes(scope.target_operand));
      }
    }
    const foreign = results[rows.findIndex(row => row.faq_id === '14238')];
    const certification = foreign.scope_constraints.find(scope => scope.rule_id === 'domestic-authority-certification');
    assert.equal(certification.scope, 'TARGET_OPERAND');
    assert.equal(certification.target_operand, '자국행정기관에서 발급받은');
    for (const id of ['10734', '14013']) {
      const residence = results[rows.findIndex(row => row.faq_id === id)];
      const common = residence.scope_constraints.find(scope => scope.scope === 'COMMON_TO_ALL_ALTERNATIVES');
      assert.equal(common.rule_id, 'household-inclusion');
      assert.equal(common.target_rule_id, 'registration');
      assert.equal(common.common_operands.length, 4);
      assert.ok(!common.common_operands.includes('주민등록'));
    }
  } finally { db.sqlite.close(); }
});

for (const change of ['hash', 'anchor']) test(`Changed source cannot reuse reviewed constraints: ${change}`, () => {
  // Given
  const db = database();
  const source = db.sqlite.prepare("SELECT * FROM faq_129 WHERE faq_id='7170'").get();
  db.sqlite.close();
  // When
  const result = faq129Conditions(source.faq_id, change === 'hash' ? 'changed' : source.content_sha256, change === 'anchor' ? '새로운 조건' : source.answer);
  // Then
  assert.equal(result.verification_status, 'UNREVIEWED');
  assert.deepEqual(result.rules, []);
  assert.deepEqual(result.scope_constraints, []);
  assert.ok(result.warning_markers.some(warning => warning.code === 'CONDITION_REVIEW_STALE'));
});

test('unknown comma and negation remain unreviewed without inferred operators', () => {
  // Given / When
  const result = faq129Conditions('unknown', 'hash', '조건 A, 조건 B가 적용되지 아니한 경우\n\n| 구분 | 기준 |');
  // Then
  assert.deepEqual(result.rules, []);
  assert.deepEqual(result.scope_constraints, []);
  assert.ok(result.warning_markers.some(warning => warning.code === 'CONDITION_LOGIC_UNREVIEWED'));
});
