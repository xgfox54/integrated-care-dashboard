/** Defense in depth for diagnostic strings. Primary logs must remain allowlisted. */
const SENSITIVE_NAMES = new Set([
  "authorization", "proxyauthorization", "cookie", "setcookie", "apikey", "authkey",
  "servicekey", "oc", "lawoc", "koreanlawapikey", "token", "accesstoken", "refreshtoken",
  "idtoken", "password", "passwd", "secret", "clientsecret", "credential", "credentials",
  "publicdataservicekey", "lofinapikey", "kosisapikey", "seoulopendatakey",
]);
const REDACTED = "[CREDENTIAL]";
const MAX_TEXT = 32_768;

function decodeBounded(value: string): string {
  let out = value;
  for (let pass = 0; pass < 2 && /%[0-9a-f]{2}/i.test(out); pass += 1) {
    try { const next = decodeURIComponent(out); if (next === out) break; out = next; }
    catch { break; }
  }
  return out;
}

export function sensitiveLogKey(value: string): boolean {
  const decoded = decodeBounded(value).replace(/\\u([0-9a-f]{4})/gi, (_all, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  return SENSITIVE_NAMES.has(decoded.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

export function redactCredentialText(value: string): string {
  let text = decodeBounded(value.slice(0, MAX_TEXT));
  // A query can contain a secret under an unfamiliar parameter name: drop all of it.
  text = text.replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => {
    try { const url = new URL(raw); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString(); }
    catch { return "[URL]"; }
  });
  text = text.replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n]*/gi, REDACTED);
  // Quoted JSON keys, including embedded JSON in a longer exception message.
  text = text.replace(/(["'])([^"'\r\n]{1,100})\1\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,}\]{\[]+)/g,
    (whole, quote: string, key: string) => sensitiveLogKey(key) ? `${quote}${key}${quote}:"${REDACTED}"` : whole);
  // Unquoted key=value / key:value, including percent-encoded and mixed-case names.
  text = text.replace(/\b([a-z][a-z0-9_%\\-]{0,100})\s*[:=]\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s&;,}\]]+)/gi,
    (whole, key: string) => sensitiveLogKey(key) ? `${key}=${REDACTED}` : whole);
  return text;
}

export function redactCredentialValue(value: unknown): unknown {
  const seen = new WeakSet<object>();
  let remaining = 1_000;
  function visit(item: unknown, depth: number): unknown {
    if (depth > 8 || remaining-- <= 0) return "[TRUNCATED]";
    if (typeof item === "string") return redactCredentialText(item);
    if (item === null || typeof item === "number" || typeof item === "boolean") return item;
    if (typeof item !== "object") return "[UNSUPPORTED]";
    if (seen.has(item)) return "[CIRCULAR]";
    seen.add(item);
    if (Array.isArray(item)) return item.slice(0, 100).map((child) => visit(child, depth + 1));
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item)).slice(0, 100)) {
      if (sensitiveLogKey(key)) out[key] = REDACTED;
      else if ("value" in descriptor) out[key] = visit(descriptor.value, depth + 1);
      else out[key] = "[ACCESSOR]";
    }
    return out;
  }
  return visit(value, 0);
}
