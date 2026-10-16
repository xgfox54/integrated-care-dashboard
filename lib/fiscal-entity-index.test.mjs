import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { snapshotSummary, snapshotProjectRows, fiscalCatalog } from "./fiscal/query.ts";

// 지역·기관 조건에 회계연도를 더해 사업 색인부터 읽어도(ENTITY_FIRST_JOINS) 기존 결합과 같은 행·합계가 나와야 한다.
function database() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE fiscal_entity(fiscal_entity_id TEXT PRIMARY KEY, name TEXT, code TEXT, wa_code TEXT, wa_name TEXT);
CREATE TABLE fiscal_project(fiscal_project_id TEXT PRIMARY KEY, fiscal_year TEXT, fiscal_entity_id TEXT, account_code TEXT, account_name TEXT, department_code TEXT, dbiz_code TEXT, name TEXT, field_code TEXT, field_name TEXT, part_code TEXT, part_name TEXT);
CREATE INDEX fiscal_project_year_entity_idx ON fiscal_project (fiscal_year, fiscal_entity_id, department_code);
CREATE TABLE fiscal_observation(observation_id TEXT PRIMARY KEY, fiscal_project_id TEXT, run_id TEXT, reference_date TEXT, source_exe_ymd TEXT, current_budget_krw TEXT, public_expenditure_krw TEXT, national_krw TEXT, province_krw TEXT, municipal_krw TEXT, other_krw TEXT, current_budget_raw TEXT, public_expenditure_raw TEXT, amount_problems TEXT, source_amount_unit TEXT, normalization_rule_id TEXT, contract_version TEXT, unit_verification TEXT);
CREATE TABLE fiscal_unit_check(snapshot_id TEXT PRIMARY KEY, reference_date TEXT, rows_compared INTEGER, field_checks INTEGER, mismatches INTEGER, only_api INTEGER);
CREATE TABLE fiscal_snapshot(snapshot_id TEXT PRIMARY KEY, run_id TEXT, status TEXT, complete INTEGER, requested_reference_date TEXT, unique_count INTEGER);
CREATE TABLE fiscal_snapshot_member(snapshot_id TEXT NOT NULL, fiscal_project_id TEXT NOT NULL, observation_id TEXT NOT NULL, PRIMARY KEY(snapshot_id, fiscal_project_id));
CREATE TABLE fiscal_project_class(fiscal_project_id TEXT, class TEXT, basis TEXT, service_name TEXT);`);
  let n = 0;
  for (const [wa, entities] of [["4100000", ["lofin:laf:4111000", "lofin:laf:4112000"]], ["4900000", ["lofin:laf:4900000"]]]) {
    for (const id of entities) {
      raw.prepare("INSERT INTO fiscal_entity VALUES (?,?,?,?,?)").run(id, "기관" + id.slice(-7), id.slice(-7), wa, "지역" + wa);
      for (const year of ["2025", "2026"]) for (let i = 0; i < 40; i++) {
        const pid = year + ":" + id + ":" + i, oid = "o" + n++;
        raw.prepare("INSERT INTO fiscal_project VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(pid, year, id, i % 7 ? "100" : "200", "회계", String(1105000 + (i % 4) * 10), "D" + i, "사업" + i, i % 3 ? "080" : "090", "분야", "08" + (i % 3), "부문");
        raw.prepare("INSERT INTO fiscal_observation (observation_id, fiscal_project_id, reference_date, current_budget_krw, public_expenditure_krw, amount_problems, source_amount_unit, unit_verification) VALUES (?,?,?,?,?,?,?,?)").run(oid, pid, year + "-10-01", String(1000 + i), String(500 + i), "", "KRW", "verified");
        raw.prepare("INSERT INTO fiscal_snapshot_member VALUES (?,?,?)").run("s" + year + wa, pid, oid);
      }
    }
  }
  const statement = (sql) => {
    const prepared = raw.prepare(sql);
    const run = (binds) => ({ all: async () => ({ results: prepared.all(...binds) }), first: async () => prepared.get(...binds) ?? null, run: async () => prepared.run(...binds) });
    return { bind: (...binds) => run(binds), ...run([]) };
  };
  return { prepare: statement };
}

const snapshots = ["s20264100000", "s20264900000"];
const cases = [
  { waCode: "4100000", fieldCodes: ["080"] },
  { entityId: "lofin:laf:4111000", fieldCodes: ["090"] },
  { entityId: "lofin:laf:4111000", departmentCodes: ["1105010"], accountCodes: ["100"] },
  { adminUnit: { entityId: "lofin:laf:4900000", deptPrefix: "1105,1105020" }, fieldCodes: ["080", "090"] },
  { waCode: "4900000", excludedDepartmentKeys: ["기관4900000|1105000"], partCodes: ["081"] },
  { fieldCodes: ["080"], query: "사업1" },
];

test("entity-first reads return the same rows, totals and catalogs as the snapshot-first join", async () => {
  const db = database();
  for (const filter of cases) {
    const withYear = { ...filter, fiscalYear: "2026" };
    assert.deepEqual(await snapshotSummary(db, snapshots, withYear), await snapshotSummary(db, snapshots, filter), JSON.stringify(filter));
    const ids = (rows) => rows.map((row) => row.fiscal_project_id + "|" + row.current_budget_krw);
    assert.deepEqual(ids(await snapshotProjectRows(db, snapshots, withYear, 0, 20)), ids(await snapshotProjectRows(db, snapshots, filter, 0, 20)));
    for (const type of ["department", "account", "classification"]) assert.deepEqual(await fiscalCatalog(db, snapshots, type, withYear), await fiscalCatalog(db, snapshots, type, filter));
  }
  const summary = await snapshotSummary(db, snapshots, { entityId: "lofin:laf:4111000", fiscalYear: "2026" });
  assert.equal(summary.matching_rows, 40, "2025 snapshot rows are not mixed in");
});
