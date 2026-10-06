CREATE TABLE IF NOT EXISTS `fiscal_response_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `fiscal_response_cache_created_idx` ON `fiscal_response_cache` (`created_at`);
