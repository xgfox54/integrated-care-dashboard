-- 공공데이터포털 활용신청 완료(2026-10-05 운영자) 뒤 바로 다시 시도하도록, 인증 실패로 하루 뒤 예약된 연계 범위를 지금 시도 대상으로 돌린다.
-- 보류 중인 돌봄자원 연계(nhis.*, kosis.stats)는 배경 수집이 건너뛰므로 같이 돌려도 호출되지 않는다.
UPDATE ext_scope_state SET next_due_at = 0 WHERE last_status IN ('AUTH_FAILED', 'AUTH_MISSING');
