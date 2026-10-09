-- 0103 후속(2026-10-09 20:40). 증평·완주·여주는 서버(해외 클라우드) 요청이 응답 시간 초과(RESPONSE_TIMEOUT), 데스크톱 PC 수집기 설정(.NET, TLS 1.2, 이동 미추적)으로는 HTTP 200이라 PC 중계로 옮긴다.
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.jp.go.kr:press' AND registry_version = 'registry-2026-10-09-operator-r19' AND collect_via = 'server';
--> statement-breakpoint
UPDATE press_crawl_state SET next_due_at = 0, consecutive_failures = 0, safe_error = '' WHERE source_id = 'src:www.jp.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
--> statement-breakpoint
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.wanju.go.kr:press' AND registry_version = 'registry-2026-10-09-operator-r19' AND collect_via = 'server';
--> statement-breakpoint
UPDATE press_crawl_state SET next_due_at = 0, consecutive_failures = 0, safe_error = '' WHERE source_id = 'src:www.wanju.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
--> statement-breakpoint
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.yeoju.go.kr:press' AND registry_version = 'registry-2026-10-09-operator-r19' AND collect_via = 'server';
--> statement-breakpoint
UPDATE press_crawl_state SET next_due_at = 0, consecutive_failures = 0, safe_error = '' WHERE source_id = 'src:www.yeoju.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
