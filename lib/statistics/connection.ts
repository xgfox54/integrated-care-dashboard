import type { StatisticsCatalogItem, StatisticsResult } from './types.ts';

export function statisticsConnection(item: StatisticsCatalogItem, result: StatisticsResult | undefined) {
  if (!item.data_available || !result) return {
    status: 'SOURCE_ONLY' as const, numeric_data_available: false, reason: 'NUMERIC_TABLE_NOT_CONNECTED',
    retry_eligible: false, retry_at: null, error_code: null,
    note: '공식 목록에 수록된 항목입니다. 수치표 연결은 별도 작업이 필요하며 API 재시도만으로 연결되지 않습니다. 값은 0이 아닙니다.',
  };
  const refresh = result.auto_refresh;
  return { status: result.refresh_error ? 'REFRESH_FAILED_WITH_SNAPSHOT' as const : refresh?.status === 'checking' ? 'CHECKING' as const : 'CONNECTED' as const,
    numeric_data_available: true, reason: result.refresh_error ?? 'VERIFIED_NUMERIC_TABLE',
    retry_eligible: refresh?.enabled === true, retry_at: refresh?.next_check_at ?? null, error_code: result.refresh_error,
    latest_period: result.dataset.periods.at(-1) ?? null, checked_at: result.checked_at,
    note: result.refresh_error ? '최신 확인은 실패했지만 마지막 정상 수치를 제공합니다. 자동 수집의 재시도 예정과 자료 기준시점을 구분하세요.' : '연결된 확인본의 기준시점과 결측 상태를 함께 사용하세요.' };
}
