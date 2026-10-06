import type { SqlDatabase } from "../sql-database.ts";

// 연도별 부서·사업 코드 이력(작업지시서 v5 T94, §20 fiscal_region_mappings: 연도별 조직개편·명칭 변경·이관·사업코드 변경은 이력으로 관리).
// 같은 수집 범위의 서로 다른 회계연도 공개 snapshot을 비교한다. 코드는 문자열 그대로 비교한다(앞자리 0 보존).
// 원천(지방재정365 세출현황)에는 부서명이 없어 부서는 코드로만 비교한다. '이관'은 같은 자치단체·회계·세부사업코드가
// 앞 연도와 다른 부서코드에만 나타나는 경우의 후보이며, 조직개편 고시로 확인한 사실이 아니다.

export interface CodeHistory {
  readonly scope_id: string;
  readonly years: readonly [string, string];
  readonly snapshots: readonly [string, string];
  readonly departments: { readonly previous: number; readonly current: number; readonly continuing: number; readonly added: readonly string[]; readonly removed: readonly string[] };
  readonly projects: { readonly previous: number; readonly current: number; readonly continuing: number; readonly added: number; readonly removed: number };
  readonly transfers: { readonly total: number; readonly items: readonly TransferCandidate[] };
  readonly renamed: { readonly total: number; readonly items: readonly { readonly dbiz_code: string; readonly previous_name: string; readonly current_name: string }[] };
  readonly basis: string;
}

export interface TransferCandidate {
  readonly fiscal_entity_id: string;
  readonly account_code: string;
  readonly dbiz_code: string;
  readonly name: string;
  readonly previous_departments: readonly string[];
  readonly current_departments: readonly string[];
}

interface MemberRow {
  readonly fiscal_entity_id: string;
  readonly account_code: string;
  readonly department_code: string;
  readonly dbiz_code: string;
  readonly name: string;
}

const LIST_LIMIT = 50;

async function members(db: SqlDatabase, snapshotId: string): Promise<MemberRow[]> {
  return (await db.prepare(
    "SELECT p.fiscal_entity_id, p.account_code, p.department_code, p.dbiz_code, p.name FROM fiscal_snapshot_member m JOIN fiscal_project p ON p.fiscal_project_id = m.fiscal_project_id WHERE m.snapshot_id = ?",
  ).bind(snapshotId).all<MemberRow>()).results;
}

function group(rows: readonly MemberRow[]) {
  const departments = new Set(rows.map((row) => row.fiscal_entity_id + ":" + row.department_code));
  const projects = new Map<string, { name: string; departments: Set<string> }>();
  for (const row of rows) {
    const key = row.fiscal_entity_id + ":" + row.account_code + ":" + row.dbiz_code;
    const entry = projects.get(key) ?? { name: row.name, departments: new Set<string>() };
    entry.departments.add(row.department_code);
    projects.set(key, entry);
  }
  return { departments, projects };
}

/** 범위마다 가장 최근 두 회계연도의 공개 snapshot을 비교한다. 두 해가 없으면 null. */
export async function fiscalCodeHistory(db: SqlDatabase, scopeId: string): Promise<CodeHistory | null> {
  const latest = (await db.prepare(
    "SELECT fiscal_year, snapshot_id FROM fiscal_snapshot s WHERE scope_id = ? AND status = 'PUBLISHED' AND complete = 1 AND published_at = (SELECT MAX(t.published_at) FROM fiscal_snapshot t WHERE t.scope_id = s.scope_id AND t.fiscal_year = s.fiscal_year AND t.status = 'PUBLISHED' AND t.complete = 1) ORDER BY fiscal_year DESC LIMIT 2",
  ).bind(scopeId).all<{ fiscal_year: string; snapshot_id: string }>()).results;
  if (latest.length < 2) return null;
  const [current, previous] = latest as [{ fiscal_year: string; snapshot_id: string }, { fiscal_year: string; snapshot_id: string }];
  const before = group(await members(db, previous.snapshot_id));
  const after = group(await members(db, current.snapshot_id));
  const added = [...after.departments].filter((code) => !before.departments.has(code)).sort();
  const removed = [...before.departments].filter((code) => !after.departments.has(code)).sort();
  const transfers: TransferCandidate[] = [];
  const renamed: { dbiz_code: string; previous_name: string; current_name: string }[] = [];
  let continuing = 0;
  for (const [key, now] of after.projects) {
    const then = before.projects.get(key);
    if (!then) continue;
    continuing += 1;
    const [entity, account, dbiz] = splitKey(key);
    if ([...now.departments].every((code) => !then.departments.has(code))) {
      transfers.push({ fiscal_entity_id: entity, account_code: account, dbiz_code: dbiz, name: now.name, previous_departments: [...then.departments].sort(), current_departments: [...now.departments].sort() });
    }
    if (now.name !== then.name) renamed.push({ dbiz_code: dbiz, previous_name: then.name, current_name: now.name });
  }
  return {
    scope_id: scopeId,
    years: [previous.fiscal_year, current.fiscal_year],
    snapshots: [previous.snapshot_id, current.snapshot_id],
    departments: { previous: before.departments.size, current: after.departments.size, continuing: after.departments.size - added.length, added: added.slice(0, LIST_LIMIT), removed: removed.slice(0, LIST_LIMIT) },
    projects: { previous: before.projects.size, current: after.projects.size, continuing, added: after.projects.size - continuing, removed: before.projects.size - continuing },
    transfers: { total: transfers.length, items: transfers.slice(0, LIST_LIMIT) },
    renamed: { total: renamed.length, items: renamed.slice(0, LIST_LIMIT) },
    basis: "같은 범위의 회계연도별 공개 snapshot 비교(자치단체코드·회계코드·세부사업코드·부서코드 문자열). 이관·명칭 변경은 원천 코드로 본 후보이며 조직개편 고시로 확인한 사실이 아님",
  };
}

/** 'lofin:laf:4900000:100:650000…' 꼴 열쇠를 자치단체 ID·회계코드·세부사업코드로 나눈다(자치단체 ID 안에도 ':'가 있다). */
function splitKey(key: string): [string, string, string] {
  const parts = key.split(":");
  const dbiz = parts.pop() ?? "";
  const account = parts.pop() ?? "";
  return [parts.join(":"), account, dbiz];
}

