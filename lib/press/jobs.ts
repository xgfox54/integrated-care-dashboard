import type { SqlDatabase } from "../sql-database.ts";
import { nextCollectionSlot, previousCollectionSlot } from "./schedule.ts";
import type { PressLease } from "./jobs-fence.ts";

const MAX_CATCHUP_SLOTS = 32;

/** Capture immutable membership once per slot. First activation starts now, never inventing historical success. */
export async function ensurePressSlots(db: SqlDatabase, now: number): Promise<void> {
  const current = previousCollectionSlot(now);
  const checkpoint = await db.prepare("SELECT slot_at FROM press_slot_checkpoint WHERE id = 1").first<{ slot_at: number }>();
  let slot = checkpoint ? nextCollectionSlot(checkpoint.slot_at) : current;
  for (let count = 0; count < MAX_CATCHUP_SLOTS && slot <= current; count++, slot = nextCollectionSlot(slot)) {
    await db.batch([
      db.prepare("INSERT INTO press_slot_job (source_id, slot_at, collect_via, registry_version, endpoint_url, updated_at) SELECT source_id, ?, collect_via, registry_version, endpoint_url, ? FROM press_source WHERE enabled = 1 AND approval_status = 'POLICY_APPROVED' AND NOT EXISTS (SELECT 1 FROM press_slot WHERE slot_at = ?)").bind(slot, now, slot),
      db.prepare("INSERT OR IGNORE INTO press_slot (slot_at, captured_at) VALUES (?, ?)").bind(slot, now),
      db.prepare("INSERT INTO press_slot_checkpoint (id, slot_at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET slot_at = MAX(slot_at, excluded.slot_at)").bind(slot),
    ]);
  }
  await recoverPressAttempts(db, now);
}

export async function recoverPressAttempts(db: SqlDatabase, now: number): Promise<void> {
  await db.batch([
    db.prepare("UPDATE press_job_attempt SET status = 'abandoned', finished_at = ?, error_code = 'LEASE_EXPIRED' WHERE status = 'running' AND NOT EXISTS (SELECT 1 FROM press_crawl_state c JOIN press_host_lease h ON h.host = press_job_attempt.host WHERE c.source_id = press_job_attempt.source_id AND c.lease_token = press_job_attempt.lease_token AND h.lease_token = press_job_attempt.lease_token AND c.lease_expires_at > ? AND h.lease_expires_at > ?)").bind(now, now, now),
    db.prepare("UPDATE press_slot_job SET status = 'pending', updated_at = ? WHERE status = 'running' AND EXISTS (SELECT 1 FROM press_job_attempt a WHERE a.run_id = press_slot_job.attempt_id AND a.status = 'abandoned')").bind(now),
  ]);
  await closeDuePressJobs(db, now);
}

export async function closeDuePressJobs(db: SqlDatabase, now: number): Promise<void> {
  await db.prepare(
    "UPDATE press_slot_job SET status = 'failed', retryable = 0, closed_at = ?, updated_at = ?, " +
    "close_reason = CASE WHEN (SELECT COUNT(*) FROM press_job_attempt a WHERE a.source_id = press_slot_job.source_id AND a.slot_at = press_slot_job.slot_at) >= 8 THEN 'ATTEMPT_LIMIT_REACHED' ELSE 'RETRY_DEADLINE_REACHED' END, " +
    "error_code = CASE WHEN (SELECT COUNT(*) FROM press_job_attempt a WHERE a.source_id = press_slot_job.source_id AND a.slot_at = press_slot_job.slot_at) >= 8 THEN 'ATTEMPT_LIMIT_REACHED' ELSE 'RETRY_DEADLINE_REACHED' END " +
    "WHERE retryable = 1 AND closed_at IS NULL AND status <> 'succeeded' AND COALESCE(next_retry_at, 0) <= ? " +
    "AND EXISTS (SELECT 1 FROM press_crawl_state c WHERE c.source_id = press_slot_job.source_id AND c.lease_expires_at <= ? AND c.next_due_at <= ? AND (c.collection_hold = '' OR c.hold_until <= ?)) " +
    "AND EXISTS (SELECT 1 FROM press_job_attempt a WHERE a.source_id = press_slot_job.source_id AND a.slot_at = press_slot_job.slot_at GROUP BY a.source_id, a.slot_at HAVING COUNT(*) >= 8 OR MIN(a.started_at) <= ?)",
  ).bind(now, now, now, now, now, now, now - 86400).run();
}

export interface PressAttempt {
  readonly runId: string;
  readonly sourceId: string;
  readonly slotAt: number | null;
}

/** Caller owns source and host leases and passes the fenced DB. */
export async function startPressAttempt(db: SqlDatabase, lease: PressLease, runId: string): Promise<PressAttempt> {
  const job = await db.prepare("SELECT slot_at FROM press_slot_job WHERE source_id = ? AND status <> 'succeeded' AND retryable = 1 AND closed_at IS NULL ORDER BY slot_at LIMIT 1").bind(lease.sourceId).first<{ slot_at: number }>();
  const attempt = { runId, sourceId: lease.sourceId, slotAt: job?.slot_at ?? null };
  await db.batch([
    db.prepare("INSERT INTO press_job_attempt (run_id, source_id, slot_at, lease_token, host, started_at, status) VALUES (?, ?, ?, ?, ?, ?, 'running')").bind(runId, lease.sourceId, attempt.slotAt, lease.token, lease.host, lease.now()),
    db.prepare("UPDATE press_slot_job SET status = 'running', attempt_id = ?, updated_at = ? WHERE source_id = ? AND slot_at = ?").bind(runId, lease.now(), lease.sourceId, attempt.slotAt),
  ]);
  return attempt;
}

