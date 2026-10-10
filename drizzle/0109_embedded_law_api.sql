-- 법령 조회를 외부/로컬 MCP 연동이 아니라 대시보드 Worker 내 korean-law-mcp 4.15.6 실행 구조로 전환한다.
UPDATE ext_dataset
SET dataset_name = '국가법령정보 공동활용 OPEN API(korean-law-mcp 4.15.6 내장형)',
    endpoint = 'https://www.law.go.kr/DRF',
    access = 'LAW_OC',
    rate_limit = '법제처 발급 조건 및 대시보드 공개 API 속도 제한 적용',
    update_cycle = '웹·MCP 요청 시 공식 원문 API 직접 조회. 사업별 확정 근거는 검토 묶음으로 별도 보관',
    refresh_days = 0,
    raw_retention = '직접 조회 원문은 저장하지 않음. 검토된 사업 연결에는 식별자·시행일·해시만 보관',
    adapter_version = 'korean-law-mcp-4.15.6-embedded'
WHERE dataset_key = 'moleg.law';
