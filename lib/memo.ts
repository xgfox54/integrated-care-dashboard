/**
 * 끝난 결과만 ttlMs 동안 기억한다. 진행 중인 계산(Promise)은 요청끼리 나눠 쓰지 않는다.
 * Workers에서는 다른 요청이 시작한 I/O를 기다리지 않도록 각 요청의 계산을 독립시킨다.
 * 관계성 지도 등의 요청이 취소되어도 뒤 요청에 영향을 주지 않는다(edge-cache.ts 참고).
 */
export function memoizeForTtl<T>(load: () => Promise<T>, ttlMs: number): () => Promise<T> {
  let cached: { readonly value: T; readonly expiresAt: number } | null = null;
  let generation = 0;

  return async () => {
    if (cached && Date.now() < cached.expiresAt) return cached.value;
    const requestGeneration = ++generation;
    const value = await load();
    if (requestGeneration === generation) cached = { value, expiresAt: Date.now() + ttlMs };
    return value;
  };
}
