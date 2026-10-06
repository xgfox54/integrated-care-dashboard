-- 공식 보도자료 본문·첨부 일시 판독 정책과 내부 지문(작업지시서 v5 §23.12, T153·T155). 행이 없으면 모든 판독을 거절한다.
CREATE TABLE `press_ephemeral_policy` (
	`source_id` text PRIMARY KEY NOT NULL,
	`temporary_text_read_allowed` integer DEFAULT 0 NOT NULL,
	`temporary_attachment_parse_allowed` integer DEFAULT 0 NOT NULL,
	`local_classification_allowed` integer DEFAULT 0 NOT NULL,
	`fingerprint_retention_allowed` integer DEFAULT 0 NOT NULL,
	`max_bytes` integer DEFAULT 0 NOT NULL,
	`max_seconds` integer DEFAULT 0 NOT NULL,
	`ttl_seconds` integer DEFAULT 0 NOT NULL,
	`allowed_outputs` text DEFAULT '[]' NOT NULL,
	`purpose` text DEFAULT '' NOT NULL,
	`rights_basis` text DEFAULT '' NOT NULL,
	`approver_ref` text DEFAULT '' NOT NULL,
	`approved_at` integer DEFAULT 0 NOT NULL,
	`policy_version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `press_text_fingerprint` (
	`item_id` text NOT NULL,
	`source_id` text NOT NULL,
	`algorithm` text NOT NULL,
	`fingerprint` text NOT NULL,
	`extraction_scope` text NOT NULL,
	`source_version` text NOT NULL,
	`policy_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`item_id`, `algorithm`)
);
