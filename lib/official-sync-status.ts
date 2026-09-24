import { getD1 } from "./d1";
import { memoizeForTtl } from "./memo";
import {
  removeExtractedContinuationFragments,
  repairKnownExtractionFragments,
} from "./official-correction";
import type { OfficialService } from "./official-source";
import { repairExtractionSpacing } from "./official-spacing";
import { cachedWikiEdits } from "./wiki-edit-store";
import { applyWikiEdits } from "./wiki-edits";

// 가벼운 수집 상태·조회 함수만 모은다. 수집 실행(official-sync.ts)은 기준 자료
// 12MB를 품고 있어, 실제로 수집할 때만 동적으로 불러온다.

export const SYNC_INTERVAL_SECONDS = 24 * 60 * 60;
export const RUN_TIMEOUT_SECONDS = 30 * 60;
const PUBLIC_STATUS_TTL_MS = 15_000;

export type SyncTrigger = "automatic" | "manual";

interface SyncRunRow {
  id: string;
  trigger: string;
  status: string;
  started_at: number;
  completed_at: number | null;
  service_count: number;
  document_count: number;
  error: string;
}

export interface SyncRunInfo {
  id: string;
  trigger: string;
  status: string;
  startedAt: string;
  completedAt: string;
  serviceCount: number;
  documentCount: number;
  error: string;
}

export interface OfficialSyncStatus {
  running: boolean;
  stale: boolean;
  nextAutomaticSyncAt: string;
  latestSuccess: SyncRunInfo | null;
  latestAttempt: SyncRunInfo | null;
}

export interface OfficialSyncStart {
  started: boolean;
  runId: string;
}

export interface OfficialDatasetSnapshot {
  rows: OfficialService[];
  dataAsOf: string;
  completedAt: string;
  documentCount: number;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function iso(seconds: number | null): string {
  return seconds ? new Date(seconds * 1000).toISOString() : "";
}

function toRunInfo(row: SyncRunRow | null): SyncRunInfo | null {
  if (!row) return null;
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    serviceCount: row.service_count,
    documentCount: row.document_count,
    error: row.error,
  };
}

export async function readOfficialSyncStatus(): Promise<OfficialSyncStatus> {
  const db = getD1();
  const [latestSuccess, latestAttempt, running] = await Promise.all([
    db.prepare(
      "SELECT id, trigger, status, started_at, completed_at, service_count, document_count, error FROM official_sync_run WHERE status = 'succeeded' ORDER BY completed_at DESC LIMIT 1",
    ).first<SyncRunRow>(),
    db.prepare(
      "SELECT id, trigger, status, started_at, completed_at, service_count, document_count, error FROM official_sync_run ORDER BY started_at DESC LIMIT 1",
    ).first<SyncRunRow>(),
    db.prepare(
      "SELECT id, trigger, status, started_at, completed_at, service_count, document_count, error FROM official_sync_run WHERE status = 'running' AND started_at >= ? ORDER BY started_at DESC LIMIT 1",
    ).bind(nowSeconds() - RUN_TIMEOUT_SECONDS).first<SyncRunRow>(),
  ]);
  const completedAt = latestSuccess?.completed_at ?? 0;
  return {
    running: Boolean(running),
    stale: completedAt === 0 || completedAt < nowSeconds() - SYNC_INTERVAL_SECONDS,
    nextAutomaticSyncAt: completedAt ? iso(completedAt + SYNC_INTERVAL_SECONDS) : "",
    latestSuccess: toRunInfo(latestSuccess),
    latestAttempt: toRunInfo(latestAttempt),
  };
}

export const readPublicOfficialSyncStatus = memoizeForTtl(
  readOfficialSyncStatus,
  PUBLIC_STATUS_TTL_MS,
);

/** 자동 수집이 할 일이 있는지(기한이 지났거나 이어서 수집할 차례인지). */
export function needsAutomaticSync(status: OfficialSyncStatus): boolean {
  const continuing = status.latestAttempt?.error.startsWith("[계속 수집]") ?? false;
  return status.stale || continuing;
}

export async function readOfficialDataset(): Promise<OfficialDatasetSnapshot> {
  const db = getD1();
  const run = await db.prepare(
    "SELECT id, completed_at, document_count FROM official_sync_run WHERE status = 'succeeded' ORDER BY completed_at DESC LIMIT 1",
  ).first<{ id: string; completed_at: number; document_count: number }>();
  if (!run) return { rows: [], dataAsOf: "", completedAt: "", documentCount: 0 };

  const [services, documentDate, edits] = await Promise.all([
    db.prepare(
      "SELECT service_id AS serviceId, sido, sigungu, category, subcategory, name, description, target, detail_target AS detailTarget, application_method AS applicationMethod, provider, type, serial, detail_url AS detailUrl, updated_date AS updatedDate FROM official_service_snapshot WHERE sync_run_id = ? ORDER BY sido, sigungu, name",
    ).bind(run.id).all<OfficialService>(),
    db.prepare(
      "SELECT MAX(data_as_of) AS data_as_of FROM official_source_document WHERE sync_run_id = ?",
    ).bind(run.id).first<{ data_as_of: string | null }>(),
    cachedWikiEdits(),
  ]);
  const rows = applyWikiEdits(repairExtractionSpacing(
    removeExtractedContinuationFragments(
      repairKnownExtractionFragments(services.results ?? []),
    ),
  ), edits);
  return {
    rows: [...rows],
    dataAsOf: documentDate?.data_as_of ?? "",
    completedAt: iso(run.completed_at),
    documentCount: run.document_count,
  };
}

export async function beginOfficialSync(trigger: SyncTrigger): Promise<OfficialSyncStart> {
  const db = getD1();
  const now = nowSeconds();
  const runId = crypto.randomUUID();
  const lock = await db.prepare(
    "INSERT INTO official_sync_lock (id, run_id, expires_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET run_id = excluded.run_id, expires_at = excluded.expires_at WHERE official_sync_lock.expires_at < ? RETURNING run_id",
  ).bind(runId, now + RUN_TIMEOUT_SECONDS, now).first<{ run_id: string }>();
  if (lock?.run_id !== runId) return { started: false, runId: "" };

  try {
    await db.prepare(
      "UPDATE official_sync_run SET status = 'failed', completed_at = ?, error = '수집 제한 시간을 초과했습니다.' WHERE status = 'running' AND started_at < ?",
    ).bind(now, now - RUN_TIMEOUT_SECONDS).run();
    await db.prepare(
      "INSERT INTO official_sync_run (id, trigger, status, started_at, completed_at, service_count, document_count, error) VALUES (?, ?, 'running', ?, NULL, 0, 0, '')",
    ).bind(runId, trigger, now).run();
    return { started: true, runId };
  } catch (error) {
    await db.prepare("DELETE FROM official_sync_lock WHERE id = 1 AND run_id = ?").bind(runId).run();
    throw error;
  }
}

/** 수집 실행 모듈을 필요할 때만 불러와 이어서 실행한다. */
export async function executeOfficialSyncLazily(runId: string): Promise<OfficialSyncStatus> {
  const { executeOfficialSync } = await import("./official-sync");
  return executeOfficialSync(runId);
}
