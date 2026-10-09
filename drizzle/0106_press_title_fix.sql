-- 목록에서 줄인 제목을 원문 화면으로 보완한 시도 기록(2026-10-09 운영자 요청). 제목·본문은 넣지 않는다.
CREATE TABLE IF NOT EXISTS press_title_fix (item_id text PRIMARY KEY NOT NULL, attempts integer DEFAULT 0 NOT NULL, last_at integer DEFAULT 0 NOT NULL, status text DEFAULT '' NOT NULL);
