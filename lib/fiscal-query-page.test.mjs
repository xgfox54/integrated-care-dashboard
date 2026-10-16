import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { database } from "./press-test-support.mjs";
import { snapshotProjects, snapshotProjectRows, snapshotSummary, snapshotRegionSummary } from "./fiscal/query.ts";
import { unitVerificationSql } from "./fiscal/unit-check.ts";

// The pre-optimization query is retained as an independent result/plan oracle.
const columns = [
  "p.fiscal_project_id", "p.fiscal_year", "p.fiscal_entity_id", "e.name AS entity_name", "e.wa_code", "e.wa_name",
  "p.account_code", "p.account_name", "p.department_code", "p.dbiz_code", "p.name", "p.field_code", "p.field_name", "p.part_code", "p.part_name",
  "o.observation_id", "o.reference_date", "o.source_exe_ymd", "o.current_budget_krw", "o.public_expenditure_krw", "o.national_krw", "o.province_krw",
  "o.municipal_krw", "o.other_krw", "o.current_budget_raw", "o.public_expenditure_raw", "o.amount_problems", "o.source_amount_unit",
  unitVerificationSql("o") + " AS unit_verification", "o.normalization_rule_id", "o.contract_version",
  "(SELECT c.basis || '|' || COALESCE(c.service_name, '') FROM fiscal_project_class c WHERE c.fiscal_project_id = p.fiscal_project_id AND c.class = 'integrated_care') AS integrated_care_match",
].join(", ");
const joins = "FROM fiscal_snapshot_member m JOIN fiscal_project p ON p.fiscal_project_id = m.fiscal_project_id JOIN fiscal_observation o ON o.observation_id = m.observation_id JOIN fiscal_entity e ON e.fiscal_entity_id = p.fiscal_entity_id";
const ordering = " ORDER BY e.wa_code, p.fiscal_entity_id, p.department_code, p.dbiz_code LIMIT ? OFFSET ?";
const care = "p.fiscal_project_id IN (SELECT fiscal_project_id FROM fiscal_project_class WHERE class = 'integrated_care')";

function adapter(sqlite, captured = []) {
  const statement = (sql, values = []) => ({
    bind: (...next) => statement(sql, next),
    async first() { captured.push({ sql, values }); return sqlite.prepare(sql).get(...values) ?? null; },
    async all() { captured.push({ sql, values }); return { results: sqlite.prepare(sql).all(...values) }; },
  });
  return { prepare: (sql) => statement(sql) };
}

function seed() {
  const { sqlite } = database();
  sqlite.exec("BEGIN");
  const entity = sqlite.prepare("INSERT INTO fiscal_entity VALUES (?, 'LOFIN', ?, ?, ?, ?, '', 0, 0)");
  entity.run("e1", "1", "Entity 1", "1100000", "Region 1");
  entity.run("e2", "2", "Entity 2", "4900000", "Region 2");
  const project = sqlite.prepare("INSERT INTO fiscal_project VALUES (?, '2026', ?, ?, 'Account', ?, ?, ?, ?, 'Field', '082', 'Part', 0, 0)");
  const observation = sqlite.prepare("INSERT INTO fiscal_observation (observation_id, fiscal_project_id, run_id, reference_date, source_exe_ymd, current_budget_raw, current_budget_krw, public_expenditure_raw, public_expenditure_krw, amount_problems, source_amount_unit, unit_verification, normalization_rule_id, contract_version, created_at) VALUES (?, ?, ?, '2026-10-04', '20261003', ?, ?, ?, ?, '[]', 'KRW', 'UNVERIFIED_IN_SCOPE', 'rule', 'contract', 0)");
  const member = sqlite.prepare("INSERT INTO fiscal_snapshot_member VALUES (?, ?, ?)");
  const classified = sqlite.prepare("INSERT INTO fiscal_project_class VALUES (?, 'integrated_care', 'name_keyword', NULL, 'Service', 'v1', 0)");
  for (let i = 0; i < 12040; i++) {
    const id = "p" + String(i).padStart(6, "0");
    project.run(id, i % 3 ? "e1" : "e2", i % 5 ? "100" : "200", i % 2 ? "3005010" : "4005010", String(12040 - i).padStart(6, "0"), i % 7 ? "Project " + i : "Literal%_token " + i, i % 4 ? "080" : "090");
    const budget = i % 13 ? String(1000 + i) : null;
    const expenditure = i % 17 ? String(i) : null;
    observation.run("o" + i, id, "run1", budget, budget, expenditure, expenditure);
    member.run("s1", id, "o" + i);
    if (i % 19 === 0) classified.run(id);
    if (i < 8) {
      observation.run("other" + i, id, "run2", "9007199254740993", "9007199254740993", "8", "8");
      member.run("s2", id, "other" + i);
    }
  }
  // No FK is declared: the optimized page must retain the old inner-join exclusions.
  member.run("s1", "absent-project", "o1");
  member.run("s2", "p000010", "absent-observation");
  project.run("orphan-entity", "absent-entity", "100", "3005010", "000000", "Orphan", "080");
  observation.run("orphan", "orphan-entity", "run1", "1", "1", "1", "1");
  member.run("s1", "orphan-entity", "orphan");
  sqlite.exec("COMMIT");
  return sqlite;
}

