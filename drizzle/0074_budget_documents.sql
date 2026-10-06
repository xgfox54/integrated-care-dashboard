-- 예산서(편성 단계 문서) 반입(작업지시서 v5 §22.7·22.9, T90·T91·T104). 로컬에서 kordoc으로 파싱·검산한 예산서 계층 행을
-- welfare-budget-document-v1 묶음으로 받아 문서 사실 반입과 같은 received → staged → approved → active 절차로만 공개한다.
-- 지방재정365 API 관측(fiscal_observation)과 섞지 않는다: 문서 금액은 그 문서의 편성 단계 값이고 API 예산현액을 덮어쓰지 않는다.
CREATE TABLE `budget_document` (
	`import_id` text NOT NULL,
	`document_id` text NOT NULL,
	`source_version_id` text NOT NULL,
	`title` text NOT NULL,
	`issuer` text NOT NULL,
	`issuer_sido` text NOT NULL,
	`issuer_sigungu` text NOT NULL,
	`fiscal_entity_id` text,
	`fiscal_year` text NOT NULL,
	`page_url` text,
	`file_url` text,
	`retrieved_at` text NOT NULL,
	`raw_sha256` text NOT NULL,
	`format` text NOT NULL,
	`parse_id` text NOT NULL,
	`parser` text NOT NULL,
	`extractor_version` text NOT NULL,
	`rights_basis` text NOT NULL,
	PRIMARY KEY (`import_id`, `document_id`)
);
--> statement-breakpoint
CREATE TABLE `budget_revision` (
	`import_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`document_id` text NOT NULL,
	`stage` text NOT NULL,
	`supplementary_round` integer,
	`stage_basis` text NOT NULL,
	`unit` text NOT NULL,
	`account_code` text NOT NULL,
	`account_name` text NOT NULL,
	`scope_text` text NOT NULL,
	`amount_columns` text NOT NULL,
	`line_count` integer NOT NULL,
	`checks_json` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY (`import_id`, `revision_id`)
);
--> statement-breakpoint
CREATE TABLE `budget_line` (
	`import_id` text NOT NULL,
	`line_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`parent_line_no` integer,
	`level` text NOT NULL,
	`code` text,
	`name` text NOT NULL,
	`bugi_name` text,
	`formula_text` text,
	`amount_thousand_krw` text,
	`amount_krw` text,
	`previous_amount_thousand_krw` text,
	`change_amount_thousand_krw` text,
	`amount_basis` text,
	`funding_complete` integer,
	`page` integer,
	`table_id` text,
	`block_id` text,
	`row_index` integer,
	`checks_json` text DEFAULT '{}' NOT NULL,
	`annotations_json` text DEFAULT '[]' NOT NULL,
	PRIMARY KEY (`import_id`, `line_id`)
);
--> statement-breakpoint
CREATE INDEX `budget_line_revision_level` ON `budget_line` (`revision_id`, `level`, `import_id`);
--> statement-breakpoint
CREATE INDEX `budget_line_parent` ON `budget_line` (`import_id`, `revision_id`, `parent_line_no`);
--> statement-breakpoint
CREATE TABLE `budget_funding_component` (
	`import_id` text NOT NULL,
	`line_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`source` text NOT NULL,
	`label` text NOT NULL,
	`amount_thousand_krw` text NOT NULL,
	PRIMARY KEY (`import_id`, `line_id`, `ordinal`)
);
--> statement-breakpoint
CREATE TABLE `budget_active_revision` (
	`revision_id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`document_id` text NOT NULL,
	`fiscal_entity_id` text,
	`fiscal_year` text NOT NULL,
	`stage` text NOT NULL,
	`supplementary_round` integer,
	`retrieved_at` text NOT NULL,
	`activated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `budget_active_revision_entity` ON `budget_active_revision` (`fiscal_entity_id`, `fiscal_year`);
