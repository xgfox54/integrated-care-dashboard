import { getD1 } from "./d1";
import { warmDatasetCache } from "./dataset-responses";
import { collectProvinceDocuments } from "./mohw-board";
import { collectMohwDocumentServices } from "./mohw-preview";
import { isIntegratedCareRecord, toOfficialService } from "./official-source";
import { releaseSyncStep, type SyncStepClaim } from "./official-sync-claim";
import { API_PAGE_SIZE, advanceSyncRun, type ApiPageResult, type StepOutcome, type SyncSources } from "./official-sync-steps";
import {
  claimOfficialSyncStep,
  needsAutomaticSync,
  readOfficialSyncStatus,
  type OfficialSyncStatus,
  type SyncTrigger,
} from "./official-sync-status";
import { callWelfareList } from "./welfare-api";

// 수집 실행 전용 모듈. 보건복지부 기준 자료(data/*.json, 약 12MB)를 품고 있으므로
// 화면·API 요청 경로에서는 정적으로 불러오지 말고 official-sync-status.ts의 동적 import로만 연다.

/** 요청 뒤(waitUntil)에 한 단계를 이어서 하는 시간. 이 시간이 지나면 새 작업 단위를 시작하지 않는다. */
const STEP_BUDGET_MS = 15_000;
/** 예약 작업(있을 때)은 더 오래 이어서 한다. */
const SCHEDULED_BUDGET_MS = 10 * 60_000;

async function readApiPage(term: string, page: number): Promise<ApiPageResult> {
  try {
    const result = await callWelfareList({ keyword: term, pageNo: page, numOfRows: API_PAGE_SIZE });
    if (!result.ok) return { kind: "unavailable", reason: `${result.resultCode || result.httpStatus} ${result.resultMsg}` };
    return { kind: "page", totalCount: result.totalCount, services: result.items.filter(isIntegratedCareRecord).map(toOfficialService) };
  } catch (error) {
    if (error instanceof Error) return { kind: "unavailable", reason: error.message };
    throw error;
  }
}

const LIVE_SOURCES: SyncSources = {
  listProvinceDocuments: collectProvinceDocuments,
  readDocumentServices: collectMohwDocumentServices,
  readApiPage,
};

export async function runOfficialSyncStep(claim: SyncStepClaim, budgetMs = STEP_BUDGET_MS): Promise<StepOutcome> {
  const db = getD1();
  const startedAt = Date.now();
  let outcome: StepOutcome;
  try {
    outcome = await advanceSyncRun(db, LIVE_SOURCES, claim.runId, { deadline: startedAt + budgetMs, nowMs: Date.now });
  } finally {
    await releaseSyncStep(db, claim.lease);
  }
  // 새 자료로 바뀌었으면 첫 방문자가 기다리지 않도록 요약·지역 묶음을 미리 계산해 둔다.
  if (outcome === "succeeded") await warmDatasetCache().catch(() => undefined);
  return outcome;
}

/** 예약 작업·수동 실행용: 끝나거나 멈출 때까지 단계를 잇는다. */
export async function runOfficialSync(trigger: SyncTrigger): Promise<OfficialSyncStatus> {
  const deadline = Date.now() + SCHEDULED_BUDGET_MS;
  let nextTrigger = trigger;
  while (Date.now() < deadline) {
    const status = await readOfficialSyncStatus();
    if (nextTrigger === "automatic" && !needsAutomaticSync(status)) break;
    const claim = await claimOfficialSyncStep(nextTrigger, status);
    if (!claim) break;
    const outcome = await runOfficialSyncStep(claim, Math.max(1_000, deadline - Date.now()));
    if (outcome !== "continuing") break;
    nextTrigger = "automatic";
  }
  return readOfficialSyncStatus();
}
