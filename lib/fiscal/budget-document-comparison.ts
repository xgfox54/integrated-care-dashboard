import type { SqlDatabase } from "../sql-database.ts";
import { readWebPin } from "../platform/public-pin.ts";
import { pickSnapshotSet, publishedSnapshots } from "./query.ts";
import type { LineRow, RevisionRow } from "./budget-documents.ts";
import { budgetDocumentMatcher, squashName } from "./budget-document-matching.ts";

type ComparisonScope = Pick<RevisionRow, "fiscal_entity_id" | "fiscal_year" | "account_code">;
export type ApiRow = {
  readonly fiscal_project_id: string; readonly name: string; readonly department_code: string; readonly dbiz_code: string;
  readonly reference_date: string; readonly current_budget_krw: string | null; readonly public_expenditure_krw: string | null;
};
type ComparisonRevision = ComparisonScope & { readonly entity_name: string | null; readonly stage_label: string };
export type ComparisonLine = LineRow & { readonly annotations: readonly string[] };

export async function apiRowsFor(db: SqlDatabase, scope: ComparisonScope): Promise<{ readonly rows: ApiRow[]; readonly snapshotIds: string[] }> {
  const pin = await readWebPin(db);
  const choice = pickSnapshotSet(await publishedSnapshots(db, { fiscalYear: scope.fiscal_year, snapshotIds: pin.fiscalSnapshotIds, limit: 800 }), scope.fiscal_year, undefined);
  const snapshotIds = choice.snapshots.map((snapshot) => snapshot.snapshot_id);
  if (!snapshotIds.length) return { rows: [], snapshotIds };
  const rows = (await db.prepare(
    "SELECT p.fiscal_project_id, p.name, p.department_code, p.dbiz_code, o.reference_date, o.current_budget_krw, o.public_expenditure_krw FROM fiscal_snapshot_member m " +
    "JOIN fiscal_project p ON p.fiscal_project_id = m.fiscal_project_id JOIN fiscal_observation o ON o.observation_id = m.observation_id " +
    "WHERE m.snapshot_id IN (SELECT value FROM json_each(?)) AND p.fiscal_entity_id = ? AND p.account_code = ?",
  ).bind(JSON.stringify(snapshotIds), scope.fiscal_entity_id, scope.account_code).all<ApiRow>()).results;
  const latest = new Map<string, ApiRow>();
  for (const row of rows) {
    const known = latest.get(row.fiscal_project_id);
    if (!known || row.reference_date > known.reference_date) latest.set(row.fiscal_project_id, row);
  }
  return { rows: [...latest.values()], snapshotIds };
}

export const API_RELATION_LABELS: Record<string, string> = {
  same_within_display_rounding: "같음(천원 표시 반올림 범위)",
  api_current_higher: "지방재정365 예산현액이 더 큼",
  api_current_lower: "지방재정365 예산현액이 더 작음",
  not_found_in_api: "지방재정365에 일치하는 사업 없음",
  ambiguous_name_in_api: "같은 이름 사업이 여러 개(자동 선택 안 함)",
  api_amount_missing: "지방재정365 금액 없음",
  api_identity_conflict: "부서·사업코드 근거 미확인 또는 불일치(자동 선택 안 함)",
};

function relationTo(documentKrw: string | null, apiKrw: string | null): string {
  if (documentKrw === null || apiKrw === null) return "api_amount_missing";
  const diff = BigInt(apiKrw) - BigInt(documentKrw);
  const abs = diff < BigInt(0) ? -diff : diff;
  return abs < BigInt(1000) ? "same_within_display_rounding" : diff > BigInt(0) ? "api_current_higher" : "api_current_lower";
}

export async function compareDocumentRows(db: SqlDatabase, revision: ComparisonRevision, lines: readonly ComparisonLine[]) {
  if (!revision.fiscal_entity_id) return null;
  const { rows, snapshotIds } = await apiRowsFor(db, revision);
  if (!rows.length) return null;
  const byName = new Map<string, ApiRow[]>();
  for (const row of rows) {
    const key = squashName(row.name);
    const named = byName.get(key) ?? [];
    named.push(row);
    byName.set(key, named);
  }
  const counts: Record<string, number> = {};
  const byLine = new Map<string, Record<string, unknown>>();
  const matchProject = budgetDocumentMatcher(revision.entity_name, lines);
  for (const line of lines.filter((item) => item.level === "detail_project")) {
    const match = matchProject(line, byName.get(squashName(line.name)) ?? []);
    const matches = match.candidates;
    const selected = matches.length === 1 ? matches[0] : null;
    const relation = match.basis === "identity_conflict" ? "api_identity_conflict" : !matches.length ? "not_found_in_api" : selected ? relationTo(line.amount_krw, selected.current_budget_krw) : "ambiguous_name_in_api";
    counts[relation] = (counts[relation] ?? 0) + 1;
    byLine.set(line.line_id, {
      relation, relation_label: API_RELATION_LABELS[relation],
      match_basis: match.basis,
      api: selected ? { fiscal_project_id: selected.fiscal_project_id, department_code: selected.department_code, source_project_code: selected.dbiz_code, reference_date: selected.reference_date, current_budget_krw: selected.current_budget_krw, public_expenditure_krw: selected.public_expenditure_krw } : null,
      api_candidates: matches.length > 1 ? matches.map((match) => ({ fiscal_project_id: match.fiscal_project_id, department_code: match.department_code })) : [],
      difference_krw: selected && line.amount_krw !== null && selected.current_budget_krw !== null ? (BigInt(selected.current_budget_krw) - BigInt(line.amount_krw)).toString() : null,
    });
  }
  return {
    basis: {
      document: revision.stage_label + " 금액(문서 표시 천원 → 원 환산)",
      api: "지방재정365 세부사업별 세출현황 예산현액(기준일 현액, 추경·이월·전용 반영 가능)",
      reference_dates: [...new Set(rows.map((row) => row.reference_date))].sort(), snapshot_ids: snapshotIds,
      rule: "두 값은 뜻이 달라 서로 덮어쓰지 않습니다. 1,000원 미만 차이는 문서의 천원 표시 반올림으로 봅니다. 차이의 원인(추경·이월·전용 등)은 이 대조만으로 정하지 않습니다. 같은 재정주체·연도·회계 안에서 확인된 부서와 사업코드·사업명을 대조합니다. 코드 근거가 충돌하면 이름만으로 대신 연결하지 않습니다. 코드 없는 기존 문서는 확인된 부서 안의 이름으로 대조하며, 부서가 미확인된 경우 이름 대조만으로 부서 일치를 확정하지 않습니다. 후보가 여러 개면 자동 선택하지 않습니다.",
    },
    counts, by_line: byLine,
  };
}
