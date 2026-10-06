-- 보도자료 한 건 공개 철회(작업지시서 v5 T47): 원문 주소 기준 차단 목록. 다시 수집되거나 제목이 바뀌어도 공개로 돌아가지 않는다.
CREATE TABLE `press_item_block` (
	`canonical_url` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`blocked_at` integer NOT NULL
);
