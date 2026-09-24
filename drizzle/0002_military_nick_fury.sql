CREATE TABLE `official_sync_lock` (
	`id` integer PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
