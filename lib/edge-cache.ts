import { after } from "next/server.js";

import { hasOnlyUniqueQueryKeys } from "./query-boundary.ts";

type CacheStorageWithDefault = CacheStorage & { readonly default?: Cache };

interface CachedPayload {
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: ArrayBuffer;
}

interface MemoryEntry {
  readonly payload: CachedPayload;
  readonly expiresAt: number;
}

export const SHARED_CACHE_HEADER =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";

const MEMORY_TTL_MS = 300_000;
const MEMORY_MAX_ENTRIES = 64;
const MEMORY_MAX_BYTES = 24 * 1024 * 1024;

const memory = new Map<string, MemoryEntry>();
let memoryBytes = 0;
let lastEdgeOutcome = "untried";
let edgeUsable = true;

const CACHE_PARAMETERS: Readonly<Record<string, readonly string[]>> = {
  "/api/dataset": [],
  "/api/dataset/summary": [],
  "/api/dataset/search": ["sido", "sigungu", "category", "subcategory", "type", "sort", "page", "size"],
  "/api/dataset/export": ["sido", "sigungu", "category", "subcategory", "type", "sort"],
  "/api/dataset/export/xlsx": ["sido", "sigungu", "category", "subcategory", "type", "sort"],
  "/api/dataset/service": ["service"],
  "/api/dataset/bundle": ["scope", "part", "per", "size", "category"],
  "/api/wiki": ["name", "sido", "sigungu"],
  "/api/mindmap": [],
};

export function sharedCacheKey(request: Request): string | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (url.searchParams.has("q")) return null;
  const allowed = CACHE_PARAMETERS[url.pathname];
  if (!allowed) return null;
  if (!hasOnlyUniqueQueryKeys(url.searchParams, allowed)) return null;
  const canonical = new URL(url.origin + url.pathname);
  for (const name of allowed) {
    const value = url.searchParams.get(name);
    if (value) canonical.searchParams.set(name, value.trim());
  }
  canonical.searchParams.sort();
  return canonical.toString();
}

function sharedCache(): Cache | null {
  if (!edgeUsable) return null;
  const store = (globalThis as { caches?: CacheStorageWithDefault }).caches;
  return store?.default ?? null;
}

function dropMemory(key: string): void {
  const entry = memory.get(key);
  if (!entry) return;
  memoryBytes -= entry.payload.body.byteLength;
  memory.delete(key);
}

function readMemory(key: string, now: number): CachedPayload | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    dropMemory(key);
    return null;
  }
  return entry.payload;
}

function writeMemory(key: string, payload: CachedPayload, now: number): void {
  if (payload.body.byteLength > MEMORY_MAX_BYTES) return;
  dropMemory(key);
  memory.set(key, { payload, expiresAt: now + MEMORY_TTL_MS });
  memoryBytes += payload.body.byteLength;
  for (const oldest of memory.keys()) {
    if (memory.size <= MEMORY_MAX_ENTRIES && memoryBytes <= MEMORY_MAX_BYTES) break;
    if (oldest === key) continue;
    dropMemory(oldest);
  }
}

async function toPayload(response: Response): Promise<CachedPayload> {
  return {
    status: response.status,
    headers: [...response.headers.entries()].map(([name, value]) => [name, value] as const),
    body: await response.arrayBuffer(),
  };
}

function toResponse(payload: CachedPayload, state: string): Response {
  const headers = new Headers(payload.headers.map(([name, value]) => [name, value]));
  headers.set("x-shared-cache", state);
  headers.set("x-shared-cache-edge", lastEdgeOutcome);
  return new Response(payload.body, { status: payload.status, headers });
}

function toStorableResponse(payload: CachedPayload): Response {
  return new Response(payload.body, {
    status: payload.status,
    headers: new Headers(payload.headers.map(([name, value]) => [name, value])),
  });
}

async function readEdge(cache: Cache | null, key: string): Promise<CachedPayload | null> {
  if (!cache) return null;
  try {
    const hit = await cache.match(key);
    return hit ? await toPayload(hit) : null;
  } catch (error) {
    edgeUsable = false;
    lastEdgeOutcome = `match-failed:${error instanceof Error ? error.name : "unknown"}`;
    return null;
  }
}

function storeEdge(cache: Cache | null, key: string, payload: CachedPayload): void {
  if (!cache) {
    lastEdgeOutcome = "unavailable";
    return;
  }
  const task = async () => {
    try {
      await cache.put(key, toStorableResponse(payload));
      lastEdgeOutcome = "stored";
    } catch (error) {
      edgeUsable = false;
      lastEdgeOutcome = `put-failed:${error instanceof Error ? error.name : "unknown"}`;
    }
  };
  try {
    after(task);
  } catch {
    lastEdgeOutcome = "after-unavailable";
  }
}

export async function withSharedCache(
  request: Request,
  build: () => Promise<Response>,
): Promise<Response> {
  const key = sharedCacheKey(request);
  if (!key) {
    const response = await build();
    response.headers.set("cache-control", "private, no-store");
    response.headers.set("x-shared-cache", "bypass");
    return response;
  }
  const cached = readMemory(key, Date.now());
  if (cached) return toResponse(cached, "memory");

  // Do not share in-flight promises between requests. A Worker request that
  // awaits I/O started by another request hangs when that request is canceled,
  // which previously left the dashboard waiting forever for its first search.
  const cache = sharedCache();
  const edge = await readEdge(cache, key);
  const payload = edge ?? (await toPayload(await build()));
  if (payload.status >= 200 && payload.status < 300) {
    writeMemory(key, payload, Date.now());
    if (!edge) storeEdge(cache, key, payload);
  }
  return toResponse(payload, edge ? "edge" : "origin");
}
