export interface ApiRatePolicy {
  readonly name: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

const API_RATE_POLICIES: Readonly<Record<string, ApiRatePolicy>> = {
  "/api/dataset/export": { name: "dataset-export", limit: 10, windowSeconds: 60 },
  "/api/gov/search": { name: "government-search", limit: 30, windowSeconds: 60 },
  "/api/geo": { name: "geo", limit: 60, windowSeconds: 60 },
  "/api/dataset/bundle": { name: "dataset-bundle", limit: 60, windowSeconds: 60 },
  "/api/dataset": { name: "dataset", limit: 120, windowSeconds: 60 },
  "/api/dataset/search": { name: "dataset-search", limit: 120, windowSeconds: 60 },
  "/api/dataset/service": { name: "dataset-service", limit: 120, windowSeconds: 60 },
  "/api/dataset/summary": { name: "dataset-summary", limit: 120, windowSeconds: 60 },
  "/mcp": { name: "mcp", limit: 60, windowSeconds: 60 },
  "/api/budget": { name: "budget", limit: 120, windowSeconds: 60 },
};

export function apiRatePolicy(pathname: string): ApiRatePolicy | null {
  return API_RATE_POLICIES[pathname] ?? null;
}

export async function rateLimitFingerprint(request: Request): Promise<string> {
  const identity = [
    request.headers.get("cf-connecting-ip") ?? "",
    request.headers.get("cookie")?.slice(0, 2048) ?? "",
    request.headers.get("user-agent")?.slice(0, 256) ?? "",
    request.headers.get("accept-language")?.slice(0, 128) ?? "",
  ].join("\u0000");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function unavailable(): Response {
  return Response.json(
    {
      error: "RATE_LIMIT_UNAVAILABLE",
      message: "요청 보호 기능을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      requestId: crypto.randomUUID(),
    },
    { status: 503, headers: { "cache-control": "no-store", "retry-after": "5" } },
  );
}

export async function enforceApiRateLimit(
  request: Request,
  db: D1Database | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Response | null> {
  const policy = apiRatePolicy(new URL(request.url).pathname);
  if (!policy) return null;
  if (!db) return unavailable();

  const fingerprint = await rateLimitFingerprint(request);
  const window = Math.floor(nowSeconds / policy.windowSeconds);
  const expiresAt = (window + 1) * policy.windowSeconds;
  const bucketKey = `${policy.name}:${window}:${fingerprint}`;
  try {
    const row = await db.prepare(
      "INSERT INTO api_rate_limit (bucket_key, request_count, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket_key) DO UPDATE SET request_count = request_count + 1 RETURNING request_count",
    ).bind(bucketKey, expiresAt).first<{ request_count: number }>();
    if ((row?.request_count ?? policy.limit + 1) <= policy.limit) return null;
  } catch {
    return unavailable();
  }

  return Response.json(
    {
      error: "RATE_LIMITED",
      message: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
      requestId: crypto.randomUUID(),
    },
    {
      status: 429,
      headers: {
        "cache-control": "no-store",
        "retry-after": String(Math.max(1, expiresAt - nowSeconds)),
      },
    },
  );
}

export async function pruneExpiredRateLimits(db: D1Database | undefined): Promise<void> {
  if (!db) return;
  await db.prepare("DELETE FROM api_rate_limit WHERE expires_at < ?")
    .bind(Math.floor(Date.now() / 1000) - 300)
    .run();
}
