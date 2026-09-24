import { decodeSidoBoundaries, locateSido, type SidoBoundaryData, type SidoRegion } from "./sido-locator.mjs";
import { versionedDataUrl } from "./data-versions.ts";

/** 접속 지역을 정한 방법. 모바일은 GPS(위치 동의)를 먼저 쓰고, 동의하지 않거나 실패하면 IP로 확인한다. */
export type VisitorSource = "gps" | "ip";

export interface VisitorRegion {
  sido: string;
  source: VisitorSource;
}

export type VisitorUpdate =
  | { status: "asking" }
  | { status: "resolved"; region: VisitorRegion | null; final: boolean };

const GPS_CACHE_KEY = "visitor-gps-sido";
const GPS_CACHE_MS = 30 * 60 * 1000;
const IP_TIMEOUT_MS = 4000;
/** 이미 위치 권한이 있을 때 GPS 결과를 기다리는 시간 */
const GPS_WAIT_GRANTED_MS = 6000;
/** 위치 동의 창에 답하는 시간까지 포함해 기다리는 시간 */
const GPS_WAIT_PROMPT_MS = 15000;

export function isMobileVisitor(): boolean {
  if (typeof navigator === "undefined") return false;
  const hint = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile;
  if (hint === true) return true;
  const agent = navigator.userAgent;
  if (/Android|iPhone|iPod|iPad|Mobile|Windows Phone/i.test(agent)) return true;
  // iPadOS는 데스크톱 Safari처럼 보고하므로 터치 지점 수로 구분한다.
  return /Macintosh/.test(agent) && navigator.maxTouchPoints > 1;
}

let ipPromise: Promise<string | null> | null = null;

/** 서버(/api/geo)가 접속 IP로 찾은 광역시·도. 한 페이지에서 한 번만 묻는다. */
export function fetchIpSido(): Promise<string | null> {
  if (!ipPromise) {
    ipPromise = (async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), IP_TIMEOUT_MS);
      try {
        const response = await fetch("/api/geo", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return null;
        const payload = (await response.json()) as { sido?: unknown };
        return typeof payload.sido === "string" && payload.sido ? payload.sido : null;
      } catch {
        return null;
      } finally {
        window.clearTimeout(timer);
      }
    })();
  }
  return ipPromise;
}

let boundaryPromise: Promise<SidoRegion[]> | null = null;

function loadBoundaries(): Promise<SidoRegion[]> {
  if (!boundaryPromise) {
    boundaryPromise = fetch(versionedDataUrl("/data/geo/sido-boundaries.json", "geoBoundaries"), { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error("시도 경계 자료를 불러오지 못했습니다");
        return response.json() as Promise<SidoBoundaryData>;
      })
      .then(decodeSidoBoundaries)
      .catch((error: unknown) => {
        boundaryPromise = null;
        throw error;
      });
  }
  return boundaryPromise;
}

function readCachedGps(): string | null {
  try {
    const raw = window.sessionStorage.getItem(GPS_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { sido?: string; at?: number };
    return cached.sido && cached.at && Date.now() - cached.at < GPS_CACHE_MS ? cached.sido : null;
  } catch {
    return null;
  }
}

function writeCachedGps(sido: string) {
  try {
    window.sessionStorage.setItem(GPS_CACHE_KEY, JSON.stringify({ sido, at: Date.now() }));
  } catch {
    // 저장소를 쓸 수 없어도 위치 확인은 계속한다.
  }
}

async function geolocationPermission(): Promise<PermissionState | "unknown"> {
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    return status?.state ?? "unknown";
  } catch {
    return "unknown";
  }
}

let gpsPromise: Promise<string | null> | null = null;

/**
 * 위치 동의를 받아 GPS 좌표로 광역시·도를 판별한다. 좌표는 기기 안에서만 쓰고 서버로 보내지 않는다.
 * 동의하지 않거나 위치를 얻지 못하거나 국외이면 null.
 */
export function requestGpsSido(): Promise<string | null> {
  if (!gpsPromise) {
    gpsPromise = new Promise((resolve) => {
      if (!("geolocation" in navigator)) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          loadBoundaries()
            .then((regions) => {
              const sido = locateSido(position.coords.latitude, position.coords.longitude, regions);
              if (sido) writeCachedGps(sido);
              resolve(sido);
            })
            .catch(() => resolve(null));
        },
        () => resolve(null),
        { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 10000 },
      );
    });
  }
  return gpsPromise;
}

/**
 * 접속 지역을 알려 준다. 데스크톱은 IP, 모바일은 위치 동의 후 GPS를 먼저 쓰고
 * 동의하지 않거나 실패하면 IP를 쓴다. GPS가 늦게 도착하면 한 번 더(final) 알려 준다.
 */
export function watchVisitorRegion(listener: (update: VisitorUpdate) => void): () => void {
  let cancelled = false;
  const emit = (update: VisitorUpdate) => {
    if (!cancelled) listener(update);
  };
  const fromIp = async (final: boolean) => {
    const sido = await fetchIpSido();
    emit({ status: "resolved", region: sido ? { sido, source: "ip" } : null, final });
  };

  // IP 조회는 GPS를 기다리는 동안 미리 시작해 두어, 동의하지 않으면 바로 쓴다.
  void fetchIpSido();
  if (!isMobileVisitor() || !("geolocation" in navigator)) {
    void fromIp(true);
    return () => {
      cancelled = true;
    };
  }

  const cached = readCachedGps();
  if (cached) {
    emit({ status: "resolved", region: { sido: cached, source: "gps" }, final: true });
    return () => {
      cancelled = true;
    };
  }

  void (async () => {
    const permission = await geolocationPermission();
    if (permission === "denied") {
      await fromIp(true);
      return;
    }
    if (permission !== "granted") emit({ status: "asking" });
    const gps = requestGpsSido();
    let timer = 0;
    const timeout = new Promise<{ settled: false; sido: null }>((resolve) => {
      timer = window.setTimeout(
        () => resolve({ settled: false, sido: null }),
        permission === "granted" ? GPS_WAIT_GRANTED_MS : GPS_WAIT_PROMPT_MS,
      );
    });
    const first = await Promise.race([
      gps.then((sido) => ({ settled: true as const, sido })),
      timeout,
    ]);
    window.clearTimeout(timer);
    if (first.sido) {
      emit({ status: "resolved", region: { sido: first.sido, source: "gps" }, final: true });
      return;
    }
    await fromIp(first.settled);
    if (first.settled) return;
    const late = await gps;
    if (late) emit({ status: "resolved", region: { sido: late, source: "gps" }, final: true });
  })();

  return () => {
    cancelled = true;
  };
}
