const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "upgrade-insecure-requests",
].join("; ");

// Migration candidate only: violations appear in the browser console. No reports or user URLs are sent elsewhere.
const CSP_REPORT_ONLY_POLICY = ["script-src 'self'", "script-src-attr 'none'", "object-src 'none'", "base-uri 'self'"].join("; ");

const SECURITY_HEADERS: readonly (readonly [string, string])[] = [
  ["content-security-policy", CONTENT_SECURITY_POLICY],
  ["strict-transport-security", "max-age=31536000; includeSubDomains"],
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "SAMEORIGIN"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["permissions-policy", "geolocation=(self), camera=(), microphone=(), browsing-topics=()"],
];

export function scriptNoncePolicy(nonce: string): string {
  if (!/^[A-Za-z0-9+/]{24}$/.test(nonce)) throw new RangeError("Invalid script nonce");
  return CONTENT_SECURITY_POLICY.replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'nonce-" + nonce + "'; script-src-attr 'none'");
}

export function secureResponse(response: Response, nonce?: string): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of SECURITY_HEADERS) headers.set(name, value);
  headers.delete("access-control-allow-origin");
  if (headers.get("content-type")?.toLowerCase().startsWith("text/html")) {
    if (nonce) {
      headers.set("content-security-policy", scriptNoncePolicy(nonce));
      headers.set("cache-control", "private, no-store");
      headers.delete("etag");
      headers.delete("content-security-policy-report-only");
    } else {
      headers.set("content-security-policy-report-only", CSP_REPORT_ONLY_POLICY);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function requestUrlIsTooLong(request: Request): boolean {
  return request.url.length > 4096;
}
