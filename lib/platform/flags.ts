// 모듈별 운영 스위치(작업지시서 v5 §24.6). 배포 환경변수로 끈다(값이 "false"일 때만 꺼짐, 기본 켜짐).
// 하나를 꺼도 다른 모듈의 수집·이미 공개된 자료·웹·MCP는 계속 동작한다.
import { env } from "cloudflare:workers";

export type FeatureFlag = "EXTERNAL_INGEST_ENABLED" | "FISCAL_INGEST_ENABLED" | "NEWS_DISCOVERY_ENABLED" | "OFFICIAL_SYNC_ENABLED" | "RELEASE_BUNDLE_ENABLED";

/** 공식 보도자료 본문·첨부 일시 판독(§23.12)은 기본 꺼짐. 값이 정확히 "true"일 때만 켠다. */
export function ephemeralAnalysisEnabled(): boolean {
  return String((env as unknown as Record<string, unknown>).PRESS_EPHEMERAL_ANALYSIS_ENABLED ?? "").toLowerCase() === "true";
}

export function flagEnabled(name: FeatureFlag): boolean {
  const value = (env as unknown as Record<string, unknown>)[name];
  return value === undefined || String(value).toLowerCase() !== "false";
}

