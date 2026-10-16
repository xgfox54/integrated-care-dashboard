-- 2026-10-13: 한 번도 갱신하지 못한 지표누리 4종을 배포 직후 다시 확인한다. 0123에서 추가한 오류 문구 기록과 12초 재시도를 바로 적용하기 위해서다.
UPDATE statistics_refresh_scope SET next_check_at = 0 WHERE scope_id IN ('stat:1450', 'stat:1451', 'stat:2764', 'stat:2770') AND last_success_at IS NULL;
