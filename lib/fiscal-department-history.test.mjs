// 부서코드 연도별 관측 이력·이관(작업지시서 v5 T94): 공개 snapshot에 나타난 값만, 이웃 연도의 같은 회계·세부사업코드 사업이 부서코드를 바꾸면 이관으로 센다.
import assert from "node:assert/strict";
import test from "node:test";

import { departmentHistory } from "./fiscal/department-history.ts";
import { database } from "./press-test-support.mjs";

const NOW = 1_791_300_000;

function seed(db, projects) {
  const run = (sql, ...values) => db.sqlite.prepare(sql).run(...values);
  run("INSERT OR IGNORE INTO fiscal_scope (scope_id, label, mode, definition, access_requirement, classification_basis, approval_status) VALUES ('t-all', '시험 전체', 'all_fields', '{}', 'key', '시험', 'APPROVED')");
  run("INSERT INTO fiscal_entity (fiscal_entity_id, code_system, code, name, wa_code, wa_name, first_seen_at, last_seen_at) VALUES ('lofin:laf:9999000', 'LOFIN_LAF', '9999000', '시험시', '9900000', '시험', ?, ?)", NOW, NOW);
  for (const [year, status] of [["2024", "PUBLISHED"], ["2025", "PUBLISHED"], ["2026", "PUBLISHED"], ["2027", "PENDING_REVIEW"]]) {
    run("INSERT INTO fiscal_snapshot (snapshot_id, scope_id, run_id, fiscal_year, requested_reference_date, access_tier, expected_count, unique_count, complete, status, created_at, published_at) VALUES (?, 't-all', 'r', ?, ?, 'key', 1, 1, 1, ?, ?, ?)",
      "fs:" + year, year, year + "-10-01", status, NOW, status === "PUBLISHED" ? NOW : null);
  }
  for (const [year, dept, dbiz, name] of projects) {
    const id = "fp:" + year + ":9999000:100:" + dept + ":" + dbiz;
    run("INSERT INTO fiscal_project (fiscal_project_id, fiscal_year, fiscal_entity_id, account_code, account_name, department_code, dbiz_code, name, field_code, field_name, part_code, part_name, first_seen_at, last_seen_at) VALUES (?, ?, 'lofin:laf:9999000', '100', '일반회계', ?, ?, ?, '080', '사회복지', '082', '노인', ?, ?)", id, year, dept, dbiz, name, NOW, NOW);
    run("INSERT INTO fiscal_snapshot_member (snapshot_id, fiscal_project_id, observation_id) VALUES (?, ?, ?)", "fs:" + year, id, "obs:" + id);
  }
}

test("부서코드는 공개 연도별 관측 범위와 상태를 갖고, 같은 사업코드가 부서를 옮기면 이관으로 묶는다(앞자리 0 보존)", async () => {
  const db = database();
  seed(db, [
    ["2024", "0300101", "A1", "경로당 지원"], ["2024", "0300101", "A2", "노인 일자리"], ["2024", "0300101", "A3", "기초연금"], ["2024", "0400201", "B1", "아동수당"],
    ["2025", "0300101", "A1", "경로당 지원"], ["2025", "0500301", "A2", "노인 일자리"], ["2025", "0500301", "A3", "기초연금"], ["2025", "0400201", "B1", "아동수당"],
    ["2026", "0500301", "A1", "경로당 지원"], ["2026", "0500301", "A2", "노인 일자리"], ["2026", "0500301", "A3", "기초연금"],
    ["2026", "0400201", "C1", "새 사업 1"], ["2026", "0400201", "C2", "새 사업 2"], ["2026", "0400201", "C3", "새 사업 3"],
    ["2027", "0900901", "Z1", "공개 전 자료"],
  ]);
  const history = await departmentHistory(db, "lofin:laf:9999000");
  assert.deepEqual(history.fiscal_years, ["2024", "2025", "2026"], "공개 전 snapshot 연도는 보지 않는다");
  const byCode = Object.fromEntries(history.departments.map((row) => [row.code, row]));
  assert.equal(byCode["0300101"].status, "disappeared");
  assert.equal(byCode["0300101"].last_observed_year, "2025");
  assert.equal(byCode["0500301"].status, "appeared");
  assert.equal(byCode["0400201"].status, "present_all_years");
  assert.equal(byCode["0900901"], undefined);
  assert.deepEqual(history.transfers.map((row) => [row.from_year, row.to_year, row.from_department_code, row.to_department_code, row.projects]), [
    ["2024", "2025", "0300101", "0500301", 2],
    ["2025", "2026", "0300101", "0500301", 1],
  ]);
  assert.equal(history.code_reuse.length, 0, "사업이 3건 미만인 부서는 코드 재사용 판단을 하지 않는다");
  assert.equal(await departmentHistory(db, "lofin:laf:1234567"), null);
});
