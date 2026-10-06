-- 같은 기관 호스트를 동시에 두 수집이 부르지 않게 하는 호스트 실행권(작업지시서 v5 T160).
CREATE TABLE `press_host_lease` (
	`host` text PRIMARY KEY NOT NULL,
	`lease_token` text DEFAULT '' NOT NULL,
	`lease_expires_at` integer DEFAULT 0 NOT NULL
);
