CREATE TABLE `official_service_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`service_id` text NOT NULL,
	`sync_run_id` text NOT NULL,
	`sido` text NOT NULL,
	`sigungu` text NOT NULL,
	`category` text NOT NULL,
	`subcategory` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`target` text NOT NULL,
	`detail_target` text NOT NULL,
	`provider` text NOT NULL,
	`type` text NOT NULL,
	`serial` text NOT NULL,
	`detail_url` text NOT NULL,
	`updated_date` text NOT NULL,
	`collected_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `official_service_snapshot_run_idx` ON `official_service_snapshot` (`sync_run_id`);--> statement-breakpoint
CREATE INDEX `official_service_snapshot_region_idx` ON `official_service_snapshot` (`sido`,`sigungu`);--> statement-breakpoint
CREATE TABLE `official_source_document` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`sync_run_id` text NOT NULL,
	`province` text NOT NULL,
	`municipality` text NOT NULL,
	`title` text NOT NULL,
	`published_at` text NOT NULL,
	`data_as_of` text NOT NULL,
	`detail_url` text NOT NULL,
	`download_url` text NOT NULL,
	`file_name` text NOT NULL,
	`collected_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `official_source_document_run_idx` ON `official_source_document` (`sync_run_id`);--> statement-breakpoint
CREATE TABLE `official_sync_run` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`service_count` integer DEFAULT 0 NOT NULL,
	`document_count` integer DEFAULT 0 NOT NULL,
	`error` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `official_sync_run_status_started_idx` ON `official_sync_run` (`status`,`started_at`);