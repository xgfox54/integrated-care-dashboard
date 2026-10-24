// 복지예산 조회 응답의 무거운 집계(합계·목록·조건 목록·지역 요약)를 저장해 다시 쓴다.
// 공개 snapshot은 바뀌지 않으므로 키에 snapshot 목록·조회 조건·행정단위 정의를 넣으면 같은 키의 결과도 바뀌지 않는다.
// 승인 해제·새 공개본·행정단위 변경은 키가 달라져 옛 결과를 쓰지 않는다.
import type { SqlDatabase } from "../sql-database.ts";

// v3(2026-10-09): v290에서 세부 예산분야가 캐시 열쇠의 구역 이름(part)과 겹쳐 잘못 저장된 결과를 버린다.
const CACHE_VERSION = "budget-v4";
/** 이보다 오래된 저장 결과는 지운다(주 1회 범위 공개본 2개 보관 기간보다 길게). */
export const BUDGET_CACHE_TTL_SECONDS = 21 * 86_400;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * 서버 메모리 층: 같은 서버 인스턴스가 다시 받은 조회는 D1을 거치지 않고 바로 돌려준다. 데이터베이스 객체마다 따로 두어
 * (시험용 DB끼리 섞이지 않게) 글자 수 합계가 한도를 넘으면 오래 안 쓴 것부터 버린다.
 */
const MEMORY_LIMIT_CHARS = 16_000_000;
interface MemoryEntry { readonly value: unknown; readonly size: number; readonly expiresAt: number }
interface MemoryStore { readonly entries: Map<string, MemoryEntry>; readonly pending: Map<string, Promise<void>>; size: number }
const stores = new WeakMap<object, MemoryStore>();

function storeFor(db: SqlDatabase): MemoryStore {
  let store = stores.get(db);
  if (!store) {
    store = { entries: new Map(), pending: new Map(), size: 0 };
    stores.set(db, store);
  }
  return store;
}

function recall(store: MemoryStore, key: string): { readonly value: unknown } | null {
  const entry = store.entries.get(key);
  if (!entry) return null;
  store.entries.delete(key);
  if (entry.expiresAt <= Date.now()) {
    store.size -= entry.size;
    return null;
  }
  store.entries.set(key, entry);
  return { value: entry.value };
}

function remember(store: MemoryStore, key: string, value: unknown, size: number, ttlMs: number): void {
  if (size > MEMORY_LIMIT_CHARS / 4) return;
  const previous = store.entries.get(key);
  if (previous) store.size -= previous.size;
  store.entries.set(key, { value, size, expiresAt: Date.now() + ttlMs });
  store.size += size;
  for (const [oldKey, entry] of store.entries) {
    if (store.size <= MEMORY_LIMIT_CHARS) break;
    store.entries.delete(oldKey);
    store.size -= entry.size;
  }
}

/** 바뀌는 일이 드문 작은 값(단위 대조 문구·분야코드)을 ttlMs 동안 서버 메모리에 둔다. */
export async function rememberedFor<T>(db: SqlDatabase, key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const store = storeFor(db);
  const hit = recall(store, "small:" + key);
  if (hit) return hit.value as T;
  const pending = store.pending.get(key);
  if (pending) {
    await pending;
    return rememberedFor(db, key, ttlMs, compute);
  }
  const result = compute().then((value) => {
    remember(store, "small:" + key, value, JSON.stringify(value ?? null).length, ttlMs);
    return value;
  });
  // 완료 신호만 공유함. 실패는 원래 호출자에게 전달하고 후속 요청은 다시 읽음.
  const settled = result.then(() => undefined, () => undefined);
  store.pending.set(key, settled);
  try {
    return await result;
  } finally {
    if (store.pending.get(key) === settled) store.pending.delete(key);
  }
}

export async function cachedBudgetPart<T>(db: SqlDatabase, parts: unknown, compute: () => Promise<T>): Promise<T> {
  const key = await sha256Hex(JSON.stringify([CACHE_VERSION, parts]));
  const store = storeFor(db);
  // 키에 공개 snapshot·조건·행정단위 정의가 모두 들어 있어 같은 키의 결과는 바뀌지 않는다. 메모리에서도 D1 보관 기간까지만 쓴다.
  const hit = recall(store, key);
  if (hit) return hit.value as T;
  const row = await db.prepare("SELECT body FROM fiscal_response_cache WHERE cache_key = ?").bind(key).first<{ body: string }>();
  if (row) {
    const stored = JSON.parse(row.body) as T;
    remember(store, key, stored, row.body.length, BUDGET_CACHE_TTL_SECONDS * 1000);
    return stored;
  }
  const value = await compute();
  const body = JSON.stringify(value);
  remember(store, key, value, body.length, BUDGET_CACHE_TTL_SECONDS * 1000);
  // 저장 실패(크기 제한 등)는 조회 결과에 영향을 주지 않는다. 다음 요청이 다시 계산한다.
  await db.prepare("INSERT OR REPLACE INTO fiscal_response_cache (cache_key, body, created_at) VALUES (?, ?, ?)")
    .bind(key, body, Math.floor(Date.now() / 1000)).run().catch(() => undefined);
  return value;
}

export async function purgeBudgetCache(db: SqlDatabase, nowSeconds: number): Promise<void> {
  await db.prepare("DELETE FROM fiscal_response_cache WHERE created_at < ?").bind(nowSeconds - BUDGET_CACHE_TTL_SECONDS).run();
}
