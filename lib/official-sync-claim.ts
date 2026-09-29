import type { SqlDatabase } from "./sql-database.ts";

// 수집은 여러 요청에 걸쳐 짧은 단계로 이어서 진행한다. 한 번에 한 요청만 단계를 실행하도록
// official_sync_lock(한 행)을 짧은 실행권으로 쓴다. 이 모듈은 가볍게 유지한다(기준 자료를 불러오지 않는다).

export type SyncTrigger = "automatic" | "manual";

/** 단계 실행권 유효 시간. 실행 중 요청이 끊겨도 이 시간이 지나면 다음 요청이 이어받는다. */
export const STEP_LEASE_SECONDS = 120;
/** 이 시간 동안 한 단계도 나아가지 못한 수집은 실패로 정리하고 새로 시작한다. */
export const RUN_STALL_SECONDS = 6 * 60 * 60;

export interface SyncStepClaim {
  readonly runId: string;
  readonly lease: string;
}

export interface ClaimOptions {
  readonly trigger: SyncTrigger;
  readonly stale: boolean;
  readonly now: number;
  readonly lease: string;
  readonly newRunId: string;
}

const STALLED_RUNS = "SELECT id FROM official_sync_run WHERE status = 'running' AND advanced_at < ?";

export async function claimSyncStep(db: SqlDatabase, options: ClaimOptions): Promise<SyncStepClaim | null> {
  const lock = await db.prepare(
    "INSERT INTO official_sync_lock (id, run_id, expires_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET run_id = excluded.run_id, expires_at = excluded.expires_at WHERE official_sync_lock.expires_at < ? RETURNING run_id",
  ).bind(options.lease, options.now + STEP_LEASE_SECONDS, options.now).first<{ run_id: string }>();
  if (lock?.run_id !== options.lease) return null;

  const stalledBefore = options.now - RUN_STALL_SECONDS;
  await db.batch([
    db.prepare(`DELETE FROM official_service_snapshot WHERE sync_run_id IN (${STALLED_RUNS})`).bind(stalledBefore),
    db.prepare(`DELETE FROM official_source_document WHERE sync_run_id IN (${STALLED_RUNS})`).bind(stalledBefore),
    db.prepare(`DELETE FROM official_sync_api_page WHERE run_id IN (${STALLED_RUNS})`).bind(stalledBefore),
    db.prepare(
      "UPDATE official_sync_run SET status = 'failed', completed_at = ?, error = '수집이 오래 멈춰 정리했습니다.' WHERE status = 'running' AND advanced_at < ?",
    ).bind(options.now, stalledBefore),
  ]);

  const running = await db.prepare(
    "SELECT id FROM official_sync_run WHERE status = 'running' ORDER BY started_at DESC LIMIT 1",
  ).first<{ id: string }>();
  if (running) return { runId: running.id, lease: options.lease };

  if (options.trigger === "automatic" && !options.stale) {
    await releaseSyncStep(db, options.lease);
    return null;
  }
  await db.prepare(
    "INSERT INTO official_sync_run (id, trigger, status, started_at, completed_at, service_count, document_count, error, stage, progress, advanced_at) VALUES (?, ?, 'running', ?, NULL, 0, 0, '', 'documents', '{}', ?)",
  ).bind(options.newRunId, options.trigger, options.now, options.now).run();
  return { runId: options.newRunId, lease: options.lease };
}

export async function releaseSyncStep(db: SqlDatabase, lease: string): Promise<void> {
  await db.prepare("DELETE FROM official_sync_lock WHERE id = 1 AND run_id = ?").bind(lease).run();
}
