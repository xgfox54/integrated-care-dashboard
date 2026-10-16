// 예산서는 재정 API snapshot과 독립된 공개 구성요소다. 현재 활성 포인터와 공개본의 반입·revision 쌍을 함께 확인한다.
import type { SqlDatabase } from "../sql-database.ts";
import { sha256Hex } from "../press/normalize.ts";

export type BudgetRevisionPin = readonly (readonly [string, string])[] | null;

export function parseBudgetPin(value: unknown): Exclude<BudgetRevisionPin, null> {
  return Array.isArray(value) ? value.filter((pair): pair is [string, string] => Array.isArray(pair) && pair.length === 2 && pair.every((part) => typeof part === "string")) : [];
}

export function budgetPinWhere(pin: BudgetRevisionPin, alias = "a"): { sql: string; binds: unknown[] } {
  if (pin === null) return { sql: "1 = 1", binds: [] };
  return {
    // 행값 IN(SELECT …)은 고정 목록을 한 번만 만들어 둔다. EXISTS(json_each)는 예산서 행마다 목록을 다시 펼쳐
    // 운영에서 건수 조회가 400만 행을 읽었다(같은 결과, 로컬 2,961ms → 4ms).
    sql: "(" + alias + ".import_id, " + alias + ".revision_id) IN (SELECT json_extract(bp.value, '$[0]'), json_extract(bp.value, '$[1]') FROM json_each(?) bp)",
    binds: [JSON.stringify(pin)],
  };
}

export async function budgetDocumentComponent(db: SqlDatabase) {
  const rows = (await db.prepare(
    "SELECT a.import_id, a.revision_id, a.document_id, a.fiscal_year, a.activated_at, r.line_count, d.raw_sha256 " +
    "FROM budget_active_revision a JOIN budget_revision r ON r.import_id = a.import_id AND r.revision_id = a.revision_id " +
    "JOIN budget_document d ON d.import_id = a.import_id AND d.document_id = a.document_id ORDER BY a.import_id, a.revision_id",
  ).all<{ import_id: string; revision_id: string; document_id: string; fiscal_year: string; activated_at: number; line_count: number; raw_sha256: string }>()).results;
  return {
    id: rows.length ? "budgetdocs:" + (await sha256Hex(JSON.stringify(rows))).slice(0, 16) : null,
    status: rows.length ? "PARTIAL" as const : "UNAVAILABLE" as const,
    detail: {
      revision_pairs: rows.map((row) => [row.import_id, row.revision_id]),
      revisions: rows.length,
      documents: new Set(rows.map((row) => row.document_id)).size,
      lines: rows.reduce((sum, row) => sum + row.line_count, 0),
      fiscal_years: [...new Set(rows.map((row) => row.fiscal_year))].sort(),
      reason: rows.length ? null : "승인·활성화된 예산서가 없습니다.",
    },
  };
}
