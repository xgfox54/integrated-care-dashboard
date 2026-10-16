ALTER TABLE official_source_review ADD COLUMN baseline_content_sha256 TEXT;
--> statement-breakpoint
ALTER TABLE official_source_review ADD COLUMN observed_content_sha256 TEXT;
--> statement-breakpoint
ALTER TABLE official_source_review ADD COLUMN comparison_algorithm TEXT;
