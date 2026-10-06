-- PC 중계 수집(운영자 승인 2026-10-06). 기관 웹방화벽이 해외 클라우드 서버 요청을 막는 Source는 운영자 PC(국내 IP)가 목록 화면을 받아 올리고,
-- 서버가 같은 파서로 제목·게시일·링크만 뽑아 저장한다. collect_via = 'relay' 인 Source는 서버가 직접 요청하지 않는다.
ALTER TABLE press_source ADD COLUMN collect_via text DEFAULT 'server' NOT NULL;
--> statement-breakpoint
UPDATE press_source SET collect_via = 'relay' WHERE source_id IN ('src:www.jejusi.go.kr:press', 'src:www.seogwipo.go.kr:press');
--> statement-breakpoint
UPDATE press_crawl_state SET next_due_at = 0, collection_hold = '', hold_until = NULL, hold_reason = '', consecutive_failures = 0
WHERE source_id IN ('src:www.jejusi.go.kr:press', 'src:www.seogwipo.go.kr:press');
