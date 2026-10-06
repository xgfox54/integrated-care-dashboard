import { after } from "next/server";

import { getD1 } from "./d1";
import { logServerError } from "./errors";
import { readLatestRun } from "./official-query";
import { PUBLIC_KNOWLEDGE_RUN_SQL } from "./platform/public-pin";
import { cachedWikiEdits } from "./wiki-edit-store";
import type { WikiEdit } from "./wiki-edits";

/**
 * 계산해 둔 자료 응답을 D1에 보관한다. 이 배포 환경에서는 Workers 공유 캐시
 * (caches.default)를 쓸 수 없어, 새로 뜬 서버 인스턴스마다 요약·검색 집계를 처음부터
 * 다시 계산했다. 보관본은 최신 수집 번호와 위키 수정 상태가 모두 같을 때만 쓰므로
 * 새 자료가 수집되거나 위키가 고쳐지면 자동으로 무효가 된다.
 */

// 응답 모양을 만드는 코드가 바뀌면 빌드 때 값이 바뀌어 예전 보관본을 쓰지 않는다.
const CODE_VERSION = typeof __DATASET_CACHE_VERSION__ === "string" ? __DATASET_CACHE_VERSION__ : "dev";
export const DATASET_CACHE_PREFIX = "v1:" + CODE_VERSION + ":";
const MAX_STORED_BYTES = 1_500_000;

// D1 오류가 나면 잠시(1분) 보관 없이 계산만 한다.
let disabledUntil = 0;

function storeUsable(): boolean {
  return Date.now() >= disabledUntil;
}

function disableStore(error: unknown): void {
  disabledUntil = Date.now() + 60_000;
  logServerError(error, { path: "dataset-cache/read", status: 500 });
}

export function wikiEditsVersion(edits: ReadonlyMap<string, WikiEdit>): string {
  let latest = 0;
  let total = 0;
  for (const edit of edits.values()) {
    latest = Math.max(latest, edit.updatedAt);
    total += edit.updatedAt;
  }
  return edits.size + ":" + latest + ":" + total;
}

const CURRENT_RUN_SQL = PUBLIC_KNOWLEDGE_RUN_SQL;
const CURRENT_EDITS_SQL =
  "(SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), 0) || ':' || COALESCE(SUM(updated_at), 0) FROM wiki_edit)";

async function readStored(key: string): Promise<string | null> {
  if (!storeUsable()) return null;
  try {
    const row = await getD1()
      .prepare(
        "SELECT body FROM dataset_response_cache WHERE cache_key = ? AND run_id = " + CURRENT_RUN_SQL +
          " AND edits_version = " + CURRENT_EDITS_SQL,
      )
      .bind(key)
      .first<{ body: string }>();
    return row?.body ?? null;
  } catch (error) {
    // 표가 아직 없거나(마이그레이션 전) D1 오류면 보관 없이 계산한다.
    disableStore(error);
    return null;
  }
}

export async function writeStoredEntries(
  entries: readonly { readonly key: string; readonly body: string }[],
  runId: string,
  editsVersion: string,
): Promise<void> {
  if (!storeUsable()) return;
  const db = getD1();
  const now = Math.floor(Date.now() / 1000);
  const statements = entries
    .filter((entry) => entry.body.length <= MAX_STORED_BYTES)
    .map((entry) =>
      db
        .prepare(
          "INSERT INTO dataset_response_cache (cache_key, run_id, edits_version, body, created_at) VALUES (?, ?, ?, ?, ?) " +
            "ON CONFLICT(cache_key) DO UPDATE SET run_id = excluded.run_id, edits_version = excluded.edits_version, body = excluded.body, created_at = excluded.created_at",
        )
        .bind(DATASET_CACHE_PREFIX + entry.key, runId, editsVersion, entry.body, now),
    );
  for (let index = 0; index < statements.length; index += 20) {
    await db.batch(statements.slice(index, index + 20));
  }
}

function storeLater(task: () => Promise<void>): void {
  const guarded = () => task().catch((error: unknown) => {
    logServerError(error, { path: "dataset-cache/write", status: 500 });
  });
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}

export interface DatasetJson {
  readonly body: string;
  /** D1 보관본을 썼는지(응답 헤더 x-dataset-cache로 확인). */
  readonly stored: boolean;
}

/**
 * key에 해당하는 응답 본문(JSON 문자열)을 돌려준다. D1 보관본이 최신이면 그대로 쓰고,
 * 없으면 compute로 계산한 뒤 응답을 보낸 다음에 보관한다.
 */
export async function cachedDatasetJson(key: string, compute: () => Promise<string>): Promise<DatasetJson> {
  const [stored, run, edits] = await Promise.all([
    readStored(DATASET_CACHE_PREFIX + key),
    readLatestRun(),
    cachedWikiEdits(),
  ]);
  if (stored !== null) return { body: stored, stored: true };
  const body = await compute();
  if (run) {
    const version = wikiEditsVersion(edits);
    storeLater(() => writeStoredEntries([{ key, body }], run.id, version));
  }
  return { body, stored: false };
}

/** 이미 보관된 키 목록(현재 수집·위키 상태 기준). */
export async function listFreshKeys(runId: string, editsVersion: string): Promise<Set<string>> {
  if (!storeUsable()) throw new Error("dataset response cache disabled");
  const result = await getD1()
    .prepare("SELECT cache_key FROM dataset_response_cache WHERE run_id = ? AND edits_version = ? AND substr(cache_key, 1, ?) = ?")
    .bind(runId, editsVersion, DATASET_CACHE_PREFIX.length, DATASET_CACHE_PREFIX)
    .all<{ cache_key: string }>();
  return new Set((result.results ?? []).map((row) => row.cache_key.slice(DATASET_CACHE_PREFIX.length)));
}

/** 지난 수집·예전 코드·예전 위키 상태의 보관본을 지운다. */
export async function pruneStaleEntries(runId: string, editsVersion: string): Promise<void> {
  if (!storeUsable()) return;
  await getD1()
    .prepare("DELETE FROM dataset_response_cache WHERE run_id <> ? OR edits_version <> ? OR substr(cache_key, 1, ?) <> ?")
    .bind(runId, editsVersion, DATASET_CACHE_PREFIX.length, DATASET_CACHE_PREFIX)
    .run();
}

/** 위키 수정 저장·삭제 직후 호출한다. */
export async function clearDatasetCache(): Promise<void> {
  try {
    await getD1().prepare("DELETE FROM dataset_response_cache").run();
  } catch (error) {
    logServerError(error, { path: "dataset-cache/clear", status: 500 });
  }
}
