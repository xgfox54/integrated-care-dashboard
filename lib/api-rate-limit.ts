import type { SqlDatabase } from "./sql-database.ts";
import { readBoundedJson } from "./request-body.ts";
import { canonicalRequestPath } from "./request-path.ts";

export interface ApiRatePolicy {
  readonly name: string;
  readonly limit: number;
  readonly windowSeconds: number;
  /** 플랫폼이 검증한 사용자 단위 한도. 있으면 이 사용자 버킷과 IP 보호 버킷(backstopLimit)을 함께 센다. */
  readonly subjectLimit?: number;
  /** 검증된 사용자 요청에 적용하는 IP 보호 한도. AI 서비스 공용 출구 IP에서 여러 사용자가 한도를 나눠 쓰지 않게 한다. */
  readonly backstopLimit?: number;
  /** 경로 전체가 한 창에서 쓸 수 있는 총량. 인증 없는 공개 경로가 공용 D1 처리량을 혼자 차지하지 않게 한다. */
  readonly globalLimit?: number;
}

const CHATGPT_MCP_POLICY: ApiRatePolicy = { name: "mcp", limit: 120, windowSeconds: 60, globalLimit: 300 };
// Protocol handshakes stay outside tool quotas, but still consume bounded HTTP capacity.
const MCP_TRANSPORT_POLICY: ApiRatePolicy = { name: "mcp-transport", limit: 600, windowSeconds: 60, globalLimit: 1800 };

const API_RATE_POLICIES: Readonly<Record<string, ApiRatePolicy>> = {
  "/api/dataset/export": { name: "dataset-export", limit: 10, windowSeconds: 60 },
  "/api/dataset/export/xlsx": { name: "dataset-export", limit: 10, windowSeconds: 60 },
  "/api/gov/search": { name: "government-search", limit: 30, windowSeconds: 60 },
  "/api/geo": { name: "geo", limit: 60, windowSeconds: 60 },
  "/api/dataset/bundle": { name: "dataset-bundle", limit: 60, windowSeconds: 60 },
  "/api/dataset": { name: "dataset", limit: 120, windowSeconds: 60 },
  "/api/dataset/search": { name: "dataset-search", limit: 120, windowSeconds: 60 },
  "/api/dataset/service": { name: "dataset-service", limit: 120, windowSeconds: 60 },
  "/api/dataset/summary": { name: "dataset-summary", limit: 120, windowSeconds: 60 },
  // /mcp는 HTTP 요청이 아니라 도구 호출(tools/call) 수로 센다(korean-law-mcp와 같은 원칙: 초기화·알림·도구 목록은 세지 않음).
  // ChatGPT용 로그인 없는(인증없음) 공개 경로. ChatGPT는 출구 IP를 여러 이용자가 함께 쓰므로 IP당 120회, 경로 전체는 분당 300회.
  "/chatgpt/mcp": CHATGPT_MCP_POLICY,
  "/mcp": CHATGPT_MCP_POLICY,
  // Claude·Perplexity·Gemini 등 OAuth 없는 원격 MCP 경로. 출구 IP 단위 분당 120회, 경로 전체 분당 300회로 묶는다.
  // subjectLimit은 호출부가 clientKey를 넘길 때만 쓰인다(현재 worker는 넘기지 않는다).
  "/claude/mcp": { name: "mcp-claude", limit: 120, windowSeconds: 60, subjectLimit: 120, backstopLimit: 600, globalLimit: 300 },
  "/api/law": { name: "law", limit: 30, windowSeconds: 60 },
  "/api/statistics": { name: "statistics", limit: 60, windowSeconds: 60 },
  "/api/manuals/status": { name: "manual-status", limit: 60, windowSeconds: 60 },
  "/api/press/status": { name: "press-status", limit: 120, windowSeconds: 60 },
  "/api/press/status/detail": { name: "press-status-detail", limit: 60, windowSeconds: 60 },
  "/api/budget": { name: "budget", limit: 120, windowSeconds: 60 },
};

export function apiRatePolicy(pathname: string): ApiRatePolicy | null {
  return API_RATE_POLICIES[canonicalRequestPath(pathname)] ?? null;
}

let mcpActivityMemo: { readonly at: number; readonly window: number; readonly active: boolean } | null = null;
const MCP_ACTIVITY_MEMO_MS = 20_000;

/**
 * 지금 창이나 직전 창(최근 1~2분)에 MCP 도구 호출 기록이 있는지 본다. 쓰기가 많은 배경 수집이 검색과 같은 D1을
 * 다투지 않도록 양보할 때 쓴다. 한도 버킷 키(mcp:<창>:...)의 기본키 범위만 읽는다.
 */
