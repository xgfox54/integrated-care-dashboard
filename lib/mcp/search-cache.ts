// 통합 검색 결과를 같은 질문·공개본·배포 기준으로 10분 동안 재사용한다. 실행 인스턴스 메모리 → D1 공유 캐시 → 원본 검색 순서다.
// 이 호스팅에서는 Cloudflare Cache API(caches.default)의 match·put이 모두 오류를 내므로(2026-10-15 운영 확인) 캐시로 쓰지 않고 인스턴스마다 한 번 진단만 한다.
// D1에는 질문 원문이 남지 않게 키는 해시로 두고, 본문은 같은 질문으로만 만들 수 있는 키로 AES-GCM 암호화한다.
import type { SqlDatabase } from "../sql-database.ts";
import { storeErrorKind } from "../store-errors.ts";

export const SEARCH_CACHE_TTL_SECONDS = 600;
export const SEARCH_CACHE_SCHEMA_VERSION = 2;
export const SEARCH_CACHE_ENTRY_MAX_BYTES = 1_000_000;
const MEMORY_MAX_ENTRIES = 256;
const MEMORY_MAX_BYTES = 4 * 1024 * 1024;
const BACKEND_COOLDOWN_MS = 60_000;
const PURGE_INTERVAL_MS = 300_000;

export type SearchCacheLayer = "memory" | "d1";
export type SearchCacheMiss = "cold" | "expired" | "lookup_error" | "backend_cooldown";
export type SearchCacheWrite = "stored" | "memory_only" | `failed:${string}`;

export interface SearchCacheKey {
  readonly id: string;
  readonly secret: Uint8Array<ArrayBuffer>;
}

export interface SearchCacheLookup {
  readonly value: object | null;
  readonly layer: SearchCacheLayer | null;
  readonly miss: SearchCacheMiss | null;
}

export interface SearchCachePut {
  readonly reason: "too_large" | null;
  readonly write: Promise<SearchCacheWrite> | null;
}

export interface SearchResultCache {
  get(key: SearchCacheKey): Promise<SearchCacheLookup>;
  put(key: SearchCacheKey, value: object): SearchCachePut;
}

interface MemoryEntry {
  readonly body: string;
  readonly bytes: number;
  readonly expiresAt: number;
}

export interface SearchCacheInstance {
  readonly entries: Map<string, MemoryEntry>;
  bytes: number;
  backendDisabledUntil: number;
  lastPurgeAt: number;
  id: string | null;
}

export interface SearchCacheOptions {
  readonly db?: SqlDatabase | null;
  readonly defer?: (task: Promise<unknown>) => void;
  readonly instance?: SearchCacheInstance;
  readonly now?: () => number;
  readonly ttlSeconds?: number;
}

export function createSearchCacheInstance(): SearchCacheInstance {
  return { entries: new Map(), bytes: 0, backendDisabledUntil: 0, lastPurgeAt: 0, id: null };
}

const workerInstance = createSearchCacheInstance();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function searchCacheInstanceId(instance: SearchCacheInstance = workerInstance): string {
  instance.id ??= crypto.randomUUID().slice(0, 8);
  return instance.id;
}

export async function searchCacheKey(parts: readonly unknown[]): Promise<SearchCacheKey> {
  const material = JSON.stringify(parts);
  const digest = async (label: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode("mcp-search-cache:" + label + ":v2\u0000" + material)));
  const [id, secret] = await Promise.all([digest("id"), digest("body")]);
  return { id: [...id].map((byte) => byte.toString(16).padStart(2, "0")).join(""), secret };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function aesKey(key: SearchCacheKey, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", key.secret, "AES-GCM", false, [usage]);
}

async function seal(key: SearchCacheKey, plaintext: Uint8Array<ArrayBuffer>): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(key.id) }, await aesKey(key, "encrypt"), plaintext));
  const joined = new Uint8Array(iv.length + sealed.length);
  joined.set(iv);
  joined.set(sealed, iv.length);
  return toBase64(joined);
}

async function open(key: SearchCacheKey, stored: string): Promise<string> {
  const joined = fromBase64(stored);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: joined.subarray(0, 12), additionalData: encoder.encode(key.id) }, await aesKey(key, "decrypt"), joined.subarray(12));
  return decoder.decode(plaintext);
}

function forget(instance: SearchCacheInstance, id: string): void {
  const entry = instance.entries.get(id);
  if (!entry) return;
  instance.bytes -= entry.bytes;
  instance.entries.delete(id);
}

function remember(instance: SearchCacheInstance, id: string, body: string, bytes: number, expiresAt: number): void {
  forget(instance, id);
  instance.entries.set(id, { body, bytes, expiresAt });
  instance.bytes += bytes;
  for (const oldest of instance.entries.keys()) {
    if (instance.entries.size <= MEMORY_MAX_ENTRIES && instance.bytes <= MEMORY_MAX_BYTES) break;
    if (oldest !== id) forget(instance, oldest);
  }
}

function failureKind(error: unknown): string {
  return storeErrorKind(error) ?? (error instanceof Error ? error.name : "UnknownError");
}

