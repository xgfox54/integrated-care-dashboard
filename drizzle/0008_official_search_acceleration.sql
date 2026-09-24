ALTER TABLE `official_service_snapshot` ADD `search_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `official_service_snapshot` SET `search_text` = LOWER(REPLACE(REPLACE(REPLACE(COALESCE(sido, '') || COALESCE(sigungu, '') || COALESCE(category, '') || COALESCE(subcategory, '') || COALESCE(name, '') || COALESCE(description, '') || COALESCE(target, '') || COALESCE(detail_target, '') || COALESCE(application_method, '') || COALESCE(provider, '') || COALESCE(type, ''), ' ', ''), char(10), ''), char(9), ''));--> statement-breakpoint
CREATE INDEX `official_service_snapshot_run_order_idx` ON `official_service_snapshot` (`sync_run_id`,`sido`,`sigungu`,`name`);--> statement-breakpoint
CREATE INDEX `official_service_snapshot_run_category_idx` ON `official_service_snapshot` (`sync_run_id`,`category`);--> statement-breakpoint
CREATE INDEX `official_service_snapshot_run_type_idx` ON `official_service_snapshot` (`sync_run_id`,`type`);--> statement-breakpoint
CREATE INDEX `official_service_snapshot_canonical_region_idx` ON `official_service_snapshot` (`sync_run_id`,(CASE WHEN sido IN ('광주광역시', '전라남도') THEN '전남광주통합특별시' ELSE sido END),`sigungu`);--> statement-breakpoint
CREATE INDEX `official_service_snapshot_normalized_service_idx` ON `official_service_snapshot` (`sync_run_id`,(LOWER(REPLACE(REPLACE(service_id, ':', ''), '-', ''))));
