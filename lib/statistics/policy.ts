export const STATISTICS_DAY = 86_400_000;
export const STATISTICS_HOUR = 3_600_000;
export const POPULATION_SCOPE = "population:mois";
export const STATISTICS_REFRESH_POLICY = "지표누리 API 33종과 지역별 인구 3종을 24시간 간격으로 확인합니다. 등록한 지표누리 인증키는 서버에서만 사용합니다. 기존 등록 PC의 정기 접속과 웹사이트 요청이 서버 확인을 깨우며, 요청이 없으면 다음 접속 때 이어갑니다. 지역별 인구는 같은 기준월·지역·합계를 검증한 뒤 함께 반영합니다. 최초 API 수집의 일시적 응답 오류는 30초 뒤 한 번 재시도하며, 이후 실패하면 마지막 정상 자료를 유지하고 1시간부터 최대 24시간 간격으로 재시도합니다. 원천에서 지정한 대기 시간은 우선 적용합니다. KOSIS·공식 보고서 확인본·통계 목록·기관 링크는 자동 갱신 대상이 아닙니다.";