function legacy(sqlite, ids, clause, filterValues, offset, limit) {
  const where = "m.snapshot_id IN (" + ids.map(() => "?").join(",") + ")" + (clause ? " AND " + clause : "");
  const values = [...ids, ...filterValues];
  return {
    total: sqlite.prepare("SELECT COUNT(*) AS total " + joins + " WHERE " + where).get(...values).total,
    rows: sqlite.prepare("SELECT " + columns + " " + joins + " WHERE " + where + ordering).all(...values, limit, offset),
    sql: "SELECT " + columns + " " + joins + " WHERE " + where + ordering,
    values: [...values, limit, offset],
  };
}

const evidenceDir = process.env.BUDGET_QUERY_EVIDENCE;
function record(name, value) {
  if (!evidenceDir) return;
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(path.join(evidenceDir, name), JSON.stringify(value, null, 2));
}

test("page materialization preserves every returned column, counts, overlap grain and all filters", async () => {
  const sqlite = seed(), db = adapter(sqlite);
  try {
    const beforeSummary = await snapshotSummary(db, ["s1", "s2"], {});
    const beforeRegions = await snapshotRegionSummary(db, ["s1", "s2"], {});
    const cases = [
      ["first", {}, "", [], 0], ["page501", {}, "", [], 10000], ["empty-last", {}, "", [], 20000],
      ["region", { waCode: "4900000" }, "e.wa_code = ?", ["4900000"], 20],
      ["entity", { entityId: "e1" }, "p.fiscal_entity_id = ?", ["e1"], 0],
      ["department", { departmentCodes: ["4005010"] }, "p.department_code IN (?)", ["4005010"], 20],
      ["excluded-entity-code", { excludedDepartmentKeys: ["Entity 1|4005010"] }, "(e.name || '|' || p.department_code) NOT IN (SELECT value FROM json_each(?))", [JSON.stringify(["Entity 1|4005010"])], 20],
      ["account", { accountCodes: ["200"] }, "p.account_code IN (?)", ["200"], 0],
      ["field", { fieldCodes: ["080"] }, "p.field_code IN (?)", ["080"], 0],
      ["care-only", { integratedCare: "only" }, care, [], 0],
      ["care-include", { fieldCodes: ["080"], integratedCare: "include" }, "(p.field_code IN (?) OR " + care + ")", ["080"], 100],
      ["admin", { adminUnit: { entityId: "e2", deptPrefix: "3005,4005" } }, "p.fiscal_entity_id = ? AND (substr(p.department_code,1,4) = ? OR substr(p.department_code,1,4) = ?)", ["e2", "3005", "4005"], 0],
      ["ids", { projectIds: ["p000000", "p000001"] }, "p.fiscal_project_id IN (?,?)", ["p000000", "p000001"], 0],
      ["escaped-search", { query: "Literal%_token" }, "p.name LIKE ? ESCAPE '\\'", ["%Literal\\%\\_token%"], 0],
    ];
    const results = [];
    for (const [name, filter, clause, values, offset] of cases) {
      const expected = legacy(sqlite, ["s1", "s2"], clause, values, offset, 20);
      const actual = await snapshotProjects(db, ["s1", "s2"], filter, offset, 20);
      assert.equal(actual.total, expected.total, name);
      assert.deepEqual(actual.rows, expected.rows, name);
      const rowQueries = [];
      assert.deepEqual(await snapshotProjectRows(adapter(sqlite, rowQueries), ["s1", "s2"], filter, offset, 20), expected.rows, name + " rows-only");
      assert.equal(rowQueries.length, 1, name + " rows-only performs one statement");
      assert.ok(!rowQueries[0].sql.includes("COUNT("), name + " rows-only never counts");
      assert.equal((await snapshotSummary(db, ["s1", "s2"], filter)).matching_rows, actual.total, name + " summary count is reusable");
      results.push({ scenario: name, total: actual.total, rows: actual.rows.length, exact_columns_equal: true, rows_only_statements: rowQueries.length, summary_count_equal: true });
    }
    const pinned = await snapshotProjects(db, "s2", {}, 0, 20);
    assert.equal(pinned.total, 8);
    assert.ok(pinned.rows.every((r) => r.observation_id.startsWith("other")));
    assert.deepEqual(await snapshotProjects(db, [], {}, 0, 20), { rows: [], total: 0 });
    assert.deepEqual(await snapshotSummary(db, ["s1", "s2"], {}), beforeSummary);
    assert.deepEqual(await snapshotRegionSummary(db, ["s1", "s2"], {}), beforeRegions);
    record("equivalence.json", { pass: true, scenarios: results, pinned_observations: 8, sums_and_regions_unchanged: true });
  } finally { sqlite.close(); }
});

