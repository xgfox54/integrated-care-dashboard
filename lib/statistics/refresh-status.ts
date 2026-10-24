import type { StatisticsAutoRefresh } from "./types.ts";

const ERROR_REASONS: Readonly<Record<string, string>> = {
  SOURCE_TIMEOUT: "공식 통계 서버의 응답이 늦어 확인을 완료하지 못했습니다.",
  SOURCE_RATE_LIMITED: "공식 통계 서버의 요청 한도로 대기 중입니다.",
  SOURCE_KEY_REQUIRED: "관리자가 API 인증키를 등록해야 합니다.",
  SOURCE_KEY_UNAVAILABLE: "저장된 API 인증키를 읽지 못했습니다.",
  SOURCE_KEY_REJECTED: "공식 통계 서버가 API 인증키를 승인하지 않았습니다.",
  SOURCE_FORMAT_CHANGED: "공식 통계의 항목·단위·수록시점이 달라 검증이 필요합니다.",
  SOURCE_PERIOD_REGRESSION: "원자료의 수록시점이 기존 자료보다 이전이어서 반영을 보류했습니다.",
  SOURCE_API_UNAVAILABLE: "공식 통계 API가 정상 자료를 반환하지 않았습니다.",
  SOURCE_TOO_LARGE: "원자료가 처리 한도를 넘어 조회 범위 확인이 필요합니다.",
  STATISTICS_STORAGE_UNAVAILABLE: "통계 저장소를 확인하지 못했습니다.",
  STATISTICS_STORAGE_INVALID: "저장 자료 검증이 필요합니다.",
};

export function statisticsRefreshReason(code: string | null | undefined): string | null {
  return code ? ERROR_REASONS[code] ?? "공식 자료 확인을 완료하지 못해 재확인이 필요합니다." : null;
}

export function statisticsRefreshLabel(refresh: StatisticsAutoRefresh): string {
  if (!refresh.enabled) return "자동 확인 대상 아님";
  switch (refresh.status) {
    case "checking": return "확인 중";
    case "retry_wait": return "재시도 대기";
    case "unavailable": return "확인 불가";
    case "idle": return refresh.continuation_pending ? "이어받기 대기" : "첫 확인 대기";
    case "current": return "정상";
    default: { const exhaustive: never = refresh.status; return exhaustive; }
  }
}
