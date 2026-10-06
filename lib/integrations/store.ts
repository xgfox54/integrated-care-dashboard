// 원천 레코드 저장: 해시로 같은 자료의 재수집을 중복 없이 처리하고, 바뀐 필드를 변경 이력에 남긴다.
// 행은 지우지 않는다. 완전 수집에서 보이지 않은 레코드는 presence=NOT_SEEN과 missing_runs만 바꾼다.
import type { SqlDatabase, SqlStatement } from "../sql-database.ts";
import { ADAPTER_VERSION, type RecordInput } from "./adapters.ts";
import { sha256Hex } from "./http.ts";

export interface UpsertCounts {
  readonly seen: number;
  readonly created: number;
  readonly changed: number;
  readonly reappeared: number;
}

const IN_CHUNK = 80;

/** 필드 순서와 무관한 정규 JSON. 같은 자료면 같은 해시가 나온다. */
export function canonicalJson(value: Readonly<Record<string, string | null>>): string {
  return JSON.stringify(Object.keys(value).sort().reduce<Record<string, string | null>>((acc, key) => {
    acc[key] = value[key] ?? null;
    return acc;
  }, {}));
}

export async function recordHash(record: RecordInput): Promise<string> {
  return sha256Hex(canonicalJson({ ...record.payload, __url: record.officialUrl ?? null }));
}

function changedFields(before: string, after: Readonly<Record<string, string | null>>): string[] {
  let previous: Record<string, string | null> = {};
  try {
    previous = JSON.parse(before) as Record<string, string | null>;
  } catch {
    return Object.keys(after);
  }
  const keys = new Set([...Object.keys(previous), ...Object.keys(after)]);
  return [...keys].filter((key) => (previous[key] ?? null) !== (after[key] ?? null)).sort();
}

export async function upsertRecords(db: SqlDatabase, datasetKey: string, scopeKey: string, runId: string, records: readonly RecordInput[], now: number): Promise<UpsertCounts> {
  const unique = new Map<string, RecordInput>();
  for (const record of records) unique.set(record.recordId, record);
  const list = [...unique.values()];
  const existing = new Map<string, { record_hash: string; payload_json: string; presence: string }>();
  for (let index = 0; index < list.length; index += IN_CHUNK) {
    const ids = list.slice(index, index + IN_CHUNK).map((record) => record.recordId);
    const rows = await db.prepare("SELECT record_id, record_hash, payload_json, presence FROM ext_record WHERE dataset_key = ? AND record_id IN (" + ids.map(() => "?").join(",") + ")")
      .bind(datasetKey, ...ids).all<{ record_id: string; record_hash: string; payload_json: string; presence: string }>();
    for (const row of rows.results) existing.set(row.record_id, row);
  }
  const statements: SqlStatement[] = [];
  let created = 0;
  let changed = 0;
  let reappeared = 0;
  for (const record of list) {
    const hash = await recordHash(record);
    const payload = JSON.stringify(record.payload);
    const before = existing.get(record.recordId);
    if (!before) {
      created += 1;
      statements.push(db.prepare("INSERT INTO ext_record (dataset_key, record_id, scope_key, record_hash, payload_json, official_url, data_as_of, source_updated_at, region_code_type, region_code, first_seen_at, last_seen_at, last_success_run_id, presence, missing_runs, adapter_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PRESENT', 0, ?)")
        .bind(datasetKey, record.recordId, scopeKey, hash, payload, record.officialUrl ?? null, record.dataAsOf ?? null, record.sourceUpdatedAt ?? null, record.regionCodeType ?? null, record.regionCode ?? null, now, now, runId, ADAPTER_VERSION));
      statements.push(db.prepare("INSERT INTO ext_record_change (dataset_key, record_id, run_id, kind, old_hash, new_hash, changed_fields, changed_at) VALUES (?, ?, ?, 'NEW', NULL, ?, NULL, ?)").bind(datasetKey, record.recordId, runId, hash, now));
      continue;
    }
    const wasMissing = before.presence !== "PRESENT";
    if (wasMissing) reappeared += 1;
    if (before.record_hash !== hash) {
      changed += 1;
      statements.push(db.prepare("INSERT INTO ext_record_change (dataset_key, record_id, run_id, kind, old_hash, new_hash, changed_fields, changed_at) VALUES (?, ?, ?, 'CHANGED', ?, ?, ?, ?)")
        .bind(datasetKey, record.recordId, runId, before.record_hash, hash, changedFields(before.payload_json, record.payload).join(","), now));
    } else if (wasMissing) {
      statements.push(db.prepare("INSERT INTO ext_record_change (dataset_key, record_id, run_id, kind, old_hash, new_hash, changed_fields, changed_at) VALUES (?, ?, ?, 'REAPPEARED', ?, ?, NULL, ?)").bind(datasetKey, record.recordId, runId, before.record_hash, hash, now));
    }
    statements.push(db.prepare("UPDATE ext_record SET scope_key = ?, record_hash = ?, payload_json = ?, official_url = ?, data_as_of = ?, source_updated_at = ?, region_code_type = ?, region_code = ?, last_seen_at = ?, last_success_run_id = ?, presence = 'PRESENT', missing_runs = 0, adapter_version = ? WHERE dataset_key = ? AND record_id = ?")
      .bind(scopeKey, hash, payload, record.officialUrl ?? null, record.dataAsOf ?? null, record.sourceUpdatedAt ?? null, record.regionCodeType ?? null, record.regionCode ?? null, now, runId, ADAPTER_VERSION, datasetKey, record.recordId));
  }
  for (let index = 0; index < statements.length; index += 200) await db.batch(statements.slice(index, index + 200));
  return { seen: list.length, created, changed, reappeared };
}

/** 완전 수집이 끝난 범위에서 이번 실행에 보이지 않은 레코드를 표시한다(삭제·종료 처리 아님). 바뀐 수를 돌려준다. */
export async function markNotSeen(db: SqlDatabase, datasetKey: string, scopeKey: string, runId: string, startedAt: number, now: number): Promise<number> {
  const missing = await db.prepare("SELECT record_id, record_hash, presence FROM ext_record WHERE dataset_key = ? AND scope_key = ? AND last_seen_at < ?")
    .bind(datasetKey, scopeKey, startedAt).all<{ record_id: string; record_hash: string; presence: string }>();
  const statements: SqlStatement[] = [];
  for (const row of missing.results) {
    statements.push(db.prepare("UPDATE ext_record SET presence = 'NOT_SEEN', missing_runs = missing_runs + 1 WHERE dataset_key = ? AND record_id = ?").bind(datasetKey, row.record_id));
    if (row.presence === "PRESENT") statements.push(db.prepare("INSERT INTO ext_record_change (dataset_key, record_id, run_id, kind, old_hash, new_hash, changed_fields, changed_at) VALUES (?, ?, ?, 'NOT_SEEN', ?, NULL, NULL, ?)").bind(datasetKey, row.record_id, runId, row.record_hash, now));
  }
  for (let index = 0; index < statements.length; index += 200) await db.batch(statements.slice(index, index + 200));
  return missing.results.length;
}