const UPSERT = "INSERT INTO mcp_search_cache (cache_key, schema_version, body, body_bytes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?) "
  + "ON CONFLICT(cache_key) DO UPDATE SET schema_version = excluded.schema_version, body = excluded.body, body_bytes = excluded.body_bytes, created_at = excluded.created_at, expires_at = excluded.expires_at";

export function createSearchResultCache(options: SearchCacheOptions = {}): SearchResultCache {
  const instance = options.instance ?? workerInstance;
  const clock = options.now ?? Date.now;
  const ttlMs = (options.ttlSeconds ?? SEARCH_CACHE_TTL_SECONDS) * 1000;
  const db = options.db ?? null;
  const miss = (reason: SearchCacheMiss): SearchCacheLookup => ({ value: null, layer: null, miss: reason });
  const disableBackend = (error: unknown) => {
    instance.backendDisabledUntil = clock() + BACKEND_COOLDOWN_MS;
    return failureKind(error);
  };
  return {
    async get(key) {
      const now = clock();
      const local = instance.entries.get(key.id);
      if (local && local.expiresAt > now) {
        instance.entries.delete(key.id);
        instance.entries.set(key.id, local);
        return { value: JSON.parse(local.body) as object, layer: "memory", miss: null };
      }
      if (local) forget(instance, key.id);
      const coldOrExpired = local ? "expired" : "cold";
      if (!db) return miss(coldOrExpired);
      if (now < instance.backendDisabledUntil) return miss("backend_cooldown");
      let row: { expires_at: number; body: string | null } | null;
      try {
        row = await db.prepare("SELECT expires_at, CASE WHEN expires_at > ? THEN body END AS body FROM mcp_search_cache WHERE cache_key = ? AND schema_version = ?")
          .bind(Math.floor(now / 1000), key.id, SEARCH_CACHE_SCHEMA_VERSION).first<{ expires_at: number; body: string | null }>();
      } catch (error) {
        disableBackend(error);
        return miss("lookup_error");
      }
      if (!row) return miss(coldOrExpired);
      if (row.body === null) return miss("expired");
      try {
        const body = await open(key, row.body);
        remember(instance, key.id, body, encoder.encode(body).length, row.expires_at * 1000);
        return { value: JSON.parse(body) as object, layer: "d1", miss: null };
      } catch {
        return miss("lookup_error");
      }
    },
    put(key, value) {
      const body = JSON.stringify(value);
      const bytes = encoder.encode(body);
      if (bytes.length > SEARCH_CACHE_ENTRY_MAX_BYTES) return { reason: "too_large", write: null };
      const now = clock();
      const expiresAt = now + ttlMs;
      remember(instance, key.id, body, bytes.length, expiresAt);
      if (!db || now < instance.backendDisabledUntil) return { reason: null, write: Promise.resolve("memory_only") };
      const write = (async (): Promise<SearchCacheWrite> => {
        try {
          const nowSeconds = Math.floor(now / 1000);
          const statements = [db.prepare(UPSERT).bind(key.id, SEARCH_CACHE_SCHEMA_VERSION, await seal(key, bytes), bytes.length, nowSeconds, Math.floor(expiresAt / 1000))];
          if (now - instance.lastPurgeAt >= PURGE_INTERVAL_MS) {
            instance.lastPurgeAt = now;
            statements.push(db.prepare("DELETE FROM mcp_search_cache WHERE expires_at <= ?").bind(nowSeconds));
          }
          await db.batch(statements);
          return "stored";
        } catch (error) {
          return `failed:${disableBackend(error)}`;
        }
      })();
      options.defer?.(write);
      return { reason: null, write };
    },
  };
}

type CacheStorageWithDefault = CacheStorage & { readonly default?: Cache };
let edgeProbe = "untried";

function probeFailure(stage: string, error: unknown): string {
  const message = error instanceof Error ? error.message.replace(/[^\w .,:/()'-]/g, "").slice(0, 80) : "";
  return stage + "_error:" + (error instanceof Error ? error.name : "UnknownError") + (message ? ":" + message : "");
}

export function probeEdgeCache(origin: string, defer: (task: Promise<unknown>) => void): string {
  if (edgeProbe !== "untried") return edgeProbe;
  edgeProbe = "probing";
  defer((async () => {
    const cache = (globalThis as { caches?: CacheStorageWithDefault }).caches?.default;
    if (!cache) {
      edgeProbe = "unavailable";
      return;
    }
    const url = origin + "/__mcp_cache/probe";
    try {
      await cache.match(url);
    } catch (error) {
      edgeProbe = probeFailure("match", error);
      return;
    }
    try {
      await cache.put(url, new Response("1", { headers: { "cache-control": "public, max-age=60" } }));
      edgeProbe = "ok";
    } catch (error) {
      edgeProbe = probeFailure("put", error);
    }
  })());
  return edgeProbe;
}

export function edgeCacheProbeResult(): string {
  return edgeProbe;
}

const pendingWrites = new WeakMap<object, Promise<SearchCacheWrite>>();

export function trackSearchCacheWrite<T extends object>(response: T, write: Promise<SearchCacheWrite> | null): T {
  if (write) pendingWrites.set(response, write);
  return response;
}

export function searchCacheWriteOf(response: object): Promise<SearchCacheWrite> | undefined {
  return pendingWrites.get(response);
}

