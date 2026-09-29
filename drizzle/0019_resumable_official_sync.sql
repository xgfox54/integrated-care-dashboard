ALTER TABLE `official_sync_run` ADD `stage` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `official_sync_run` ADD `progress` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `official_sync_run` ADD `advanced_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE `official_sync_api_page` (
  `run_id` text NOT NULL,
  `term` text NOT NULL,
  `page` integer NOT NULL,
  `payload` text NOT NULL,
  PRIMARY KEY(`run_id`, `term`, `page`)
);--> statement-breakpoint
DELETE FROM `official_service_snapshot` WHERE `sync_run_id` IN (SELECT `id` FROM `official_sync_run` WHERE `status` = 'running');--> statement-breakpoint
DELETE FROM `official_source_document` WHERE `sync_run_id` IN (SELECT `id` FROM `official_sync_run` WHERE `status` = 'running');--> statement-breakpoint
UPDATE `official_sync_run` SET `status` = 'failed', `completed_at` = CAST(strftime('%s', 'now') AS INTEGER), `error` = '수집을 단계별 이어받기 방식으로 바꾸며 정리했습니다.' WHERE `status` = 'running';--> statement-breakpoint
DELETE FROM `official_sync_lock`;
