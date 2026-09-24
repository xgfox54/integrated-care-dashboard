UPDATE `official_sync_run`
SET `status` = 'failed',
    `completed_at` = CAST(strftime('%s', 'now') AS INTEGER),
    `error` = '배포로 중단된 현행화 실행을 정리했습니다.'
WHERE `status` = 'running';
--> statement-breakpoint
DELETE FROM `official_service_snapshot`
WHERE `sync_run_id` IN (
  SELECT `id` FROM `official_sync_run` WHERE `status` <> 'succeeded'
);
--> statement-breakpoint
DELETE FROM `official_source_document`
WHERE `sync_run_id` IN (
  SELECT `id` FROM `official_sync_run` WHERE `status` <> 'succeeded'
);
--> statement-breakpoint
DELETE FROM `official_sync_lock`;
--> statement-breakpoint
UPDATE `official_sync_run`
SET `completed_at` = 1
WHERE `status` = 'succeeded';
