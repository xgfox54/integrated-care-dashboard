import { z } from "zod";
import { decodeSidoBoundaries, locateSido, type SidoRegion } from "./sido-locator.mjs";
import { versionedDataUrl } from "./data-versions.ts";

/** 접속 지역을 정한 방법. 자동 조회는 Edge 결과만 허용한다. */
export type VisitorSource = "edge" | "gps";

export interface VisitorRegion {
  readonly sido: string;
  readonly source: VisitorSource;
}

export type VisitorUpdate =
  | { readonly status: "asking" }
  | { readonly status: "resolved"; readonly region: VisitorRegion | null; readonly final: boolean };

const edgeGeoResponseSchema = z.object({
  sido: z.string().trim().min(1),
  source: z.literal("edge"),
});
const gpsCacheSchema = z.object({
  sido: z.string().trim().min(1),
  at: z.number().finite(),
});
const sidoBoundarySchema = z.object({
  v: z.number(),
  scale: z.number().optional(),
  source: z.string().optional(),
  sido: z.array(z.object({ n: z.string(), p: z.array(z.array(z.array(z.number()))) })),
});
const GPS_CACHE_KEY = "visitor-gps-sido";
const GPS_CACHE_MS = 30 * 60 * 1000;
const EDGE_TIMEOUT_MS = 4000;

let edgePromise: Promise<string | null> | null = null;

/** 서버(/api/geo)가 Cloudflare Edge 메타데이터로 찾은 광역시·도. 한 페이지에서 한 번만 묻는다. */
export function fetchEdgeSido(): Promise<string | null> {
  if (!edgePromise) {
    edgePromise = (async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), EDGE_TIMEOUT_MS);
      try {
        const response = await fetch("/api/geo", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return null;
        const parsed = edgeGeoResponseSchema.safeParse(await response.json());
        return parsed.success ? parsed.data.sido : null;
      } catch {
        return null;
      } finally {
        window.clearTimeout(timer);
      }
    })();
  }
  return edgePromise;
}

let boundaryPromise: Promise<SidoRegion[]> | null = null;

function loadBoundaries(): Promise<SidoRegion[]> {
  if (!boundaryPromise) {
    boundaryPromise = fetch(versionedDataUrl("/data/geo/sido-boundaries.json", "geoBoundaries"), { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error("시도 경계 자료를 불러오지 못했습니다");
        const parsed = sidoBoundarySchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("시도 경계 자료 형식이 올바르지 않습니다");
        return decodeSidoBoundaries(parsed.data);
      })
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
    const parsed = gpsCacheSchema.safeParse(JSON.parse(raw));
    return parsed.success && Date.now() - parsed.data.at < GPS_CACHE_MS ? parsed.data.sido : null;
  } catch {
    return null;
  }
}

function writeCachedGps(sido: string): void {
  try {
    window.sessionStorage.setItem(GPS_CACHE_KEY, JSON.stringify({ sido, at: Date.now() }));
  } catch {
    // 저장소를 쓸 수 없어도 위치 확인은 계속한다.
  }
}

let gpsPromise: Promise<string | null> | null = null;

/**
 * 명시적으로 요청한 위치 동의 후 GPS 좌표로 광역시·도를 판별한다. 좌표는 기기 안에서만 쓰고 서버로 보내지 않는다.
 * 동의하지 않거나 위치를 얻지 못하거나 국외이면 null.
 */
export function requestGpsSido(): Promise<string | null> {
  if (typeof window === "undefined" || typeof navigator === "undefined") return Promise.resolve(null);
  const cached = readCachedGps();
  if (cached) return Promise.resolve(cached);
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

/** 자동 접속 지역은 신뢰된 Edge 응답 하나만 사용하며 브라우저 위치 권한을 묻지 않는다. */
export function watchVisitorRegion(listener: (update: VisitorUpdate) => void): () => void {
  let cancelled = false;
  void fetchEdgeSido().then((sido) => {
    if (!cancelled) {
      listener({ status: "resolved", region: sido ? { sido, source: "edge" } : null, final: true });
    }
  });
  return () => {
    cancelled = true;
  };
}
