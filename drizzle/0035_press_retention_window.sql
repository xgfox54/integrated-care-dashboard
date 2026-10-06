-- 원천 목록 보유창 측정(작업지시서 v5 T114): 성공한 수집마다 받은 목록의 가장 오래된·최신 게시일과 건수를 남긴다.
ALTER TABLE `press_crawl_state` ADD `window_items` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `press_crawl_state` ADD `window_oldest` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `press_crawl_state` ADD `window_newest` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `press_crawl_state` ADD `window_measured_at` integer DEFAULT 0 NOT NULL;
