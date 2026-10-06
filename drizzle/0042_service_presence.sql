-- 사업 수록 원장(작업지시서 v5 §7·T09). 새 수집에서 빠진 사업은 폐지·종료로 단정하지 않고 MISSING_FROM_LATEST_SOURCE로 남긴다.
-- 키는 원자료 그대로(service_id|sido|sigungu|name). 시행·종료일은 원천에 없어 기록하지 않는다(unknown).
CREATE TABLE `service_presence` (
	`presence_key` text PRIMARY KEY NOT NULL,
	`service_id` text NOT NULL,
	`sido` text NOT NULL,
	`sigungu` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`first_seen_run` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_run` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	`revised_run` text,
	`revised_at` integer,
	`missing_since` integer
);
--> statement-breakpoint
CREATE INDEX `service_presence_service_idx` ON `service_presence` (`service_id`);
--> statement-breakpoint
CREATE INDEX `service_presence_status_idx` ON `service_presence` (`status`);
--> statement-breakpoint
CREATE TABLE `service_presence_run` (
	`run_id` text PRIMARY KEY NOT NULL,
	`previous_run_id` text,
	`recorded_at` integer NOT NULL,
	`listed` integer NOT NULL,
	`new_count` integer NOT NULL,
	`revised_count` integer NOT NULL,
	`missing_count` integer NOT NULL
);
