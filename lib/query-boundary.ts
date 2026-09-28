export function hasOnlyUniqueQueryKeys(
  params: URLSearchParams,
  allowed: readonly string[],
): boolean {
  const allowlist = new Set(allowed);
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (!allowlist.has(key) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}
