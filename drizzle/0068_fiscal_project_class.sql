CREATE TABLE IF NOT EXISTS `fiscal_project_class` (
	`fiscal_project_id` text NOT NULL,
	`class` text NOT NULL,
	`basis` text NOT NULL,
	`service_id` text,
	`service_name` text,
	`signature` text NOT NULL,
	`classified_at` integer NOT NULL,
	PRIMARY KEY(`fiscal_project_id`, `class`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `fiscal_project_class_class_idx` ON `fiscal_project_class` (`class`, `fiscal_project_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `fiscal_class_run` (
	`id` integer PRIMARY KEY NOT NULL,
	`signature` text NOT NULL,
	`fiscal_year` text NOT NULL,
	`entity_index` integer NOT NULL,
	`entity_total` integer NOT NULL,
	`matched_wiki` integer DEFAULT 0 NOT NULL,
	`matched_keyword` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`last_finished_at` integer
);
