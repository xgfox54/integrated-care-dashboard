export function normalizeIndexKey(raw: string): string | null {
  let value = raw.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== "www.index.go.kr" || !url.pathname.startsWith("/unity/openApi/")) return null;
      value = url.searchParams.get("idntfcId") ?? "";
    } catch {
      return null;
    }
  }
  return /^[A-Za-z0-9+/=_-]{1,512}$/.test(value) ? value : null;
}
