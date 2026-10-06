-- 보도자료 수집 지침(2026-10-05 운영자 제공) 반영: 기관별 요청 간격·게시판명·저작권·공공누리, 수집 보류(403·401·5xx 반복·CAPTCHA·기관 요청),
-- 증분 기준점, 감사 로그 항목, robots.txt 점검 기록·변경 이력, 전체 수집 스위치, 도메인·경로 차단 목록.
ALTER TABLE `press_source` ADD `request_interval_sec` integer DEFAULT 3 NOT NULL;
--> statement-breakpoint
ALTER TABLE `press_source` ADD `board_name` text DEFAULT '보도자료' NOT NULL;
--> statement-breakpoint
ALTER TABLE `press_source` ADD `copyright_type` text DEFAULT 'UNVERIFIED' NOT NULL;
--> statement-breakpoint
ALTER TABLE `press_source` ADD `public_nuri_type` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `press_source` ADD `reuse_allowed` integer;
--> statement-breakpoint
ALTER TABLE `press_crawl_state` ADD `collection_hold` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `press_crawl_state` ADD `hold_until` integer;
--> statement-breakpoint
ALTER TABLE `press_crawl_state` ADD `hold_reason` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `press_crawl_state` ADD `last_seen_post_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `press_crawl_state` ADD `last_checked_at` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `press_collection_run` ADD `requested_url` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `press_collection_run` ADD `robots_status` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `press_collection_run` ADD `response_size` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `press_collection_run` ADD `elapsed_ms` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `press_collection_run` ADD `parser_result` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE `press_robots_audit` (
	`domain` text NOT NULL,
	`target_path` text NOT NULL,
	`organization_id` text,
	`source_id` text,
	`robots_url` text NOT NULL,
	`checked_at` integer NOT NULL,
	`http_status` integer DEFAULT 0 NOT NULL,
	`robots_hash` text DEFAULT '' NOT NULL,
	`robots_text` text DEFAULT '' NOT NULL,
	`user_agent` text NOT NULL,
	`robots_rule` text DEFAULT '' NOT NULL,
	`decision` text NOT NULL,
	`decision_reason` text NOT NULL,
	`changed_at` integer,
	PRIMARY KEY (`domain`, `target_path`)
);
--> statement-breakpoint
CREATE INDEX `press_robots_audit_checked_idx` ON `press_robots_audit` (`checked_at`);
--> statement-breakpoint
CREATE TABLE `press_robots_change` (
	`change_id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`target_path` text NOT NULL,
	`changed_at` integer NOT NULL,
	`old_hash` text NOT NULL,
	`new_hash` text NOT NULL,
	`old_decision` text NOT NULL,
	`new_decision` text NOT NULL,
	`diff` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `press_robots_change_time_idx` ON `press_robots_change` (`changed_at`);
--> statement-breakpoint
CREATE TABLE `press_crawl_block` (
	`kind` text NOT NULL,
	`pattern` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`kind`, `pattern`)
);
--> statement-breakpoint
CREATE TABLE `press_crawler_setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
-- 등록 때 확인 근거에 공공누리 유형을 적어 둔 수집처는 그 유형을 구조화한다(공공누리 1~4유형은 모두 출처표시 조건의 이용허락). 나머지는 확인 전으로 둔다.
UPDATE `press_source` SET `public_nuri_type` = 'KOGL_TYPE1', `copyright_type` = 'PUBLIC_WORK_KOGL', `reuse_allowed` = 1 WHERE `verification_note` LIKE '%공공누리 제1유형%';
--> statement-breakpoint
UPDATE `press_source` SET `public_nuri_type` = 'KOGL_TYPE2', `copyright_type` = 'PUBLIC_WORK_KOGL', `reuse_allowed` = 1 WHERE `verification_note` LIKE '%공공누리 제2유형%';
--> statement-breakpoint
UPDATE `press_source` SET `public_nuri_type` = 'KOGL_TYPE3', `copyright_type` = 'PUBLIC_WORK_KOGL', `reuse_allowed` = 1 WHERE `verification_note` LIKE '%공공누리 제3유형%';
--> statement-breakpoint
UPDATE `press_source` SET `public_nuri_type` = 'KOGL_TYPE4', `copyright_type` = 'PUBLIC_WORK_KOGL', `reuse_allowed` = 1 WHERE `verification_note` LIKE '%공공누리 제4유형%';
