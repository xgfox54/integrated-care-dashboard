// 과거 목록 UPSERT가 축약한 상세를 동일 버전 원문으로 읽기 전용 복원한다.
// 원천/조회 표는 수정하지 않으며, 버전·서비스·수집 실행이 모두 확인된 경우만 사용한다.
import type { SqlDatabase } from "../sql-database.ts";
import { GOV24_DETAIL_FIELDS } from "./adapters.ts";
import { recordHash } from "./store.ts";

export const GOV24_DETAIL_HYDRATION_VERSION = "gov24-detail-hydration-1";
export type Gov24HydrationRow = Record<string, string | number | null>;

export interface Gov24HydrationMetadata {
  readonly detail_hydration_status: "RESTORED" | "UNCHANGED" | "NOT_RESTORED";
  readonly detail_hydration_reason: string;
  readonly detail_hydration_record_id: string | null;
  readonly detail_hydration_record_hash: string | null;
  readonly detail_hydration_run_id: string | null;
  readonly detail_hydration_version: typeof GOV24_DETAIL_HYDRATION_VERSION;
}

// 이번 버그가 덮어쓴 목록/상세 공용 필드만 복원한다. ID·기관·URL·수집시각과
// 별도 상세 필드(구비서류/법령 등)는 입력 행 그대로 보존한다.
const SHARED_DETAIL_FIELDS = {
  purpose: "서비스목적", target: "지원대상", criteria: "선정기준", benefit: "지원내용",
  apply_method: "신청방법", apply_deadline: "신청기한", reception: "접수기관명", contact: "문의처",
} as const;
const RAW_DATASET = "mois.gov24_detail"; // gitleaks:allow public dataset identifier
const LOOKUP_CHUNK = 80;

interface RawDetail {
  record_id: string;
  scope_key: string;
  record_hash: string;
  payload_json: string;
  official_url: string | null;
  source_updated_at: string | null;
  presence: string;
  last_seen_at: number;
  last_success_run_id: string;
  run_id: string | null;
  run_dataset_key: string | null;
  run_status: string | null;
  run_started_at: number | null;
  run_finished_at: number | null;
}

function positiveSeconds(value: unknown): number | null {
  const seconds = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}

function inputReason(row: Gov24HydrationRow): string | null {
  if (row.presence !== "PRESENT") return "SERVICE_NOT_PRESENT";
  if (row.detail_status !== "COLLECTED") return "DETAIL_NOT_COLLECTED";
  if (typeof row.service_id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(row.service_id)) return "SERVICE_ID_INVALID";
  if (typeof row.modified_at !== "string" || !row.modified_at.trim()) return "CURRENT_VERSION_UNCONFIRMED";
  if (row.detail_modified_at !== row.modified_at) return "DETAIL_VERSION_MISMATCH";
  if (positiveSeconds(row.detail_fetched_at) === null) return "DETAIL_COLLECTION_TIME_UNCONFIRMED";
  return null;
}

function metadata(status: Gov24HydrationMetadata["detail_hydration_status"], reason: string, raw?: RawDetail): Gov24HydrationMetadata {
  return {
    detail_hydration_status: status, detail_hydration_reason: reason,
    // 불일치한 원문은 그 내용이나 타 서비스의 식별자까지 응답에 붙이지 않는다.
    detail_hydration_record_id: raw?.record_id ?? null,
    detail_hydration_record_hash: raw?.record_hash ?? null,
    detail_hydration_run_id: raw?.last_success_run_id ?? null,
    detail_hydration_version: GOV24_DETAIL_HYDRATION_VERSION,
  };
}

