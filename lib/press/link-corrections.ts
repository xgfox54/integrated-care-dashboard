import corrections from "../../data/press-link-corrections-20261024.json" with { type: "json" };
import type { SqlDatabase } from "../sql-database.ts";

const REVISION = "press-link-corrections-20261024";
export const SEOCHO_SOURCE_ID = "src:www.seocho.go.kr:press";
const SEOCHO_LINK = 'View\\.do(?=[^"\']*[?&](?:amp;)?cbIdx=61(?:&|["\']|$))[^"\']*?[?&](?:amp;)?bcIdx=(?<id>[\\w-]+)';
const REMOVED_ORIGINAL_ID = "src:www.gp.go.kr:press:f0cf217bf1152a9e4fa7ab439988f277";
const REMOVED_ORIGINAL_URL = "https://www.gp.go.kr/portal/selectBbsNttView.do?key=787&bbsNo=127&nttNo=289880&searchCtgry=&searchCnd=all&searchKrwd=&pageIndex=1&integrDeptCode=";

/** 원문 제목까지 대조한 주소만 정정하며 게시물 ID와 공개·철회 상태를 보존한다. */
export async function applyVerifiedPressLinkCorrections(db: SqlDatabase, nowSeconds: number): Promise<void> {
  if (await db.prepare("SELECT key FROM app_setting WHERE key = ?").bind(REVISION).first()) return;
  const statements = corrections.flatMap((correction) => [
    db.prepare("INSERT INTO press_item_block (canonical_url, reason, blocked_at, previous_status) SELECT ?, reason, blocked_at, previous_status FROM press_item_block WHERE canonical_url = ? ON CONFLICT(canonical_url) DO NOTHING").bind(correction.to, correction.from),
    db.prepare("UPDATE press_item SET canonical_url = ? WHERE item_id = ? AND canonical_url = ?").bind(correction.to, correction.itemId, correction.from),
  ]);
  statements.push(
    // 원기관에서 삭제 안내를 확인한 자료만 철회하고 재수집을 차단한다.
    db.prepare("INSERT INTO press_item_block (canonical_url, reason, blocked_at, previous_status) SELECT canonical_url, ?, ?, public_status FROM press_item WHERE item_id = ? AND canonical_url = ? ON CONFLICT(canonical_url) DO NOTHING")
      .bind("2026-10-24 원문 확인: 가평군 게시판에서 삭제된 게시글로 안내함", nowSeconds, REMOVED_ORIGINAL_ID, REMOVED_ORIGINAL_URL),
    db.prepare("UPDATE press_item SET public_status = 'WITHDRAWN' WHERE item_id = ? AND canonical_url = ?").bind(REMOVED_ORIGINAL_ID, REMOVED_ORIGINAL_URL),
    db.prepare("UPDATE press_source SET adapter_profile = json_set(adapter_profile, '$.url', ?, '$.link', ?) WHERE source_id = ? AND json_valid(adapter_profile) AND json_extract(adapter_profile, '$.url') = ?")
      .bind("https://www.seocho.go.kr/site/seocho/ex/bbs/View.do?cbIdx=61&bcIdx={id}", SEOCHO_LINK, SEOCHO_SOURCE_ID, "https://www.seocho.go.kr/site/seocho/ex/bbs/View.do?cbIdx=57&bcIdx={id}"),
    db.prepare("INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING").bind(REVISION, "15 verified Seocho URLs; 1 removed Gapyong original withdrawn", nowSeconds),
  );
  await db.batch(statements);
}
