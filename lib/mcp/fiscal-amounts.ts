import { projectDto, type ProjectRecord } from "../fiscal/query.ts";
import { UNIT_VERIFIED_OFFICIAL_SCREEN } from "../fiscal/unit-check.ts";
import type { SqlDatabase } from "../sql-database.ts";

export const FISCAL_AMOUNT_NOTE = "공식 화면과 같은 범위·기준일로 유효하게 대조된 원 단위 금액만 제공합니다. 미검증 금액·재원·비율은 null이며 0원이 아닙니다. 예산서 문서 단계 금액은 search_budget_lines/get_budget_breakdown에서 독립적으로 조회하세요.";
export function hasVerifiedAmounts(row: Pick<ProjectRecord, "unit_verification" | "source_amount_unit">): boolean {
  return row.unit_verification === UNIT_VERIFIED_OFFICIAL_SCREEN && row.source_amount_unit === "KRW";
}

/** 미검증 원값도 반환하지 않아 출처·재원·파생값을 통한 금액 노출을 막는다. */
export function publicProjectDto(row: ProjectRecord) {
  const verified = hasVerifiedAmounts(row);
  const safe = verified ? row : { ...row, current_budget_krw: null, public_expenditure_krw: null, national_krw: null, province_krw: null, municipal_krw: null, other_krw: null, current_budget_raw: null, public_expenditure_raw: null };
  return {
    ...projectDto(safe),
    amount_status: verified ? "VERIFIED_OFFICIAL_SCREEN" : "NOT_VERIFIED",
    amount_unavailable_reason: verified ? null : "UNIT_VERIFICATION_REQUIRED",
    amount_semantics: "CURRENT_BUDGET_AND_REPORTED_CUMULATIVE_EXPENDITURE",
  };
}

export async function fiscalVerificationStatus(db: SqlDatabase, pin: readonly string[] | null) {
  const rows = (await db.prepare(
    "SELECT s.snapshot_id, s.fiscal_year, s.requested_reference_date, s.unique_count, c.mode, " +
    "CASE WHEN s.complete = 1 AND uc.reference_date = s.requested_reference_date AND uc.mismatches = 0 AND uc.only_api = 0 AND uc.rows_compared > 0 AND uc.rows_compared >= s.unique_count AND uc.field_checks >= uc.rows_compared * 6 THEN 1 ELSE 0 END AS verified " +
    "FROM fiscal_snapshot s JOIN fiscal_scope c ON c.scope_id = s.scope_id LEFT JOIN fiscal_unit_check uc ON uc.snapshot_id = s.snapshot_id WHERE s.status = 'PUBLISHED' " +
    (pin === null ? "" : "AND s.snapshot_id IN (SELECT value FROM json_each(?)) ") + "ORDER BY s.snapshot_id",
  ).bind(...(pin === null ? [] : [JSON.stringify(pin)])).all<{ snapshot_id: string; fiscal_year: string; requested_reference_date: string; unique_count: number; verified: number; mode: string }>()).results;
  return {
    policy: "OFFICIAL_SCREEN_VERIFIED_SCOPE_ONLY", published_snapshots: rows.length,
    verified_snapshots: rows.filter((row) => row.verified === 1).length,
    available_snapshot_modes: [...new Set(rows.map((row) => row.mode))],
    unverified_snapshots: rows.filter((row) => row.verified !== 1).length,
    verified_scopes: rows.filter((row) => row.verified === 1).map(({ verified: _verified, ...row }) => row),
    note: FISCAL_AMOUNT_NOTE,
  };
}
