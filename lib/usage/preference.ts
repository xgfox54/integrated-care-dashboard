// 이용통계를 이 브라우저에서 모을지 정하는 값. 동의 창은 띄우지 않는다.
// - 관리자가 수집을 켜면, 개인을 알아볼 수 없는 코드값만 기본으로 모은다.
// - 다음 브라우저는 모으지 않는다: 안내 화면에서 「통계에서 빼기」를 고른 브라우저(localStorage에 "1" 하나만 저장),
//   추적 거부 신호(Global Privacy Control, Do Not Track)를 보내는 브라우저, 자동화 도구.
// - 방문자 ID는 만들지 않는다.
import { USAGE_POLICY_VERSION } from "./codes.ts";

export const OPT_OUT_STORAGE_KEY = "icd-usage-optout";
export const OPT_OUT_EVENT = "icd-usage-optout-change";
const CONFIG_CACHE_KEY = "icd-usage-config";
const CONFIG_CACHE_MS = 10 * 60_000;

export interface UsageConfig {
  readonly enabled: boolean;
  readonly policy: string;
}

/** 저장소를 쓸 수 없는 브라우저에서 이번 화면에만 적용할 선택. */
let memoryOptOut: boolean | null = null;

/** 브라우저가 보내는 추적 거부 신호. */
export function hasPrivacySignal(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: unknown };
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1";
}

export function isAutomatedBrowser(): boolean {
  return typeof navigator !== "undefined" && navigator.webdriver === true;
}

/** 이 브라우저에서 「통계에서 빼기」를 골랐는지. */
export function readOptOut(): boolean {
  if (memoryOptOut !== null) return memoryOptOut;
  try {
    return window.localStorage.getItem(OPT_OUT_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeOptOut(optOut: boolean): void {
  memoryOptOut = optOut;
  try {
    if (optOut) window.localStorage.setItem(OPT_OUT_STORAGE_KEY, "1");
    else window.localStorage.removeItem(OPT_OUT_STORAGE_KEY);
    memoryOptOut = null;
  } catch {
    // 저장소를 쓸 수 없으면 이번 화면에만 적용된다.
  }
  window.dispatchEvent(new CustomEvent(OPT_OUT_EVENT, { detail: optOut }));
}

/** 이 브라우저의 이용을 통계에서 빼야 하는지. */
export function isUsageExcluded(): boolean {
  return readOptOut() || hasPrivacySignal() || isAutomatedBrowser();
}

export function forgetUsageConfig(): void {
  try {
    window.sessionStorage.removeItem(CONFIG_CACHE_KEY);
  } catch {
    // 무시
  }
}

/** 같은 탭에서 이미 확인한 수집 설정. 확인한 적이 없거나 오래됐으면 null. */
export function cachedUsageEnabled(): boolean | null {
  try {
    const cached = window.sessionStorage.getItem(CONFIG_CACHE_KEY);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as UsageConfig & { at: number };
    if (Date.now() - parsed.at >= CONFIG_CACHE_MS || parsed.policy !== USAGE_POLICY_VERSION) return null;
    return parsed.enabled === true;
  } catch {
    return null;
  }
}

/** 수집이 켜져 있는지. 같은 탭에서는 10분 동안 기억한다. 실패하면 꺼진 것으로 본다. */
export async function loadUsageConfig(): Promise<UsageConfig> {
  const cached = cachedUsageEnabled();
  if (cached !== null) return { enabled: cached, policy: USAGE_POLICY_VERSION };
  try {
    const response = await fetch("/api/usage/config", { cache: "default", credentials: "same-origin" });
    if (!response.ok) return { enabled: false, policy: USAGE_POLICY_VERSION };
    const payload = (await response.json()) as { enabled?: unknown; policy?: unknown };
    const config = { enabled: payload.enabled === true, policy: String(payload.policy ?? "") };
    try {
      window.sessionStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ ...config, at: Date.now() }));
    } catch {
      // 무시
    }
    return config;
  } catch {
    return { enabled: false, policy: USAGE_POLICY_VERSION };
  }
}
