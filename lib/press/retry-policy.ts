const BASE_SECONDS = 30 * 60;
const MAX_SECONDS = 6 * 60 * 60;

export function retryAfterSeconds(value: string | null, nowSeconds: number): number {
  if (!value) return 0;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return Number.isSafeInteger(seconds) ? seconds : 0;
  }
  if (!/[A-Za-z]{3}/.test(text)) return 0;
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, Math.ceil(date / 1000 - nowSeconds)) : 0;
}

export interface RetryPolicy {
  readonly failures: number;
  readonly retryAfterSeconds: number;
  readonly nowSeconds: number;
  readonly random?: () => number;
}

export function retryDelaySeconds(policy: RetryPolicy): number {
  const exponential = BASE_SECONDS * 2 ** Math.min(5, Math.max(0, policy.failures - 1));
  const jitter = Math.floor(Math.min(exponential, MAX_SECONDS) * 0.2 * (policy.random ?? Math.random)());
  return Math.max(policy.retryAfterSeconds, Math.min(MAX_SECONDS, exponential + jitter));
}
