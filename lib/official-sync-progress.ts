import type { SqlDatabase, SqlStatement } from "./sql-database.ts";

export const SYNC_STAGES = ["documents", "previews", "api", "store", "promote"] as const;
export type SyncStage = (typeof SYNC_STAGES)[number];

/** 수집 진행 위치(official_sync_run.progress JSON). */
export interface SyncProgress {
  readonly province: number;
  readonly apiTerm: number;
  readonly apiPage: number;
  readonly apiPages: number;
  readonly apiSkipped: boolean;
  readonly stored: number;
  readonly total: number;
  readonly failures: number;
}

function count(record: object, key: string): number {
  const value: unknown = Reflect.get(record, key);
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

export function parseSyncProgress(text: string): SyncProgress {
  let value: unknown = {};
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  const record = typeof value === "object" && value !== null ? value : {};
  return {
    province: count(record, "province"),
    apiTerm: count(record, "apiTerm"),
    apiPage: count(record, "apiPage"),
    apiPages: count(record, "apiPages"),
    apiSkipped: Reflect.get(record, "apiSkipped") === true,
    stored: count(record, "stored"),
    total: count(record, "total"),
    failures: count(record, "failures"),
  };
}

export async function readSyncProgress(
  db: SqlDatabase,
  runId: string,
): Promise<{ readonly stage: SyncStage; readonly progress: SyncProgress } | null> {
  const row = await db.prepare(
    "SELECT stage, progress FROM official_sync_run WHERE id = ? AND status = 'running'",
  ).bind(runId).first<{ stage: string; progress: string }>();
  if (!row) return null;
  const stage = SYNC_STAGES.find((candidate) => candidate === row.stage) ?? "documents";
  return { stage, progress: parseSyncProgress(row.progress) };
}

/** 작업 단위의 결과와 같은 batch로 저장할 진행 위치. */
export function runUnitStatements(
  db: SqlDatabase,
  runId: string,
  stage: SyncStage,
  progress: SyncProgress,
  now: number,
): SqlStatement[] {
  return [
    db.prepare(
      "UPDATE official_sync_run SET stage = ?, progress = ?, advanced_at = ? WHERE id = ? AND status = 'running'",
    ).bind(stage, JSON.stringify(progress), now, runId),
  ];
}
