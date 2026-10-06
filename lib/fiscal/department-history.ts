// 부서코드 연도별 이력·이관 확인(작업지시서 v5 §22.9, T94). 공개(PUBLISHED) snapshot에 실제로 나타난 값만 쓴다.
// 원천(지방재정365 QWGJK)은 부서 이름과 조직개편 날짜를 주지 않는다. 그래서 「관측 연도」는 공식 시행일이 아니라 공개 자료에서 그 코드가 나타난 회계연도이고,
// 「이관」은 같은 재정주체·회계·세부사업코드 사업이 이웃한 두 회계연도에서 서로 다른 부서코드에 있는 경우만 센다(사업 내용이 같다는 확인은 아님).
import type { SqlDatabase } from "../sql-database.ts";
import { readWebPin } from "../platform/public-pin.ts";
import { publishedSnapshots } from "./query.ts";

interface Row { readonly fiscal_project_id: string; readonly fiscal_year: string; readonly department_code: string; readonly account_code: string; readonly dbiz_code: string; readonly name: string }

export interface DepartmentRecord {
  readonly code: string;
  readonly observed_years: readonly string[];
  readonly first_observed_year: string;
  readonly last_observed_year: string;
  readonly projects_by_year: Readonly<Record<string, number>>;
  readonly status: "present_all_years" | "appeared" | "disappeared" | "intermittent";
}
export interface TransferRecord {
  readonly from_year: string;
  readonly to_year: string;
  readonly from_department_code: string;
  readonly to_department_code: string;
  readonly projects: number;
  readonly examples: readonly { readonly name: string; readonly account_code: string; readonly source_project_code: string }[];
}
export interface DepartmentHistory {
  readonly fiscal_entity_id: string;
  readonly fiscal_years: readonly string[];
  readonly departments: readonly DepartmentRecord[];
  readonly transfers: readonly TransferRecord[];
  readonly code_reuse: readonly { readonly department_code: string; readonly from_year: string; readonly to_year: string; readonly projects_from: number; readonly projects_to: number }[];
  readonly basis: string;
}

/** 재정주체 하나의 부서코드 연도별 관측 이력과 이웃 연도 사이 사업 이관. 연도마다 그 해 공개 snapshot을 모두 합쳐(같은 사업은 한 번) 본다. */
export async function departmentHistory(db: SqlDatabase, entityId: string, pin: readonly string[] | null = null): Promise<DepartmentHistory | null> {
  const snapshots = await publishedSnapshots(db, { snapshotIds: pin, limit: 2000 });
  const byYear = new Map<string, string[]>();
  for (const snapshot of snapshots) (byYear.get(snapshot.fiscal_year) ?? byYear.set(snapshot.fiscal_year, []).get(snapshot.fiscal_year)!).push(snapshot.snapshot_id);
  const rows: Row[] = [];
  for (const ids of byYear.values()) {
    rows.push(...(await db.prepare(
      "SELECT DISTINCT p.fiscal_project_id, p.fiscal_year, p.department_code, p.account_code, p.dbiz_code, p.name FROM fiscal_snapshot_member m JOIN fiscal_project p ON p.fiscal_project_id = m.fiscal_project_id " +
        "WHERE m.snapshot_id IN (SELECT value FROM json_each(?)) AND p.fiscal_entity_id = ?",
    ).bind(JSON.stringify(ids), entityId).all<Row>()).results);
  }
  if (!rows.length) return null;
  const years = [...new Set(rows.map((row) => row.fiscal_year))].sort();
  const deptYears = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const counts = deptYears.get(row.department_code) ?? deptYears.set(row.department_code, new Map()).get(row.department_code)!;
    counts.set(row.fiscal_year, (counts.get(row.fiscal_year) ?? 0) + 1);
  }
  const departments: DepartmentRecord[] = [...deptYears.entries()].map(([code, counts]) => {
    const observed = years.filter((year) => counts.has(year));
    const span = years.indexOf(observed[observed.length - 1]) - years.indexOf(observed[0]) + 1;
    const status = observed.length === years.length ? "present_all_years" as const
      : span !== observed.length ? "intermittent" as const
      : observed[0] !== years[0] ? "appeared" as const : "disappeared" as const;
    return { code, observed_years: observed, first_observed_year: observed[0], last_observed_year: observed[observed.length - 1], projects_by_year: Object.fromEntries(counts), status };
  }).sort((a, b) => a.code.localeCompare(b.code));
  const key = (row: Row) => row.account_code + "|" + row.dbiz_code;
  const group = (year: string) => {
    const map = new Map<string, Row[]>();
    for (const row of rows) if (row.fiscal_year === year) (map.get(key(row)) ?? map.set(key(row), []).get(key(row))!).push(row);
    return map;
  };
  const transfers = new Map<string, { from_year: string; to_year: string; from_department_code: string; to_department_code: string; projects: number; examples: { name: string; account_code: string; source_project_code: string }[] }>();
  const codeReuse: { department_code: string; from_year: string; to_year: string; projects_from: number; projects_to: number }[] = [];
  for (let index = 1; index < years.length; index += 1) {
    const [from, to] = [years[index - 1], years[index]];
    const left = group(from);
    const right = group(to);
    for (const [projectKey, lefts] of left) {
      const rights = right.get(projectKey);
      if (lefts.length !== 1 || !rights || rights.length !== 1) continue;
      const [a, b] = [lefts[0], rights[0]];
      if (a.department_code === b.department_code) continue;
      const id = from + "|" + to + "|" + a.department_code + "|" + b.department_code;
      const entry = transfers.get(id) ?? transfers.set(id, { from_year: from, to_year: to, from_department_code: a.department_code, to_department_code: b.department_code, projects: 0, examples: [] }).get(id)!;
      entry.projects += 1;
      if (entry.examples.length < 3) entry.examples.push({ name: b.name, account_code: b.account_code, source_project_code: b.dbiz_code });
    }
    // 같은 부서코드가 두 해에 모두 있는데 이어지는 사업이 하나도 없으면 다른 조직에 코드가 다시 쓰였을 수 있다(확인 대상 표시만).
    for (const department of departments) {
      const fromCount = department.projects_by_year[from] ?? 0;
      const toCount = department.projects_by_year[to] ?? 0;
      if (Math.min(fromCount, toCount) < 3) continue;
      const fromKeys = new Set(rows.filter((row) => row.fiscal_year === from && row.department_code === department.code).map(key));
      if (!rows.some((row) => row.fiscal_year === to && row.department_code === department.code && fromKeys.has(key(row)))) {
        codeReuse.push({ department_code: department.code, from_year: from, to_year: to, projects_from: fromCount, projects_to: toCount });
      }
    }
  }
  return {
    fiscal_entity_id: entityId,
    fiscal_years: years,
    departments,
    transfers: [...transfers.values()].sort((a, b) => b.projects - a.projects),
    code_reuse: codeReuse,
    basis: "공개 snapshot에 나타난 회계연도만 봅니다. 원천이 부서 이름·조직개편 시행일을 주지 않아 관측 연도는 공식 유효기간이 아니며, 이관은 같은 회계·세부사업코드 사업이 이웃 연도에 각각 하나씩 있고 부서코드가 바뀐 경우입니다. 수집하지 않은 연도는 판단하지 않습니다.",
  };
}

export async function webDepartmentHistory(db: SqlDatabase, entityId: string) {
  const pin = await readWebPin(db);
  return departmentHistory(db, entityId, pin.fiscalSnapshotIds);
}
