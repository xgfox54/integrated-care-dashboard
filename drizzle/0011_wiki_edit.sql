CREATE TABLE `wiki_edit` (
  `service_id` text PRIMARY KEY NOT NULL,
  `sido` text NOT NULL,
  `sigungu` text NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `target` text,
  `detail_target` text,
  `provider` text,
  `application_method` text,
  `content` text,
  `source_title` text,
  `source_url` text,
  `note` text DEFAULT '' NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wiki_edit_updated_idx` ON `wiki_edit` (`updated_at`);
