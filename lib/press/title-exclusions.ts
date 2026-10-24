import type { SqlDatabase } from "../sql-database.ts";
import { withdrawPressItem } from "./admin.ts";

const EXCLUDED_TITLE = "고향사랑기부";
export const TITLE_EXCLUSION_REASON = "운영자 요청(2026-10-24): 제목에 고향사랑기부 포함";

export function isExcludedPressTitle(title: string): boolean {
  return title.includes(EXCLUDED_TITLE);
}

/** 기존 게시물도 공개 철회하고 원문 주소를 차단한다. 한 차례에는 최대 50개 주소를 처리한다. */
export async function withdrawExcludedPressItems(db: SqlDatabase, nowSeconds: number): Promise<number> {
  const rows = await db.prepare(
    "SELECT DISTINCT canonical_url FROM press_item WHERE instr(title, ?) > 0 AND public_status <> 'WITHDRAWN' ORDER BY canonical_url LIMIT 50",
  ).bind(EXCLUDED_TITLE).all<{ readonly canonical_url: string }>();
  let withdrawn = 0;
  for (const row of rows.results) {
    withdrawn += await withdrawPressItem(db, row.canonical_url, TITLE_EXCLUSION_REASON, nowSeconds);
  }
  return withdrawn;
}
