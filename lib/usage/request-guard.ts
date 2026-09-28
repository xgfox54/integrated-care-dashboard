// 수집 API 보호: 허용 호스트, 요청 빈도 제한.
// 빈도 제한은 이 서버 인스턴스의 메모리에서만 1분 동안 접속 주소의 해시로 센다. 저장·기록하지 않고 통계와 결합하지 않는다.

const PRODUCTION_HOST = "integrated-care-national-dashboard.xgfox54.chatgpt.site";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const WINDOW_MS = 60_000;
const LIMIT_PER_WINDOW = 120;
const MAX_TRACKED = 10_000;

let windowStart = 0;
const counts = new Map<string, number>();

/** 운영 주소와 로컬 개발 주소에서만 받는다(미리보기 주소의 이용은 섞지 않는다). */
export function isAllowedCollectHost(hostname: string): boolean {
  return hostname === PRODUCTION_HOST || LOCAL_HOSTS.has(hostname);
}

async function clientBucket(request: Request): Promise<string> {
  const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? "local";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("usage-rate:" + address));
  return [...new Uint8Array(digest)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function takeRateToken(request: Request): Promise<boolean> {
  const now = Date.now();
  if (now - windowStart >= WINDOW_MS || counts.size >= MAX_TRACKED) {
    windowStart = now;
    counts.clear();
  }
  const bucket = await clientBucket(request);
  const used = (counts.get(bucket) ?? 0) + 1;
  counts.set(bucket, used);
  return used <= LIMIT_PER_WINDOW;
}

