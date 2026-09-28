CREATE TABLE `api_rate_limit` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`request_count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `api_rate_limit_expires_at_idx` ON `api_rate_limit` (`expires_at`);
