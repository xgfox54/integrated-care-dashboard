// Cloudflare Worker용 korean-law-mcp 메모리 캐시 대체 구현.
// 원본 cache.js의 전역 setInterval은 Worker 모듈 초기화 단계에서 허용되지 않으므로,
// 조회·저장 시점의 지연 정리로 같은 LRU/TTL 동작을 유지한다.
interface CacheEntry<T> {
  readonly data: T;
  readonly timestamp: number;
  readonly ttl: number;
}

export class SimpleCache {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly maxSize: number;
  private operations = 0;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  private maintain(): void {
    this.operations += 1;
    if (this.operations % 64 === 0) this.cleanup();
  }

  set<T>(key: string, data: T, ttl = 24 * 60 * 60 * 1000): void {
    this.maintain();
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) this.evictOne();
    this.cache.delete(key);
    this.cache.set(key, { data, timestamp: Date.now(), ttl });
  }

  private evictOne(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        return;
      }
    }
    const oldestKey = this.cache.keys().next().value as string | undefined;
    if (oldestKey !== undefined) this.cache.delete(oldestKey);
  }

  get<T>(key: string): T | null {
    this.maintain();
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data as T;
  }

  has(key: string): boolean {
    this.maintain();
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > entry.ttl) this.cache.delete(key);
    }
  }
}

export const lawCache = new SimpleCache(500);
