// 이용통계 정리 작업: 만료된 단기 처리 상태를 지우고, 24개월이 지난 일별 집계를 지운다.
// 매시 정각 예약 작업과 수집 요청(마지막 정리 뒤 70분이 지났을 때)에서 실행한다.
import { getD1 } from "../d1";
import { AGGREGATE_RETENTION_DAYS, kstDay, shiftDay } from "./codes";
import type { CleanupStatus } from "./settings";

const TEMP_TABLES = ["usage_seen_event", "usage_temp_search", "usage_temp_measure", "usage_temp_op"] as const;
const DAILY_TABLES = [
  "usage_daily_page",
  "usage_daily_screen",
  "usage_daily_tab",
  "usage_daily_entity",
  "usage_daily_route",
  "usage_daily_duration",
  "usage_daily_search",
  "usage_daily_filter",
  "usage_daily_action",
  "usage_daily_error",
  "usage_daily_perf",
] as const;
const CLEANUP_INTERVAL_MS = 70 * 60_000;

function changes(result: unknown): number {
  const record = result as { meta?: { changes?: number }; changes?: number | bigint } | null;
  return Number(record?.meta?.changes ?? record?.changes ?? 0);
}

export async function runUsageCleanup(now = Date.now()): Promise<CleanupStatus> {
  const db = getD1();
  const cutoff = shiftDay(kstDay(now), -AGGREGATE_RETENTION_DAYS);
  let status: CleanupStatus;
  try {
    const results = await db.batch([
      ...TEMP_TABLES.map((table) => db.prepare("DELETE FROM " + table + " WHERE expires_at <= ?").bind(now)),
      ...DAILY_TABLES.map((table) => db.prepare("DELETE FROM " + table + " WHERE day < ?").bind(cutoff)),
    ]);
    const tempDeleted = results.slice(0, TEMP_TABLES.length).reduce<number>((sum, result) => sum + changes(result), 0);
    const aggregateDeleted = results.slice(TEMP_TABLES.length).reduce<number>((sum, result) => sum + changes(result), 0);
    status = { at: now, ok: true, tempDeleted, aggregateDeleted };
  } catch {
    status = { at: now, ok: false, tempDeleted: 0, aggregateDeleted: 0 };
  }
  await db
    .prepare(
      "INSERT INTO app_setting (key, value, updated_at) VALUES ('usage_cleanup_result', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(JSON.stringify(status), Math.floor(now / 1000))
    .run()
    .catch(() => undefined);
  return status;
}

/** 마지막 정리 뒤 70분이 지났으면 정리한다(예약 작업이 멈춰도 24시간 상한을 지키기 위한 보조 경로). */
export async function runUsageCleanupIfDue(now = Date.now()): Promise<void> {
  const row = await getD1()
    .prepare("SELECT value FROM app_setting WHERE key = 'usage_cleanup_result'")
    .first<{ value: string }>()
    .catch(() => null);
  let last = 0;
  try {
    last = Number((JSON.parse(row?.value ?? "null") as CleanupStatus | null)?.at ?? 0);
  } catch {
    last = 0;
  }
  if (now - last >= CLEANUP_INTERVAL_MS) await runUsageCleanup(now);
}

