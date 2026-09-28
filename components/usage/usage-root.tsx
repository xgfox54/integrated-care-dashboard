"use client";

import { useEffect } from "react";

import { isUsageExcluded, loadUsageConfig, OPT_OUT_EVENT, OPT_OUT_STORAGE_KEY } from "@/lib/usage/preference";
import { detachUsageSink } from "@/lib/usage/track";

type CollectorModule = typeof import("@/lib/usage/collector");
let collector: CollectorModule | null = null;

function isAdminPath(): boolean {
  // 관리자 화면(/admin, /admin/…)에서는 수집하지 않는다.
  return window.location.pathname.startsWith("/admin");
}

async function startCollector(): Promise<void> {
  collector ??= await import("@/lib/usage/collector");
  // 불러오는 사이에 「통계에서 빼기」를 골랐으면 시작하지 않는다.
  if (isUsageExcluded()) return;
  collector.startUsageCollector();
}

function stopCollector(): void {
  collector?.stopUsageCollector();
  detachUsageSink("off");
}

/**
 * 이용통계 조율. 동의 창은 띄우지 않는다.
 * 관리자가 수집을 켰고 이 브라우저가 제외 대상(통계에서 빼기 선택, 추적 거부 신호, 자동화 도구)이 아니면 수집기를 불러온다.
 * 제외 대상 브라우저는 설정 확인 요청도 보내지 않는다. 관리자 화면에서는 아무것도 하지 않는다.
 */
export function UsageRoot() {
  useEffect(() => {
    if (isAdminPath()) {
      detachUsageSink("off");
      return;
    }
    let cancelled = false;

    const evaluate = async () => {
      if (isUsageExcluded()) {
        stopCollector();
        return;
      }
      const config = await loadUsageConfig();
      if (cancelled) return;
      if (!config.enabled || isUsageExcluded()) {
        stopCollector();
        return;
      }
      await startCollector();
    };

    const run = () => {
      evaluate().catch(() => undefined);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === OPT_OUT_STORAGE_KEY || event.key === null) run();
    };
    // 첫 화면을 다 그린 뒤에 확인한다(첫 표시 속도에 영향 없음).
    const idle = typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(run, { timeout: 1500 })
      : window.setTimeout(run, 300);
    window.addEventListener(OPT_OUT_EVENT, run);
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      window.removeEventListener(OPT_OUT_EVENT, run);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return null;
}
