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
import { claimSyncStep, RUN_STALL_SECONDS, type SyncStepClaim, type SyncTrigger } from "./official-sync-claim";
import type { StepOutcome } from "./official-sync-steps";

// 가벼운 수집 상태·조회 함수만 모은다. 수집 실행(official-sync.ts)은 기준 자료
// 12MB를 품고 있어, 실제로 수집할 때만 동적으로 불러온다.

export const SYNC_INTERVAL_SECONDS = 24 * 60 * 60;
const PUBLIC_STATUS_TTL_MS = 15_000;
/** 서버 인스턴스마다 이 간격으로만 수집할 일이 있는지 확인한다(모든 요청마다 DB를 두드리지 않게). */
const BACKGROUND_CHECK_INTERVAL_MS = 20_000;

export type { SyncStepClaim, SyncTrigger };

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
      "SELECT id, trigger, status, started_at, completed_at, service_count, document_count, error FROM official_sync_run WHERE status = 'running' AND advanced_at >= ? ORDER BY started_at DESC LIMIT 1",
    ).bind(nowSeconds() - RUN_STALL_SECONDS).first<SyncRunRow>(),
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

/** 자동 수집이 할 일이 있는지(기한이 지났거나 진행 중인 수집을 이어서 할 차례인지). */
export function needsAutomaticSync(status: OfficialSyncStatus): boolean {
  return status.stale || status.running;
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

/** 수집 한 단계의 실행권을 얻는다. 할 일이 없거나 다른 요청이 실행 중이면 null. */
export function claimOfficialSyncStep(trigger: SyncTrigger, status: OfficialSyncStatus): Promise<SyncStepClaim | null> {
  return claimSyncStep(getD1(), {
    trigger,
    stale: status.stale,
    now: nowSeconds(),
    lease: crypto.randomUUID(),
    newRunId: crypto.randomUUID(),
  });
}

/** 수집 실행 모듈을 필요할 때만 불러와 한 단계를 이어서 한다. */
export async function runOfficialSyncStepLazily(claim: SyncStepClaim): Promise<StepOutcome> {
  const { runOfficialSyncStep } = await import("./official-sync");
  return runOfficialSyncStep(claim);
}

let lastBackgroundCheckAt = 0;

/**
 * 요청 응답 뒤(waitUntil)에 부른다. 이 호스팅에서는 예약 작업이 돌지 않아, 방문 요청이 수집을 조금씩 잇는다.
 * 기한이 지났거나 진행 중인 수집이 있을 때만 실행권을 얻어 한 단계를 한다.
 */
export async function advanceOfficialSyncInBackground(): Promise<void> {
  const nowMs = Date.now();
  if (nowMs - lastBackgroundCheckAt < BACKGROUND_CHECK_INTERVAL_MS) return;
  lastBackgroundCheckAt = nowMs;
  const status = await readPublicOfficialSyncStatus();
  if (!needsAutomaticSync(status)) return;
  const claim = await claimOfficialSyncStep("automatic", status);
  if (claim) await runOfficialSyncStepLazily(claim);
}
