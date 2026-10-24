import type { SqlDatabase } from '../sql-database.ts';

export async function readPressQueueStatus(db: SqlDatabase, now: number) {
  const row = await db.prepare(
    "SELECT EXISTS(SELECT 1 FROM press_slot) AS captured, (SELECT COUNT(*) FROM press_slot_job WHERE closed_at IS NOT NULL AND status = 'failed') AS closed_failed_jobs, COUNT(*) AS open_jobs, MIN(j.slot_at) AS oldest_slot_at, " +
    "SUM(CASE WHEN c.next_due_at > ? AND COALESCE(c.safe_error, '') <> '' AND COALESCE(c.collection_hold, '') = '' THEN 1 ELSE 0 END) AS retry_waiting, " +
    "MIN(CASE WHEN c.next_due_at > ? AND COALESCE(c.safe_error, '') <> '' AND COALESCE(c.collection_hold, '') = '' THEN c.next_due_at END) AS next_retry_at, " +
    "SUM(CASE WHEN COALESCE(c.collection_hold, '') <> '' AND (c.hold_until IS NULL OR c.hold_until > ?) THEN 1 ELSE 0 END) AS held_jobs " +
    "FROM press_slot_job j LEFT JOIN press_crawl_state c ON c.source_id = j.source_id WHERE j.retryable = 1 AND j.closed_at IS NULL AND j.status <> 'succeeded'",
  ).bind(now, now, now).first<{ captured: number; closed_failed_jobs: number; open_jobs: number; oldest_slot_at: number | null; retry_waiting: number | null; next_retry_at: number | null; held_jobs: number | null }>();
  return {
    open_jobs: row?.open_jobs ?? 0,
    closed_failed_jobs: row?.closed_failed_jobs ?? 0,
    oldest_slot_at: row?.oldest_slot_at ? new Date(row.oldest_slot_at * 1000).toISOString() : '',
    retry_waiting: row?.retry_waiting ?? 0,
    next_retry_at: row?.next_retry_at ? new Date(row.next_retry_at * 1000).toISOString() : '',
    held_jobs: row?.held_jobs ?? 0,
    captured: row?.captured === 1,
    finished: row?.captured === 1 && row.open_jobs === 0,
    complete: row?.captured === 1 && row.open_jobs === 0 && row.closed_failed_jobs === 0,
    basis: '영속 원장에 등록된 미완료 회차 작업 수입니다. 즉시 실행 가능한 수집처 수와 구별합니다.',
  };
}
