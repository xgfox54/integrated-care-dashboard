-- 문서 사실 반입(작업지시서 v5 §10). 로컬 Factory가 만든 welfare-public-release-v2 묶음을 관리자 인증·청크로 받아
-- received → staged → approved → active 상태로만 공개한다. 반입한 자료는 실행하지 않고 데이터 행으로만 저장한다.
CREATE TABLE `import_artifact` (
	`import_id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`archive_sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`total_chunks` integer NOT NULL,
	`received_chunks` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`format` text DEFAULT '' NOT NULL,
	`manifest_json` text DEFAULT '{}' NOT NULL,
	`report_json` text DEFAULT '{}' NOT NULL,
	`scope_json` text DEFAULT '[]' NOT NULL,
	`received_at` integer NOT NULL,
	`staged_at` integer,
	`approved_at` integer,
	`approved_hash` text,
	`approved_epoch` integer,
	`activated_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_artifact_artifact_id` ON `import_artifact` (`artifact_id`);
--> statement-breakpoint
CREATE TABLE `import_chunk` (
	`import_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`sha256` text NOT NULL,
	`data_b64` text NOT NULL,
	PRIMARY KEY(`import_id`, `chunk_index`)
);
--> statement-breakpoint
CREATE TABLE `doc_source` (
	`import_id` text NOT NULL,
	`source_version_id` text NOT NULL,
	`source_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`title` text NOT NULL,
	`issuer` text NOT NULL,
	`issuer_sido` text NOT NULL,
	`issuer_sigungu` text DEFAULT '' NOT NULL,
	`document_number` text DEFAULT '' NOT NULL,
	`url` text,
	`published_date` text,
	`retrieved_at` text NOT NULL,
	`raw_sha256` text NOT NULL,
	`format` text NOT NULL,
	`parse_id` text NOT NULL,
	`parser` text NOT NULL,
	`adapter_version` text NOT NULL,
	`locator_precision` text NOT NULL,
	`page_mode` text NOT NULL,
	`rights_basis` text NOT NULL,
	PRIMARY KEY(`import_id`, `source_version_id`)
);
--> statement-breakpoint
CREATE TABLE `doc_statement` (
	`import_id` text NOT NULL,
	`statement_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`subject_label` text NOT NULL,
	`subject_sido` text NOT NULL,
	`subject_sigungu` text DEFAULT '' NOT NULL,
	`predicate_id` text NOT NULL,
	`value_text` text NOT NULL,
	`unit` text,
	`scope_text` text,
	`source_version_id` text NOT NULL,
	`reviewed_at` text NOT NULL,
	PRIMARY KEY(`import_id`, `statement_id`)
);
--> statement-breakpoint
CREATE INDEX `doc_statement_subject` ON `doc_statement` (`subject_id`);
--> statement-breakpoint
CREATE TABLE `doc_evidence` (
	`import_id` text NOT NULL,
	`evidence_id` text NOT NULL,
	`statement_id` text NOT NULL,
	`source_version_id` text NOT NULL,
	`parse_id` text NOT NULL,
	`block_id` text NOT NULL,
	`ir_pointer` text NOT NULL,
	`table_id` text,
	`cell` text,
	`locator_precision` text NOT NULL,
	`page_mode` text NOT NULL,
	`layout_page_start` integer,
	`physical_page_verified` integer DEFAULT 0 NOT NULL,
	`quote` text NOT NULL,
	PRIMARY KEY(`import_id`, `evidence_id`)
);
--> statement-breakpoint
CREATE TABLE `doc_active` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`policy_epoch` integer DEFAULT 0 NOT NULL,
	`last_import_id` text,
	`updated_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `doc_active` (`id`, `revision`, `policy_epoch`, `updated_at`) VALUES (1, 0, 0, 0);
--> statement-breakpoint
CREATE TABLE `doc_active_source` (
	`source_id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`source_version_id` text NOT NULL,
	`retrieved_at` text NOT NULL,
	`activated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `doc_subject_check` (
	`subject_id` text NOT NULL,
	`knowledge_run_id` text NOT NULL,
	`exists_in_run` integer NOT NULL,
	`checked_at` integer NOT NULL,
	PRIMARY KEY(`subject_id`, `knowledge_run_id`)
);
--> statement-breakpoint
CREATE TABLE `doc_block` (
	`source_id` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`blocked_at` integer NOT NULL
);
