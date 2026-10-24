import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { projectDepartmentLabels } from "../scripts/build-budget-department-labels.mjs";
import { budgetDepartmentName, budgetDepartmentLabel } from "../components/budget/budget-departments.ts";
import { scheduleBudgetPrefetch } from "../components/budget/budget-prefetch.ts";

test("ambiguous verified names remain unknown despite a display override", () => {
  const base = { fiscal_entity_name: "기관", department_code: "1", status: "verified_exact" };
  const projected = projectDepartmentLabels([{ ...base, department_name: "첫 이름", display_name: "표시명" }, { ...base, department_name: "다른 이름" }]);
  assert.equal(projected["기관|1"], undefined);
});

test("display names and subunits survive duplicate observations and unverified rows", () => {
  const base = { fiscal_entity_name: "기관", department_code: "1", status: "verified_exact", department_name: "보건소" };
  const projected = projectDepartmentLabels([{ ...base, display_name: "지역 보건소", sub_departments: ["보건행정과", "건강증진과"] }, base, { ...base, status: "pending", department_name: "다른 이름", display_name: "미확인" }]);
  assert.equal(projected["기관|1"], "지역 보건소(보건행정과·건강증진과)");
});

test("generated client labels match all original verified observations", async () => {
  const source = JSON.parse(await readFile(new URL("../components/budget/budget-department-names.json", import.meta.url), "utf8"));
  const keys = new Map(source.mappings.map((entry) => [entry.fiscal_entity_name + "|" + entry.department_code, entry]));
  for (const entry of keys.values()) {
    const observations = source.mappings.filter((row) => row.status === "verified_exact" && row.fiscal_entity_name === entry.fiscal_entity_name && row.department_code === entry.department_code);
    const names = new Set(observations.map((row) => row.department_name));
    const display = observations.findLast((row) => row.display_name)?.display_name;
    const subunits = observations.findLast((row) => row.sub_departments?.length)?.sub_departments;
    const expected = names.size === 1 ? (display ?? [...names][0]) + (subunits?.length ? "(" + subunits.join("·") + ")" : "") : null;
    assert.equal(budgetDepartmentName(entry.fiscal_entity_name, entry.department_code), expected);
    assert.equal(budgetDepartmentLabel(entry.fiscal_entity_name, entry.department_code), expected ? `${expected} (${entry.department_code})` : `부서코드 ${entry.department_code} (명칭 미확인)`);
  }
  assert.equal(budgetDepartmentName("missing", "missing"), null);
});

function idleQueue() {
  const pending = new Set();
  return {
    schedule(run) { pending.add(run); return () => pending.delete(run); },
    run() { const task = [...pending][0]; if (task) { pending.delete(task); task(); } },
    get size() { return pending.size; },
  };
}

for (const [settled, saving] of [[false, false], [true, true]]) {
  test(`prefetch does not schedule when settled=${settled} and saveData=${saving}`, () => {
    const queue = idleQueue();
    scheduleBudgetPrefetch({ settled, saveData: () => saving, targets: ["next"], schedule: queue.schedule, load: async () => assert.fail("unexpected request") });
    assert.equal(queue.size, 0);
  });
}

test("prefetch waits for idle and each response, then cancellation prevents the next request", async () => {
  const queue = idleQueue();
  const requested = [];
  let complete;
  const response = new Promise((resolve) => { complete = resolve; });
  const cancel = scheduleBudgetPrefetch({ settled: true, saveData: () => false, targets: ["next", "other"], schedule: queue.schedule, load: (path) => { requested.push(path); return response; } });
  assert.deepEqual(requested, []);
  queue.run();
  assert.deepEqual(requested, ["next"]);
  assert.equal(queue.size, 0);
  complete();
  await response;
  assert.equal(queue.size, 1);
  cancel();
  queue.run();
  assert.deepEqual(requested, ["next"]);
});

test("turning on data saving before idle prevents the queued request", () => {
  const queue = idleQueue();
  let saving = false;
  scheduleBudgetPrefetch({ settled: true, saveData: () => saving, targets: ["next"], schedule: queue.schedule, load: async () => assert.fail("unexpected request") });
  saving = true;
  queue.run();
  assert.equal(queue.size, 0);
});
