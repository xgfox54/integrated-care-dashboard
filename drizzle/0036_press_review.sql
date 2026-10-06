-- 보도자료 분류 2단계(작업지시서 v5 T167): 검토자가 보류(NEEDS_REVIEW) 항목을 복지·비복지로 확정한다. 1단계 규칙 결과는 따로 보존한다.
ALTER TABLE `press_item` ADD `rule_classification_status` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `press_item` ADD `rule_categories` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `press_item` ADD `reviewed_at` integer;
