import type { SqlDatabase, SqlStatement } from "./sql-database.ts";

// 사업 수록 원장(작업지시서 v5 §7·T09): 수집이 성공해 승격될 때 직전 성공 실행과 비교해 신규·개정·누락을 남긴다.
// 빠진 사업은 폐지·종료로 단정하지 않고 MISSING_FROM_LATEST_SOURCE로 둔다. 원천에 시행·종료·예정일이 없어 effective_*는 unknown이다.

const KEY = "service_id || '|' || sido || '|' || sigungu || '|' || name";
const PREVIOUS_RUN =
  "(SELECT id FROM official_sync_run WHERE status = 'succeeded' AND id <> ? AND EXISTS (SELECT 1 FROM official_service_snapshot x WHERE x.sync_run_id = official_sync_run.id) ORDER BY completed_at DESC LIMIT 1)";
const CONTENT_CHANGED = ["description", "target", "detail_target", "application_method", "provider", "type", "category", "subcategory"].map((column) => "n." + column + " IS NOT p." + column).join(" OR ");

/** 승격 batch에 넣을 문장들. 이전 실행 자료를 지우는 문장보다 앞에 둔다. */
export function presenceStatements(db: SqlDatabase, runId: string, now: number): SqlStatement[] {
  return [
    db.prepare(
      "UPDATE service_presence SET revised_run = ?, revised_at = ? WHERE presence_key IN (SELECT n.service_id || '|' || n.sido || '|' || n.sigungu || '|' || n.name FROM official_service_snapshot n " +
        "JOIN official_service_snapshot p ON p.sync_run_id = " + PREVIOUS_RUN + " AND p.sido = n.sido AND p.sigungu = n.sigungu AND p.name = n.name AND p.service_id = n.service_id " +
        "WHERE n.sync_run_id = ? AND (" + CONTENT_CHANGED + "))",
    ).bind(runId, now, runId, runId),
    db.prepare(
      "INSERT INTO service_presence (presence_key, service_id, sido, sigungu, name, status, first_seen_run, first_seen_at, last_seen_run, last_seen_at) " +
        "SELECT " + KEY + ", service_id, sido, sigungu, name, 'LISTED', ?, ?, ?, ? FROM official_service_snapshot WHERE sync_run_id = ? GROUP BY " + KEY + " " +
        "ON CONFLICT(presence_key) DO UPDATE SET status = 'LISTED', last_seen_run = excluded.last_seen_run, last_seen_at = excluded.last_seen_at, missing_since = NULL",
    ).bind(runId, now, runId, now, runId),
    db.prepare("UPDATE service_presence SET status = 'MISSING_FROM_LATEST_SOURCE', missing_since = COALESCE(missing_since, ?) WHERE last_seen_run <> ?").bind(now, runId),
    db.prepare(
      "INSERT OR REPLACE INTO service_presence_run (run_id, previous_run_id, recorded_at, listed, new_count, revised_count, missing_count) VALUES (?, " +
        // 원장 첫 기록(기준선)에는 비교 대상이 없다.
        "CASE WHEN EXISTS (SELECT 1 FROM service_presence_run WHERE run_id <> ?) THEN " + PREVIOUS_RUN + " ELSE NULL END, ?, " +
        "(SELECT COUNT(*) FROM service_presence WHERE last_seen_run = ?), (SELECT COUNT(*) FROM service_presence WHERE first_seen_run = ?), " +
        "(SELECT COUNT(*) FROM service_presence WHERE revised_run = ?), (SELECT COUNT(*) FROM service_presence WHERE status = 'MISSING_FROM_LATEST_SOURCE'))",
    ).bind(runId, runId, runId, now, runId, runId, runId),
  ];
}

export interface PresenceRow {
  readonly service_id: string;
  readonly sido: string;
  readonly sigungu: string;
  readonly name: string;
  readonly status: string;
  readonly first_seen_run: string;
  readonly first_seen_at: number;
  readonly last_seen_run: string;
  readonly last_seen_at: number;
  readonly revised_run: string | null;
  readonly revised_at: number | null;
  readonly missing_since: number | null;
}

