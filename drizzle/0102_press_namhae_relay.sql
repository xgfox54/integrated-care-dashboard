-- 남해군 보도자료(0100에서 실제 목록 주소로 교체)가 서버 수집에서 응답 대기 시간 초과. 데스크톱 Node·Windows 통신으로는 HTTP 200이라 PC 중계로 옮긴다.
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.namhae.go.kr:press' AND registry_version = 'registry-2026-10-09-unconnected' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0, consecutive_failures = 0, safe_error = '' WHERE source_id = 'src:www.namhae.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