export async function mcpRecentlyActive(db: D1Database | SqlDatabase, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const window = Math.floor(nowSeconds / API_RATE_POLICIES["/mcp"].windowSeconds);
  if (mcpActivityMemo && mcpActivityMemo.window === window && Date.now() - mcpActivityMemo.at < MCP_ACTIVITY_MEMO_MS) return mcpActivityMemo.active;
  const ranges = ["mcp", "mcp-claude"].flatMap((name) => [window, window - 1].flatMap((value) => [name + ":" + value + ":", name + ":" + value + ";"]));
  const row = await db.prepare("SELECT 1 AS found FROM api_rate_limit WHERE " + Array.from({ length: ranges.length / 2 }, () => "(bucket_key >= ? AND bucket_key < ?)").join(" OR ") + " LIMIT 1")
    .bind(...ranges).first<{ found: number }>();
  mcpActivityMemo = { at: Date.now(), window, active: Boolean(row) };
  return mcpActivityMemo.active;
}

const MCP_PEEK_MAX_BYTES = 256 * 1024;

/**
 * /mcp 요청이 한도에서 차지할 횟수: 본문의 tools/call 개수(배치는 호출 수만큼).
 * 본문을 읽지 못하거나 크기를 넘으면 1로 센다(본 처리기가 같은 기준으로 거절한다).
 */
export async function mcpToolCallWeight(request: Request): Promise<number> {
  if (request.method !== "POST") return 0;
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > MCP_PEEK_MAX_BYTES) return 1;
  try {
    const body = await readBoundedJson(request.clone(), { maxBytes: MCP_PEEK_MAX_BYTES });
    const messages = Array.isArray(body) ? body : [body];
    return messages.filter((message) => typeof message === "object" && message !== null && (message as { method?: unknown }).method === "tools/call").length;
  } catch {
    return 1;
  }
}

/** Only Cloudflare's trusted ingress IP is used; never fall back to X-Forwarded-For. */
function trustedEdgeIp(request: Request): string {
  const raw = request.headers.get("cf-connecting-ip")?.trim().toLowerCase() ?? "";
  if (raw.includes(":")) {
    try { return new URL("https://[" + raw + "]/").hostname; } catch { return "unknown-edge"; }
  }
  const parts = raw.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return "unknown-edge";
  return parts.map(Number).join(".");
}

