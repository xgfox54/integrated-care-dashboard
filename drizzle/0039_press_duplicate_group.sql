-- 검증된 동일 보도자료 묶음(작업지시서 v5 §23.10·T162). 본문을 보관하지 않으므로 관리자가 관련 묶음을 보고 같은 자료로 확정한다.
ALTER TABLE `press_item` ADD `duplicate_group_id` text;
--> statement-breakpoint
CREATE INDEX `press_item_duplicate_group_idx` ON `press_item` (`duplicate_group_id`);
--> statement-breakpoint
CREATE TABLE `press_duplicate_group` (
	`group_id` text PRIMARY KEY NOT NULL,
	`related_group_id` text NOT NULL,
	`original_item_id` text,
	`basis` text NOT NULL,
	`verified_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `press_related_review` (
	`related_group_id` text PRIMARY KEY NOT NULL,
	`decision` text NOT NULL,
	`reviewed_at` integer NOT NULL
);
