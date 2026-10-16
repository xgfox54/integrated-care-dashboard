-- 2026-10-13: 지표누리 API는 오류도 HTTP 200·평문 문구로 돌려준다. 원인을 확인할 수 있게 짧게 정리한 문구(인증키 제외)를 남긴다.
ALTER TABLE statistics_refresh_scope ADD COLUMN error_detail TEXT;
