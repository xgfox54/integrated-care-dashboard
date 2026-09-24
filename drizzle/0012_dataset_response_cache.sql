CREATE TABLE IF NOT EXISTS `dataset_response_cache` (
  `cache_key` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `edits_version` text NOT NULL,
  `body` text NOT NULL,
  `created_at` integer NOT NULL
);
