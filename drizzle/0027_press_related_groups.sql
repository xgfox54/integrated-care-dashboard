ALTER TABLE `press_item` ADD `title_key` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `press_item` ADD `related_group_id` text;
--> statement-breakpoint
CREATE INDEX `press_item_title_key_idx` ON `press_item` (`title_key`);
--> statement-breakpoint
CREATE INDEX `press_item_related_group_idx` ON `press_item` (`related_group_id`);
