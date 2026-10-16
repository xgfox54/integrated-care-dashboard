// 사업·정부24 검색용 trigram 전문 인덱스(0114 마이그레이션)의 준비 상태 확인과 기존 행 채우기.
// 인덱스는 3글자 이상 검색어로 후보를 좁히는 데만 쓰고, 일치 판정은 호출하는 쪽의 기존 instr 조건이 한다.
import { databaseIdentity, type SqlDatabase } from "../sql-database.ts";

export type SearchFtsName = "official_service_search" | "gov24_search";

const SOURCES: Readonly<Record<SearchFtsName, { readonly fts: string; readonly columns: string; readonly chunk: number }>> = {
  official_service_search: { fts: "official_service_search_fts", columns: "name_c, description_c, target_c, provider_c, subcategory_c", chunk: 1500 },
  gov24_search: { fts: "gov24_search_fts", columns: "content_c", chunk: 400 },
};

const READY_TTL_MS = 60_000;
const readyCache = new WeakMap<object, { at: number; ready: ReadonlySet<string> }>();

/** 기존 행 채우기가 끝난 인덱스만 돌려준다. 표가 없거나(마이그레이션 전) 읽지 못하면 빈 집합으로 기존 조회 경로를 쓴다. */
async function readySearchFts(db: SqlDatabase): Promise<ReadonlySet<string>> {
  const key = databaseIdentity(db);
  const hit = readyCache.get(key);
  if (hit && Date.now() - hit.at < READY_TTL_MS) return hit.ready;
  let ready: ReadonlySet<string> = new Set();
  try {
    const rows = (await db.prepare("SELECT name FROM search_fts_state WHERE completed_at IS NOT NULL").all<{ name: string }>()).results;
    ready = new Set(rows.map((row) => row.name));
  } catch {
    ready = new Set();
  }
  readyCache.set(key, { at: Date.now(), ready });
  return ready;
}

export async function searchFtsReady(db: SqlDatabase, name: SearchFtsName): Promise<boolean> {
  return (await readySearchFts(db)).has(name);
}

/** trigram 인덱스는 3글자 이상만 찾는다. 그보다 짧거나 FTS5 구문이 다루지 못하는 제어·서식 문자가 있으면 null(인덱스로 좁히지 않음). */
export function ftsPhrase(term: string): string | null {
  const value = term.trim();
  if (Array.from(value).length < 3 || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  return '"' + value.replace(/"/g, '""') + '"';
}

export interface SearchFtsProgress {
  readonly name: string;
  readonly next_rowid: number;
  readonly backfill_limit: number;
  readonly done: boolean;
}

/**
 * 마이그레이션 시점에 있던 행(backfill_limit 이하 rowid)을 구간별로 인덱스에 넣는다. 새 행은 트리거가 넣는다.
 * 구간마다 지운 뒤 다시 넣고 next_rowid를 비교·갱신하므로, 같은 구간을 두 실행 환경이 동시에 처리해도 결과가 같다.
 */
export async function advanceSearchFtsBackfill(db: SqlDatabase, budgetMs = 5000): Promise<SearchFtsProgress[]> {
  const deadline = Date.now() + budgetMs;
  const pending = (await db.prepare("SELECT name, backfill_limit, next_rowid FROM search_fts_state WHERE completed_at IS NULL ORDER BY name").all<{ name: string; backfill_limit: number; next_rowid: number }>()).results;
  const progress: SearchFtsProgress[] = [];
  for (const state of pending) {
    const source = SOURCES[state.name as SearchFtsName];
    if (!source) continue;
    let next = Number(state.next_rowid);
    const limit = Number(state.backfill_limit);
    while (next < limit && Date.now() < deadline) {
      const boundary = await db.prepare("SELECT rowid AS id FROM " + state.name + " WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT 1 OFFSET " + (source.chunk - 1)).bind(next, limit).first<{ id: number }>();
      const upper = boundary ? Number(boundary.id) : limit;
      const completedAt = upper >= limit ? Math.floor(Date.now() / 1000) : null;
      await db.batch([
        db.prepare("DELETE FROM " + source.fts + " WHERE rowid > ? AND rowid <= ?").bind(next, upper),
        db.prepare("INSERT INTO " + source.fts + " (rowid, " + source.columns + ") SELECT rowid, " + source.columns + " FROM " + state.name + " WHERE rowid > ? AND rowid <= ?").bind(next, upper),
        db.prepare("UPDATE search_fts_state SET next_rowid = ?, completed_at = ? WHERE name = ? AND next_rowid = ?").bind(upper, completedAt, state.name, next),
      ]);
      next = upper;
    }
    if (next >= limit) readyCache.delete(databaseIdentity(db));
    progress.push({ name: state.name, next_rowid: next, backfill_limit: limit, done: next >= limit });
  }
  return progress;
}
