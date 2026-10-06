// 주기 범위(광역별 전국 전체 세출) snapshot 보관 정리. 한 번에 수십만 행이라 범위마다 최근 공개본 2개만 행 자료를 남기고,
// 그보다 오래된 snapshot은 구성원·관측행을 조금씩 지운 뒤 PURGED로 표시한다. 활성 통합 공개본에 고정된 snapshot은 지우지 않는다.
import type { SqlDatabase } from "../sql-database.ts";

export const KEEP_PERIODIC_SNAPSHOTS = 2;
const DELETE_CHUNK = 2000;

/** 지울 snapshot이 있으면 한 묶음을 지우고 true. 할 일이 없으면 false. */
export async function purgeOldPeriodicSnapshots(db: SqlDatabase, periodicScopeIds: readonly string[], pinnedSnapshotIds: readonly string[] | null): Promise<boolean> {
  const pinned = new Set(pinnedSnapshotIds ?? []);
  for (const scopeId of periodicScopeIds) {
    const rows = (await db.prepare(
      "SELECT snapshot_id, run_id FROM fiscal_snapshot WHERE scope_id = ? AND status IN ('PUBLISHED', 'SUPERSEDED') ORDER BY requested_reference_date DESC, created_at DESC",
    ).bind(scopeId).all<{ snapshot_id: string; run_id: string }>()).results;
    const old = rows.slice(KEEP_PERIODIC_SNAPSHOTS).find((row) => !pinned.has(row.snapshot_id));
    if (!old) continue;
    await db.batch([
      db.prepare("DELETE FROM fiscal_snapshot_member WHERE rowid IN (SELECT rowid FROM fiscal_snapshot_member WHERE snapshot_id = ? LIMIT ?)").bind(old.snapshot_id, DELETE_CHUNK),
      db.prepare("DELETE FROM fiscal_observation WHERE rowid IN (SELECT rowid FROM fiscal_observation WHERE run_id = ? LIMIT ?)").bind(old.run_id, DELETE_CHUNK),
    ]);
    const left = await db.prepare(
      "SELECT EXISTS(SELECT 1 FROM fiscal_snapshot_member WHERE snapshot_id = ?) + EXISTS(SELECT 1 FROM fiscal_observation WHERE run_id = ?) AS remaining",
    ).bind(old.snapshot_id, old.run_id).first<{ remaining: number }>();
    if (!left?.remaining) {
      await db.prepare("UPDATE fiscal_snapshot SET status = 'PURGED', status_reason = ? WHERE snapshot_id = ?")
        .bind("보관 기간이 지나 행 자료를 지움(주기 범위는 최근 공개본 " + KEEP_PERIODIC_SNAPSHOTS + "개만 보관)", old.snapshot_id).run();
    }
    return true;
  }
  return false;
}
