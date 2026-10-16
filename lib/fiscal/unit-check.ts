import type { SqlDatabase } from "../sql-database.ts";

// 금액 단위 공식 화면 대조(작업지시서 v5 §22·T84). 기록은 fiscal_unit_check(대조 스크립트 scripts/fiscal/unit-check.mjs 결과).
export const UNIT_VERIFIED_OFFICIAL_SCREEN = "VERIFIED_OFFICIAL_SCREEN";
const UNVERIFIED_NOTE = "금액 단위는 원으로 해석했으며(응답 정수값·과거 대조기록 근거) 이 수집분은 아직 공식 화면과 대조하지 않았습니다(unit_verification=UNVERIFIED_IN_SCOPE).";

/** 관측 행의 단위 검증 상태: 그 snapshot에 불일치 없는 대조 기록이 있으면 VERIFIED_OFFICIAL_SCREEN, 아니면 수집 때 값. */
export function unitVerificationSql(alias: string): string {
  return "CASE WHEN " + verifiedAmountSql(alias) + " THEN '" + UNIT_VERIFIED_OFFICIAL_SCREEN + "' ELSE 'UNVERIFIED_IN_SCOPE' END";
}

/** 검증 표시는 유효한 같은 범위·기준일의 공식 대조 기록에서만 얻는다. 수집행의 문자열만 믿지 않는다. */
export function verifiedAmountSql(alias: string): string {
  return "(" + alias + ".source_amount_unit = 'KRW' AND EXISTS (SELECT 1 FROM fiscal_unit_check uc JOIN fiscal_snapshot us ON us.snapshot_id = uc.snapshot_id " +
    "WHERE uc.snapshot_id = 'fs:' || " + alias + ".run_id AND us.run_id = " + alias + ".run_id AND us.status = 'PUBLISHED' AND us.complete = 1 AND uc.reference_date = us.requested_reference_date " +
    "AND uc.mismatches = 0 AND uc.only_api = 0 AND uc.rows_compared > 0 AND uc.rows_compared >= us.unique_count AND uc.field_checks >= uc.rows_compared * 6))";
}

interface CheckRow { readonly snapshot_id: string; readonly reference_date: string; readonly rows_compared: number; readonly field_checks: number; readonly mismatches: number; readonly only_api: number; readonly checked_at: number; readonly requested_reference_date: string; readonly unique_count: number; readonly complete: number }

/** 화면·MCP 안내 문구. 고른 snapshot이 모두 불일치 없이 대조됐을 때만 검증 문구를 쓴다. */
export async function unitNote(db: SqlDatabase, snapshotIds: readonly string[]): Promise<string> {
  const ids = [...new Set(snapshotIds)];
  if (!ids.length) return UNVERIFIED_NOTE;
  const rows = (await db.prepare("SELECT uc.*, s.requested_reference_date, s.unique_count, s.complete FROM fiscal_unit_check uc JOIN fiscal_snapshot s ON s.snapshot_id = uc.snapshot_id WHERE s.status = 'PUBLISHED' AND uc.snapshot_id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(ids)).all<CheckRow>()).results;
  if (rows.length !== ids.length || rows.some((row) => row.mismatches !== 0 || row.only_api !== 0 || row.rows_compared <= 0 || row.rows_compared < row.unique_count || row.field_checks < row.rows_compared * 6 || row.complete !== 1 || row.reference_date !== row.requested_reference_date)) return UNVERIFIED_NOTE;
  const rowsCompared = rows.reduce((sum, row) => sum + row.rows_compared, 0);
  const fields = rows.reduce((sum, row) => sum + row.field_checks, 0);
  return "금액 단위는 원입니다. 지방재정365 「세부사업별 세출현황」 공식 화면의 원값과 이 공개 자료 " + rowsCompared.toLocaleString("ko-KR") + "행·금액 " + fields.toLocaleString("ko-KR") + "칸을 대조해 모두 일치했습니다(기준일 " + rows.map((row) => row.reference_date).join(", ") + ", 대조 " + new Date(Math.max(...rows.map((row) => row.checked_at)) * 1000).toISOString().slice(0, 10) + "). 화면은 백만원 단위로 반올림해 표시합니다.";
}
