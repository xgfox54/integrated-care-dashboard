CREATE TABLE `official_document_service_cache` (
	`document_id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
UPDATE `official_sync_run`
SET `completed_at` = 1
WHERE `status` = 'succeeded';
