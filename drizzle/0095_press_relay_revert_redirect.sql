-- 정읍시·경남 고성군: PC 중계 요청(Windows HttpClient)에 같은 주소로 302를 반복해 실패(2026-10-09 15:46·15:47 KST, URL_CHANGED).
-- 같은 수집 코드의 서버 방식 통신은 정상 수집(scripts/press/e2e-representative.mjs 2026-10-09)이라 서버 수집으로 되돌린다. 실패 기록은 그대로 둔다.
UPDATE press_source SET collect_via = 'server' WHERE source_id = 'src:www.jeongeup.go.kr:press' AND endpoint_url = 'https://www.jeongeup.go.kr/board/list.jeongeup?boardId=BBS_0000019&menuCd=DOM_000000101002001000&contentsSid=16&cpath=' AND collect_via = 'relay';
UPDATE press_source SET collect_via = 'server' WHERE source_id = 'src:www.goseong.go.kr:press' AND endpoint_url = 'https://www.goseong.go.kr/board/list.goseong?boardId=BBS_0000196&menuCd=DOM_000000102002008000&contentsSid=365' AND collect_via = 'relay';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id IN ('src:www.jeongeup.go.kr:press', 'src:www.goseong.go.kr:press');
