DELETE FROM `official_sync_lock`;
--> statement-breakpoint
UPDATE `official_sync_run`
SET `completed_at` = `started_at` - (
  SELECT COALESCE(MAX(`started_at`), 0) + 86400 FROM `official_sync_run`
)
WHERE `status` = 'succeeded';