export interface PresenceRunRow {
  readonly run_id: string;
  readonly previous_run_id: string | null;
  readonly recorded_at: number;
  readonly listed: number;
  readonly new_count: number;
  readonly revised_count: number;
  readonly missing_count: number;
}

const iso = (seconds: number | null) => (seconds ? new Date(seconds * 1000).toISOString() : null);

/** 원장이 시작된 실행(직전 실행이 없던 첫 기록). 그 실행에서 처음 본 사업은 「원장 시작 이전부터」로 표시한다. */
export async function presenceBaseline(db: SqlDatabase): Promise<PresenceRunRow | null> {
  return db.prepare("SELECT * FROM service_presence_run ORDER BY recorded_at ASC, run_id LIMIT 1").first<PresenceRunRow>();
}

export async function presenceRun(db: SqlDatabase, runId: string): Promise<PresenceRunRow | null> {
  return db.prepare("SELECT * FROM service_presence_run WHERE run_id = ?").bind(runId).first<PresenceRunRow>();
}

/** 같은 원자료 사업 ID의 원장 행(정규화한 ID로 찾는다). */
export async function presenceByServiceId(db: SqlDatabase, normalizedServiceId: string): Promise<PresenceRow[]> {
  return (await db.prepare("SELECT * FROM service_presence WHERE LOWER(REPLACE(REPLACE(service_id, ':', ''), '-', '')) = ? ORDER BY last_seen_at DESC LIMIT 32").bind(normalizedServiceId).all<PresenceRow>()).results;
}

export function temporalDto(row: PresenceRow | null, baseline: PresenceRunRow | null, runId: string) {
  const fromBaseline = Boolean(row && baseline && row.first_seen_run === baseline.run_id);
  return {
    listing_status: row ? (row.last_seen_run === runId ? "LISTED" : row.status) : "NOT_IN_LEDGER",
    first_listed_at: row && !fromBaseline ? iso(row.first_seen_at) : null,
    first_listed_basis: !row ? "원장 기록 전" : fromBaseline ? "원장 시작(" + iso(baseline?.recorded_at ?? null) + ") 이전부터 수록" : "이 실행에서 처음 수록",
    last_listed_at: row ? iso(row.last_seen_at) : null,
    revised_at: row?.revised_at ? iso(row.revised_at) : null,
    revised_basis: "직전 수집과 비교한 원자료 내용(설명·대상·신청방법·제공기관·유형·분류) 변경. 법적 개정일이 아닙니다.",
    missing_since: row?.missing_since ? iso(row.missing_since) : null,
    effective_from: null, effective_to: null, effective_status: "unknown",
    effective_basis: "원천 사업안내에 시행·종료·예정일이 없어 알 수 없습니다. 수집일을 시행일로 쓰지 않습니다.",
  };
}

export function presenceSummaryDto(run: PresenceRunRow | null, baseline: PresenceRunRow | null) {
  if (!run) return { status: "NOT_RECORDED_FOR_THIS_RUN", note: "사업 수록 원장은 이 기능 배포 뒤 처음 승격되는 수집부터 기록됩니다." };
  return {
    status: run.previous_run_id ? "COMPARED_WITH_PREVIOUS_RUN" : "BASELINE",
    ledger_started_at: iso(baseline?.recorded_at ?? null),
    compared_with_run: run.previous_run_id,
    listed: run.listed, new_in_this_run: run.previous_run_id ? run.new_count : null, revised_in_this_run: run.previous_run_id ? run.revised_count : null,
    missing_from_latest_source: run.missing_count,
    note: "빠진 사업은 폐지·종료로 단정하지 않습니다(MISSING_FROM_LATEST_SOURCE). 시행·종료·예정일은 원천에 없어 unknown입니다.",
  };
}
