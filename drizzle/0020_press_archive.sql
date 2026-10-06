CREATE TABLE `press_organization` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`org_type` text NOT NULL,
	`sido` text DEFAULT '' NOT NULL,
	`sigungu` text DEFAULT '' NOT NULL,
	`parent_id` text,
	`code_system` text DEFAULT '' NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`lifecycle_status` text DEFAULT 'ACTIVE' NOT NULL,
	`seed_origin` text NOT NULL,
	`registry_version` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `press_organization_type_idx` ON `press_organization` (`org_type`);
--> statement-breakpoint
CREATE INDEX `press_organization_region_idx` ON `press_organization` (`sido`, `sigungu`);
--> statement-breakpoint
CREATE TABLE `press_source` (
	`source_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`source_kind` text DEFAULT 'OFFICIAL_PRESS_RELEASE' NOT NULL,
	`method` text NOT NULL,
	`adapter` text NOT NULL,
	`homepage_url` text DEFAULT '' NOT NULL,
	`endpoint_url` text DEFAULT '' NOT NULL,
	`allowed_hosts` text DEFAULT '[]' NOT NULL,
	`interval_minutes` integer DEFAULT 60 NOT NULL,
	`verification_status` text DEFAULT 'REGISTERED' NOT NULL,
	`verification_note` text DEFAULT '' NOT NULL,
	`endpoint_verified_at` integer,
	`approval_status` text DEFAULT 'PENDING_PERMISSION' NOT NULL,
	`policy_version` integer DEFAULT 1 NOT NULL,
	`policy_basis` text DEFAULT '' NOT NULL,
	`approved_at` integer,
	`technical_status` text DEFAULT 'UNCHECKED' NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`registry_version` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `press_source_org_idx` ON `press_source` (`organization_id`);
--> statement-breakpoint
CREATE TABLE `press_item` (
	`item_id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`origin_id` text NOT NULL,
	`canonical_url` text NOT NULL,
	`title` text NOT NULL,
	`title_hash` text NOT NULL,
	`title_version` integer DEFAULT 1 NOT NULL,
	`issued_by_org_id` text NOT NULL,
	`published_date` text DEFAULT '' NOT NULL,
	`published_at` integer,
	`publication_precision` text NOT NULL,
	`timestamp_semantics` text DEFAULT 'rss_pubDate' NOT NULL,
	`discovered_at` integer NOT NULL,
	`collected_at` integer NOT NULL,
	`categories` text DEFAULT '[]' NOT NULL,
	`classification_status` text NOT NULL,
	`classification_basis` text NOT NULL,
	`dictionary_version` text NOT NULL,
	`public_status` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `press_item_source_url_uidx` ON `press_item` (`source_id`, `canonical_url`);
--> statement-breakpoint
CREATE INDEX `press_item_public_date_idx` ON `press_item` (`public_status`, `published_date`);
--> statement-breakpoint
CREATE INDEX `press_item_org_date_idx` ON `press_item` (`issued_by_org_id`, `published_date`);
--> statement-breakpoint
CREATE TABLE `press_crawl_state` (
	`source_id` text PRIMARY KEY NOT NULL,
	`last_attempt_at` integer DEFAULT 0 NOT NULL,
	`last_success_at` integer DEFAULT 0 NOT NULL,
	`latest_item_date` text DEFAULT '' NOT NULL,
	`etag` text DEFAULT '' NOT NULL,
	`last_modified` text DEFAULT '' NOT NULL,
	`last_item_count` integer DEFAULT 0 NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`safe_error` text DEFAULT '' NOT NULL,
	`lease_token` text DEFAULT '' NOT NULL,
	`lease_expires_at` integer DEFAULT 0 NOT NULL,
	`next_due_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `press_collection_run` (
	`run_id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`trigger` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	`status` text NOT NULL,
	`http_status` integer DEFAULT 0 NOT NULL,
	`feed_item_count` integer DEFAULT 0 NOT NULL,
	`new_count` integer DEFAULT 0 NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL,
	`unchanged_count` integer DEFAULT 0 NOT NULL,
	`rejected_count` integer DEFAULT 0 NOT NULL,
	`welfare_count` integer DEFAULT 0 NOT NULL,
	`review_count` integer DEFAULT 0 NOT NULL,
	`non_welfare_count` integer DEFAULT 0 NOT NULL,
	`error_code` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `press_collection_run_source_idx` ON `press_collection_run` (`source_id`, `started_at`);
