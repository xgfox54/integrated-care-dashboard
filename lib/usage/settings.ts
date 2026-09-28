// 이용통계 수집 켜기·끄기와 운영 상태. 기본값은 꺼짐이다(관리자가 켜기 전에는 공개 화면이 아무것도 보내지 않는다).
// 배포 환경변수 USAGE_COLLECTION=off면 관리자 설정과 관계없이 수집을 멈춘다.
import { env } from "cloudflare:workers";

import { getD1 } from "../d1";

const ENABLED_KEY = "usage_enabled";
const MEMO_TTL_MS = 30_000;

let memo: { readonly value: boolean; readonly expiresAt: number } | null = null;

export function usageKillSwitchOn(): boolean {
  return (env as { USAGE_COLLECTION?: string }).USAGE_COLLECTION === "off";
}

/** 수집 중인지. 표가 아직 없거나 읽지 못하면 꺼진 것으로 본다. */
export async function readUsageEnabled(fresh = false): Promise<boolean> {
  if (usageKillSwitchOn()) return false;
  const now = Date.now();
  if (!fresh && memo && memo.expiresAt > now) return memo.value;
  let value = false;
  try {
    const row = await getD1().prepare("SELECT value FROM app_setting WHERE key = ?").bind(ENABLED_KEY).first<{ value: string }>();
    value = row?.value === "1";
  } catch {
    value = false;
  }
  memo = { value, expiresAt: now + MEMO_TTL_MS };
  return value;
}

/** 관리자가 수집을 켜거나 끈다. 켜고 끈 시각을 남겨 「수집 전」·「수집 중지」 기간을 구분한다. */
export async function writeUsageEnabled(enabled: boolean): Promise<void> {
  const db = getD1();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .bind(ENABLED_KEY, enabled ? "1" : "0", Math.floor(now / 1000)),
    enabled
      ? db
          .prepare(
            "INSERT INTO usage_collection_period (started_at) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM usage_collection_period WHERE ended_at IS NULL)",
          )
          .bind(now)
      : db.prepare("UPDATE usage_collection_period SET ended_at = ? WHERE ended_at IS NULL").bind(now),
  ]);
  memo = { value: enabled, expiresAt: now + MEMO_TTL_MS };
}

export interface CollectionPeriod {
  readonly startedAt: number;
  readonly endedAt: number | null;
}

export interface CleanupStatus {
  readonly at: number;
  readonly ok: boolean;
  readonly tempDeleted: number;
  readonly aggregateDeleted: number;
}

export interface UsageOperationStatus {
  readonly enabled: boolean;
  readonly killSwitch: boolean;
  readonly periods: readonly CollectionPeriod[];
  readonly lastIngestAt: number | null;
  readonly cleanup: CleanupStatus | null;
  readonly tempRows: number;
}

export async function readUsageOperationStatus(): Promise<UsageOperationStatus> {
  const db = getD1();
  const [enabled, periods, settings, temp] = await Promise.all([
    readUsageEnabled(true),
    db
      .prepare("SELECT started_at AS startedAt, ended_at AS endedAt FROM usage_collection_period ORDER BY started_at")
      .all<{ startedAt: number; endedAt: number | null }>(),
    db
      .prepare("SELECT key, value FROM app_setting WHERE key IN ('usage_last_ingest_at', 'usage_cleanup_result')")
      .all<{ key: string; value: string }>(),
    db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM usage_seen_event) + (SELECT COUNT(*) FROM usage_temp_search) + " +
          "(SELECT COUNT(*) FROM usage_temp_measure) + (SELECT COUNT(*) FROM usage_temp_op) AS n",
      )
      .first<{ n: number }>(),
  ]);
  const map = new Map((settings.results ?? []).map((row) => [row.key, row.value]));
  let cleanup: CleanupStatus | null = null;
  try {
    const parsed = JSON.parse(map.get("usage_cleanup_result") ?? "null") as CleanupStatus | null;
    cleanup = parsed && typeof parsed.at === "number" ? parsed : null;
  } catch {
    cleanup = null;
  }
  const lastIngest = Number(map.get("usage_last_ingest_at") ?? "");
  return {
    enabled,
    killSwitch: usageKillSwitchOn(),
    periods: (periods.results ?? []).map((row) => ({ startedAt: Number(row.startedAt), endedAt: row.endedAt === null ? null : Number(row.endedAt) })),
    lastIngestAt: Number.isFinite(lastIngest) && lastIngest > 0 ? lastIngest : null,
    cleanup,
    tempRows: Number(temp?.n ?? 0),
  };
}