async function verifiedPayload(row: Gov24HydrationRow, raw: RawDetail): Promise<{ payload: Record<string, string | null>; reason: null } | { payload: null; reason: string }> {
  const fail = (reason: string) => ({ payload: null, reason });
  if (raw.record_id !== row.service_id + ":detail" || raw.scope_key !== "service:" + row.service_id) return fail("RAW_ID_OR_SCOPE_MISMATCH");
  if (raw.presence !== "PRESENT") return fail("RAW_DETAIL_NOT_PRESENT");
  // 상세 수정일과 목록 수정일이 다른 정상 응답도 있다. 그런 원문은 이 복원에 쓰지 않는다.
  if (raw.source_updated_at !== row.modified_at) return fail("RAW_VERSION_MISMATCH");
  const fetched = positiveSeconds(row.detail_fetched_at);
  if (positiveSeconds(raw.last_seen_at) !== fetched) return fail("RAW_COLLECTION_TIME_MISMATCH");
  if (!raw.run_id || raw.run_id !== raw.last_success_run_id || raw.run_dataset_key !== RAW_DATASET) return fail("RAW_RUN_MISMATCH");
  if (raw.run_status !== "SUCCEEDED" || positiveSeconds(raw.run_finished_at) === null) return fail("RAW_RUN_NOT_COMPLETED");
  const started = positiveSeconds(raw.run_started_at), finished = positiveSeconds(raw.run_finished_at);
  if (started === null || fetched === null || started > fetched || finished! < fetched) return fail("RAW_COLLECTION_OUTSIDE_RUN");
  let parsed: unknown;
  try { parsed = JSON.parse(raw.payload_json); } catch { return fail("RAW_PAYLOAD_INVALID"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Object.values(parsed).every((value) => value === null || typeof value === "string")) return fail("RAW_PAYLOAD_INVALID");
  const payload = parsed as Record<string, string | null>;
  if (payload["서비스ID"] !== row.service_id) return fail("RAW_PAYLOAD_ID_MISMATCH");
  if (payload["수정일시"] !== row.modified_at) return fail("RAW_PAYLOAD_VERSION_MISMATCH");
  if (!GOV24_DETAIL_FIELDS.every((field) => Object.hasOwn(payload, field))) return fail("RAW_PAYLOAD_INCOMPLETE");
  if (await recordHash({ recordId: raw.record_id, payload, officialUrl: raw.official_url }) !== raw.record_hash) return fail("RAW_HASH_MISMATCH");
  return { payload, reason: null };
}

/** 선택된 서비스 ID의 상세만 읽는다. 새로운 수집이나 DB 쓰기는 수행하지 않는다. */
export async function hydrateGov24Details<T extends Gov24HydrationRow>(db: SqlDatabase, rows: readonly T[]): Promise<(T & Gov24HydrationMetadata)[]> {
  const initialReasons = rows.map(inputReason);
  const ids = [...new Set(rows.filter((_, index) => initialReasons[index] === null).map((row) => String(row.service_id) + ":detail"))];
  const rawById = new Map<string, RawDetail>();
  const unavailable = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += LOOKUP_CHUNK) {
    const chunk = ids.slice(offset, offset + LOOKUP_CHUNK);
    try {
      const result = await db.prepare(
        "SELECT r.record_id, r.scope_key, r.record_hash, r.payload_json, r.official_url, r.source_updated_at, r.presence, r.last_seen_at, r.last_success_run_id, " +
        "u.run_id, u.dataset_key AS run_dataset_key, u.status AS run_status, u.started_at AS run_started_at, u.finished_at AS run_finished_at " +
        "FROM ext_record r LEFT JOIN ext_run u ON u.run_id = r.last_success_run_id " +
        "WHERE r.dataset_key = 'mois.gov24_detail' AND r.record_id IN (" + chunk.map(() => "?").join(",") + ")", // gitleaks:allow public dataset identifier
      ).bind(...chunk).all<RawDetail>();
      for (const raw of result.results) rawById.set(raw.record_id, raw);
    } catch {
      // 보완용 원문을 읽지 못해도 기존 공개 카드까지 실패시키지 않는다.
      for (const id of chunk) unavailable.add(id);
    }
  }
  return Promise.all(rows.map(async (row, index) => {
    const id = String(row.service_id) + ":detail";
    const skipped = (reason: string) => ({ ...row, ...metadata("NOT_RESTORED", reason) });
    if (initialReasons[index]) return skipped(initialReasons[index]);
    if (unavailable.has(id)) return skipped("RAW_DETAIL_READ_UNAVAILABLE");
    const raw = rawById.get(id);
    if (!raw) return skipped("RAW_DETAIL_NOT_FOUND");
    const verified = await verifiedPayload(row, raw);
    if (verified.reason !== null) return skipped(verified.reason);
    const restored = { ...row };
    let changed = false;
    for (const [field, sourceField] of Object.entries(SHARED_DETAIL_FIELDS)) {
      const value = verified.payload[sourceField];
      // 새 상세에서 비어 있던 공용 필드는 원래 projector처럼 목록 값을 유지한다.
      if (typeof value === "string" && value.trim() && value !== row[field]) {
        (restored as Gov24HydrationRow)[field] = value;
        changed = true;
      }
    }
    return { ...restored, ...metadata(changed ? "RESTORED" : "UNCHANGED", "SAME_VERSION_COMPLETED_DETAIL", raw) };
  }));
}