async function identityDigest(kind: string, identity: string, window: number): Promise<string> {
  const value = ["rate-v2", kind, String(window), identity].join("\u0000");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** No cookies, bearer values, User-Agent, or language in quota identity. Window-scoped storage only. */
export async function rateLimitFingerprint(request: Request, window = 0): Promise<string> {
  return identityDigest("ip", trustedEdgeIp(request), window);
}

export interface RateLimitContext {
  /** Server-selected MCP HTTP admission, counted before body parsing; shared by both public endpoints. */
  readonly transport?: boolean;
  /** Set only AFTER authentication by trusted server middleware, never from an arbitrary header. */
  readonly verifiedSubject?: string;
  /**
   * 이용자가 보낸 검증되지 않은 식별값. 별도 버킷으로만 세며, IP 보호선과 경로 총량이 함께 적용된다.
   * verifiedSubject가 있으면 쓰지 않는다. 현재 운영 경로는 이 값을 넘기지 않는다.
   */
  readonly clientKey?: string;
  /**
   * 검증된 사용자 요청에만 쓰는 지연 기록. 주면 실행 환경의 최근 집계로 즉시 판단하고 D1 기록은 응답 뒤(waitUntil)에 한다.
   * D1 왕복(약 180ms)을 요청 경로에서 빼는 대신 같은 창 안의 짧은 순간 초과를 허용한다. 익명 요청에는 쓰지 않는다.
   */
  readonly defer?: (task: Promise<unknown>) => void;
  /**
   * 이 요청이 차지하는 횟수(기본 1). /mcp는 본문의 tools/call 개수를 넘긴다(배치는 호출 수만큼).
   * 0이면 세지 않는다(initialize·알림·tools/list·server/discover처럼 비용이 거의 없는 요청).
   */
  readonly weight?: number;
  readonly reserveCalls?: number;
}

type Reservation = { remaining: number; blocked: boolean; readonly expiresAt: number; tail: Promise<unknown> };
const reservations = new WeakMap<object, Map<string, Reservation>>();

// 지연 기록 모드의 실행 환경별 최근 집계(버킷 키 → 횟수). 창이 지나면 지운다.
const recentCounts = new Map<string, { count: number; expiresAt: number }>();
function pruneRecent(nowSeconds: number): void {
  if (recentCounts.size < 2000) return;
  for (const [key, entry] of recentCounts) if (entry.expiresAt <= nowSeconds) recentCounts.delete(key);
}

function limitedResponse(expiresAt: number, nowSeconds: number): Response {
  return Response.json(
    { error: "RATE_LIMITED", message: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", requestId: crypto.randomUUID() },
    { status: 429, headers: { "cache-control": "no-store", "retry-after": String(Math.max(1, expiresAt - nowSeconds)) } },
  );
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
  context: RateLimitContext = {},
): Promise<Response | null> {
  const routePolicy = apiRatePolicy(new URL(request.url).pathname);
  const policy = context.transport && (routePolicy?.name === "mcp" || routePolicy?.name === "mcp-claude") ? MCP_TRANSPORT_POLICY : routePolicy;
  if (!policy) return null;
  const weight = context.weight === undefined ? 1 : context.weight;
  if (!Number.isSafeInteger(weight) || weight < 0) return unavailable();
  if (weight === 0) return null;
  if (!db) return unavailable();

  const window = Math.floor(nowSeconds / policy.windowSeconds);
  const fingerprint = await rateLimitFingerprint(request, window);
  const expiresAt = (window + 1) * policy.windowSeconds;
  const identities: { key: string; limit: number }[] = [];
  const subject = context.verifiedSubject ?? context.clientKey;
  if (subject) {
    if (subject.length > 512) return unavailable();
    identities.push({ key: "ip-backstop-v1:" + fingerprint, limit: policy.backstopLimit ?? policy.limit });
    identities.push(context.verifiedSubject
      ? { key: "subject-v2:" + await identityDigest("subject", context.verifiedSubject, window), limit: policy.subjectLimit ?? policy.limit }
      : { key: "client-v1:" + await identityDigest("client", subject, window), limit: policy.subjectLimit ?? policy.limit });
  } else {
    identities.push({ key: "ip-v2:" + fingerprint, limit: policy.limit });
  }
  if (policy.globalLimit) identities.push({ key: "global-v1", limit: policy.globalLimit });
  const keys = identities.map((identity) => [policy.name, window, identity.key].join(":"));
  const countAll = async (amount = weight): Promise<(number | undefined)[]> => {
    const statements = keys.map((key) => db.prepare(
      "INSERT INTO api_rate_limit (bucket_key, request_count, expires_at) VALUES (?, ?, ?) ON CONFLICT(bucket_key) DO UPDATE SET request_count = request_count + ? RETURNING request_count",
    ).bind(key, amount, expiresAt, amount));
    // 버킷이 둘이면 D1 왕복 한 번(batch)으로 함께 센다. batch가 없는 저장소는 차례로 센다.
    return statements.length > 1 && typeof db.batch === "function"
      ? (await db.batch(statements)).map((result) => (result as D1Result<{ request_count: number }>)?.results?.[0]?.request_count)
      : await Promise.all(statements.map(async (statement) => (await statement.first<{ request_count: number }>())?.request_count));
  };
  if ((policy.name === "mcp" || policy.name === "mcp-claude" || policy.name === "mcp-transport" || policy.name === "budget") && context.reserveCalls) {
    const size = context.reserveCalls;
    if (!Number.isSafeInteger(size) || size < 1 || size > 10) return unavailable();
    let leases = reservations.get(db);
    if (!leases) { leases = new Map(); reservations.set(db, leases); }
    for (const [key, value] of leases) if (value.expiresAt <= nowSeconds) leases.delete(key);
    const group = keys.join("|");
    let lease = leases.get(group);
    if (!lease) {
      if (leases.size >= 2000) {
        const first = leases.keys().next().value;
        if (first !== undefined) leases.delete(first);
      }
      lease = { remaining: 0, blocked: false, expiresAt, tail: Promise.resolve() }; leases.set(group, lease);
    }
    const current = lease;
    const task = current.tail.then(async (): Promise<Response | null> => {
      if (current.blocked) return limitedResponse(expiresAt, nowSeconds);
      if (current.remaining >= weight) { current.remaining -= weight; return null; }
      const amount = Math.max(size, weight - current.remaining);
      try {
        const counts = await countAll(amount);
        if (identities.some((identity, index) => (counts[index] ?? identity.limit + 1) > identity.limit)) {
          current.blocked = true;
          return limitedResponse(expiresAt, nowSeconds);
        }
        current.remaining += amount - weight;
        return null;
      } catch {
        return unavailable();
      }
    });
    current.tail = task;
    return task;
  }
  if (context.verifiedSubject && context.defer) {
    pruneRecent(nowSeconds);
    if (identities.some((identity, index) => (recentCounts.get(keys[index])?.count ?? 0) + weight > identity.limit)) return limitedResponse(expiresAt, nowSeconds);
    for (const key of keys) recentCounts.set(key, { count: (recentCounts.get(key)?.count ?? 0) + weight, expiresAt });
    context.defer(countAll().then((counts) => {
      counts.forEach((count, index) => { if (typeof count === "number") recentCounts.set(keys[index], { count: Math.max(count, recentCounts.get(keys[index])?.count ?? 0), expiresAt }); });
    }).catch(() => { console.error("rate limit deferred write failed"); }));
    return null;
  }
  try {
    let blocked = false;
    const counts = await countAll();
    identities.forEach((identity, index) => { if ((counts[index] ?? identity.limit + 1) > identity.limit) blocked = true; });
    if (!blocked) return null;
  } catch {
    return unavailable();
  }
  return limitedResponse(expiresAt, nowSeconds);
}

export async function pruneExpiredRateLimits(db: D1Database | undefined): Promise<void> {
  if (!db) return;
  await db.prepare("DELETE FROM api_rate_limit WHERE expires_at < ?")
    .bind(Math.floor(Date.now() / 1000) - 300)
    .run();
}
