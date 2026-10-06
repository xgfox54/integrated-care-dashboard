-- 원본 행 원장(작업지시서 v5 T02·T49): 수집 run·문서별로 추출 행이 반영·미해결·이유 있는 제외로 어떻게 나뉘었는지 남긴다.
CREATE TABLE `official_source_row_ledger` (
	`run_id` text NOT NULL,
	`document_id` text NOT NULL,
	`extracted` integer NOT NULL,
	`mapped` integer NOT NULL,
	`preserved_unresolved` integer NOT NULL,
	`excluded_unparseable` integer NOT NULL,
	`excluded_fragment` integer NOT NULL,
	`traced` integer NOT NULL,
	PRIMARY KEY(`run_id`, `document_id`)
);
