-- robots.txt 허용 Source 자동 승인 기록(2026-10-04 운영자 지시: robots.txt가 접근을 허용하는 사이트는 관리자 승인 없이 수집).
-- 배경 작업이 endpoint 확인 Source의 robots.txt를 읽어 판정을 남기고, 허용(ALLOWED·NO_ROBOTS)이면 승인한다. 관리자가 해제(REVOKED)한 Source는 다시 자동 승인하지 않는다.
CREATE TABLE `press_auto_approval` (
	`source_id` text PRIMARY KEY NOT NULL,
	`checked_at` integer NOT NULL,
	`verdict` text NOT NULL,
	`approved_at` integer
);

