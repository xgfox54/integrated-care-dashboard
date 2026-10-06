-- 공개 재정 snapshot의 공식 화면 자동 대조 진행 상태(작업지시서 v5 T84). 배경 작업이 시·도별 화면을 한 쪽씩 조회해 대조하고, 끝나면 fiscal_unit_check에 결과를 남긴다.
CREATE TABLE `fiscal_unit_check_progress` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`keyword` text NOT NULL,
	`reference_date` text NOT NULL,
	`region_index` integer NOT NULL,
	`page` integer NOT NULL,
	`exact_rows` integer NOT NULL,
	`mismatch_rows` integer NOT NULL,
	`only_official` integer NOT NULL,
	`retry_count` integer NOT NULL,
	`status` text NOT NULL,
	`error_code` text NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `fiscal_unit_check_progress` VALUES ('fs:5b2e337f-260a-4950-89a3-2c438be4dbd8', '통합돌봄', '2026-10-02', 16, 1, 579, 0, 0, 0, 'DONE', '', 1791087600, 1791087600);
