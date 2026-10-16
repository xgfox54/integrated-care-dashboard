-- 2026-10-13: 서비스에서 뺀 stat:1441(정신장애 유병률)의 자동 확인 기록을 지운다. 정의 없는 기록이 남으면 갱신 순회가 멈춘다.
DELETE FROM statistics_refresh_scope WHERE scope_id = 'stat:1441';
