import type { SqlDatabase } from "./sql-database.ts";

// 선택 인덱스: 없어도 같은 결과를 원본 조회로 돌려줄 수 있는 가속 자료(작업지시서 v5 T33).
// 실패해도 공개본 생성·승격·다른 모듈을 멈추지 않고, 마지막 성공·실패를 상태로 밝힌다. 오류 원문은 남기지 않고 코드만 남긴다.

export const OPTIONAL_INDEXES = {
  dataset_response_cache: "검색·지역 묶음 응답 미리 계산(대시보드 첫 화면 가속)",
} as const;
export type OptionalIndexName = keyof typeof OPTIONAL_INDEXES;

interface StatusRow {
  readonly index_name: string;
  readonly status: string;
  readonly run_id: string | null;
  readonly last_success_at: number | null;
  readonly last_failure_at: number | null;
  readonly failure_code: string | null;
}

export function failureCode(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  return (name || "Error").replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) || "Error";
}

export async function markOptionalIndexPending(db: SqlDatabase, name: OptionalIndexName, nowSeconds: number): Promise<void> {
  await db.prepare("INSERT INTO optional_index_status (index_name, status, updated_at) VALUES (?, 'BUILDING', ?) " +
    "ON CONFLICT(index_name) DO UPDATE SET status = 'BUILDING', updated_at = excluded.updated_at")
    .bind(name, nowSeconds).run();
}

export async function recordOptionalIndex(db: SqlDatabase, name: OptionalIndexName, outcome: { readonly ok: true; readonly runId: string } | { readonly ok: false; readonly code: string }, nowSeconds: number): Promise<void> {
  if (outcome.ok) {
    await db.prepare(
      "INSERT INTO optional_index_status (index_name, status, run_id, last_success_at, updated_at) VALUES (?, 'OK', ?, ?, ?) " +
        "ON CONFLICT(index_name) DO UPDATE SET status = 'OK', run_id = excluded.run_id, last_success_at = excluded.last_success_at, updated_at = excluded.updated_at",
    ).bind(name, outcome.runId, nowSeconds, nowSeconds).run();
    return;
  }
  await db.prepare(
    "INSERT INTO optional_index_status (index_name, status, last_failure_at, failure_code, updated_at) VALUES (?, 'FAILED', ?, ?, ?) " +
      "ON CONFLICT(index_name) DO UPDATE SET status = 'FAILED', last_failure_at = excluded.last_failure_at, failure_code = excluded.failure_code, updated_at = excluded.updated_at",
  ).bind(name, nowSeconds, outcome.code, nowSeconds).run();
}

/** 공개 상태용. currentRunId와 다른 실행으로 만든 인덱스는 STALE(원본 조회로 대체 중). */
export async function readOptionalIndexes(db: SqlDatabase, currentRunId: string | null) {
  const rows = new Map((await db.prepare("SELECT index_name, status, run_id, last_success_at, last_failure_at, failure_code FROM optional_index_status").all<StatusRow>()).results.map((row) => [row.index_name, row]));
  const iso = (seconds: number | null) => (seconds ? new Date(seconds * 1000).toISOString() : null);
  return (Object.keys(OPTIONAL_INDEXES) as OptionalIndexName[]).map((name) => {
    const row = rows.get(name);
    const state = !row ? "NOT_BUILT" : row.status === "FAILED" ? "FAILED" : row.status === "BUILDING" || (currentRunId && row.run_id !== currentRunId) ? "STALE" : "FRESH";
    return {
      index: name, purpose: OPTIONAL_INDEXES[name], required: false, state,
      built_for_run: row?.run_id ?? null, last_success_at: iso(row?.last_success_at ?? null), last_failure_at: iso(row?.last_failure_at ?? null), failure_code: row?.failure_code ?? null,
      fallback: "원본 조회로 같은 결과를 돌려줍니다(느려질 수 있음). 공개본 생성·승격에는 영향이 없습니다.",
    };
  });
}
