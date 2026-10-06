-- 통합 공개본 되돌리기 보류(작업지시서 v5 T26·T139). 관리자가 이전 공개본으로 되돌리면 배경 갱신이 덮어쓰지 않도록 사유와 시각을 남긴다.
ALTER TABLE `platform_active_bundle` ADD `hold_reason` text;
--> statement-breakpoint
ALTER TABLE `platform_active_bundle` ADD `held_at` integer;
