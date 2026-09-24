export function memoizeForTtl<T>(load: () => Promise<T>, ttlMs: number): () => Promise<T> {
  let pending: Promise<T> | null = null;
  let expiresAt = 0;

  return () => {
    const now = Date.now();
    if (pending && now < expiresAt) return pending;
    expiresAt = now + ttlMs;
    const current = load().catch((error: unknown) => {
      if (pending === current) {
        pending = null;
        expiresAt = 0;
      }
      throw error;
    });
    pending = current;
    return current;
  };
}
