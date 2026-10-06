-- 선택 인덱스(검색 응답 미리 계산 등) 상태(작업지시서 v5 T33). 실패해도 공개본 생성·승격과 원본 조회는 계속하고, 실패를 숨기지 않고 상태로 밝힌다.
CREATE TABLE `optional_index_status` (
	`index_name` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`run_id` text,
	`last_success_at` integer,
	`last_failure_at` integer,
	`failure_code` text,
	`updated_at` integer NOT NULL
);