export async function finishPressAttempt(db: SqlDatabase, attempt: PressAttempt, outcome: { readonly status: string; readonly errorCode: string; readonly now: number }): Promise<void> {
  const state = await db.prepare("SELECT collection_hold, hold_until, hold_reason, next_due_at FROM press_crawl_state WHERE source_id = ?").bind(attempt.sourceId).first<{ collection_hold: string; hold_until: number | null; hold_reason: string; next_due_at: number }>();
  const held = state?.collection_hold && (state.hold_until === null || state.hold_until > outcome.now);
  const status = outcome.status === 'succeeded' || outcome.status === 'not_modified' ? 'succeeded' : held ? 'held' : 'failed';
  await db.batch([
    db.prepare("UPDATE press_job_attempt SET status = ?, finished_at = ?, error_code = ? WHERE run_id = ? AND status = 'running'").bind(status, outcome.now, outcome.errorCode, attempt.runId),
    db.prepare("UPDATE press_slot_job SET status = ?, updated_at = ?, error_code = ?, hold_reason = ?, next_retry_at = ? WHERE source_id = ? AND slot_at = ? AND attempt_id = ?").bind(status, outcome.now, outcome.errorCode, state?.hold_reason ?? '', status === 'succeeded' ? null : state?.next_due_at ?? null, attempt.sourceId, attempt.slotAt, attempt.runId),
    ...(status === 'succeeded' ? [db.prepare("UPDATE press_slot_job SET retryable = 0, closed_at = ? WHERE source_id = ? AND slot_at = ? AND attempt_id = ?").bind(outcome.now, attempt.sourceId, attempt.slotAt, attempt.runId)] : []),
    ...(status === 'succeeded' ? [db.prepare("UPDATE press_crawl_state SET next_due_at = ? WHERE source_id = ? AND EXISTS (SELECT 1 FROM press_slot_job j WHERE j.source_id = press_crawl_state.source_id AND j.status <> 'succeeded' AND j.retryable = 1 AND j.closed_at IS NULL)").bind(outcome.now, attempt.sourceId)] : []),
    ...(status === 'succeeded' && attempt.slotAt !== null ? [db.prepare("UPDATE press_crawl_state SET next_due_at = MIN(next_due_at, ?) WHERE source_id = ?").bind(nextCollectionSlot(attempt.slotAt), attempt.sourceId)] : []),
  ]);
}

interface JobStatusRow { readonly collect_via: string; readonly status: string; readonly closed_at: number | null; readonly lease_live: number; readonly held: number; }

export async function readPressSlotStatus(db: SqlDatabase, slotAt: number, now: number) {
  const slot = await db.prepare("SELECT slot_at FROM press_slot WHERE slot_at = ?").bind(slotAt).first<{ slot_at: number }>();
  const rows = await db.prepare(
    "SELECT j.collect_via, j.status, j.closed_at, CASE WHEN a.status = 'running' AND c.lease_token = a.lease_token AND h.lease_token = a.lease_token AND c.lease_expires_at > ? AND h.lease_expires_at > ? THEN 1 ELSE 0 END AS lease_live, " +
    "CASE WHEN s.enabled = 0 OR s.approval_status <> 'POLICY_APPROVED' OR (COALESCE(c.collection_hold, '') <> '' AND (c.hold_until IS NULL OR c.hold_until > ?)) THEN 1 ELSE 0 END AS held " +
    "FROM press_slot_job j JOIN press_source s ON s.source_id = j.source_id LEFT JOIN press_crawl_state c ON c.source_id = j.source_id LEFT JOIN press_job_attempt a ON a.run_id = j.attempt_id LEFT JOIN press_host_lease h ON h.host = a.host WHERE j.slot_at = ?",
  ).bind(now, now, now, slotAt).all<JobStatusRow>();
  const summarize = (via: string | null) => {
    const jobs = rows.results.filter((job) => via === null || job.collect_via === via);
    const counts = { sources: jobs.length, succeeded: 0, failed: 0, held: 0, running: 0, not_run: 0 };
    for (const job of jobs) {
      if (job.status === 'succeeded') counts.succeeded++;
      else if (job.closed_at !== null) counts.failed++;
      else if (job.lease_live) counts.running++;
      else if (job.status === 'held' || job.held) counts.held++;
      else if (job.status === 'failed' || job.status === 'running') counts.failed++;
      else counts.not_run++;
    }
    return { ...counts, completion: !slot ? 'NOT_CAPTURED' : counts.running || counts.not_run ? 'IN_PROGRESS' : counts.failed || counts.held ? 'ERRORS_REMAIN' : 'ALL_SUCCEEDED', basis: slot ? '회차 최초 포착 시 고정한 Source 대상과 실제 시도 원장 기준' : '원장 도입 전 또는 아직 포착하지 않은 회차: 성공을 추정하지 않음' };
  };
  return { server: summarize('server'), relay: summarize('relay'), combined: summarize(null) };
}