async function profile(sqlite, ids, name) {
  const scenarios = [];
  for (const offset of [0, 10000]) {
    const old = legacy(sqlite, ids, "", [], offset, 20), captured = [];
    const actual = await snapshotProjects(adapter(sqlite, captured), ids, {}, offset, 20);
    assert.deepEqual(actual.rows, old.rows); assert.equal(actual.total, old.total);
    const current = captured.find((q) => q.sql.startsWith("WITH page"));
    assert.ok(current);
    const plan = (q) => sqlite.prepare("EXPLAIN QUERY PLAN " + q.sql).all(...q.values);
    const bytecode = (q) => sqlite.prepare("EXPLAIN " + q.sql).all(...q.values);
    let calls = 0;
    sqlite.function("count_detail", (value) => { calls++; return value; });
    const counted = (q) => {
      calls = 0;
      sqlite.prepare(q.sql.replaceAll(unitVerificationSql("o"), "count_detail(" + unitVerificationSql("o") + ")")).all(...q.values);
      return calls;
    };
    const oldCalls = counted(old), newCalls = counted(current);
    assert.ok(newCalls <= 20);
    if (old.total > 10000 && offset === 10000) assert.ok(oldCalls > newCalls);
    const timed = (q) => { const start = performance.now(); sqlite.prepare(q.sql).all(...q.values); return performance.now() - start; };
    const times = [];
    for (let i = 0; i < 5; i++) {
      if (i % 2) { const next = timed(current); times.push({ previous_ms: timed(old), current_ms: next }); }
      else { const previous = timed(old); times.push({ previous_ms: previous, current_ms: timed(current) }); }
    }
    scenarios.push({ offset, total: actual.total, rows_equal: true, count_equal: true, previous_detail_calls: oldCalls, current_detail_calls: newCalls, times, previous_sql: old, current_sql: current, previous_plan: plan(old), current_plan: plan(current), previous_bytecode: bytecode(old), current_bytecode: bytecode(current) });
  }
  // Exclude result rows from the evidence log; only plans, SQL, metrics and binary equality are recorded.
  for (const scenario of scenarios) delete scenario.previous_sql.rows;
  record(name + ".json", { sqlite_version: sqlite.prepare("SELECT sqlite_version() AS v").get().v, result: "PASS", scenarios });
  console.log(JSON.stringify({ profile: name, scenarios: scenarios.map(({ offset, total, previous_detail_calls, current_detail_calls, times }) => ({ offset, total, previous_detail_calls, current_detail_calls, times })) }));
}

test("EXPLAIN and executed detail counters prove only the selected page is hydrated", async () => {
  const sqlite = seed();
  try { await profile(sqlite, ["s1", "s2"], "synthetic-plan"); } finally { sqlite.close(); }
});

if (process.env.BUDGET_QUERY_LOCAL_DB) test("read-only local real snapshots preserve rows with recorded query plans", async () => {
  const sqlite = new DatabaseSync(process.env.BUDGET_QUERY_LOCAL_DB, { readOnly: true });
  try {
    const ids = sqlite.prepare("SELECT snapshot_id FROM fiscal_snapshot WHERE status = 'PUBLISHED' ORDER BY requested_reference_date DESC LIMIT 1").all().map((r) => r.snapshot_id);
    assert.ok(ids.length);
    await profile(sqlite, ids, "local-real-plan");
  } finally { sqlite.close(); }
});
