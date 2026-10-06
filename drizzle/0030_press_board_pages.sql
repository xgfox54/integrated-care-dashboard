-- 제한 backfill용 다음 쪽 주소 틀. 2026-10-04 각 게시판 2쪽을 실제로 받아 1쪽과 겹치지 않는(고정 공지 제외) 더 오래된 글임을 확인했다.
UPDATE `press_source` SET `adapter_profile` = json_set(`adapter_profile`, '$.page', 'https://www.chungnam.go.kr/cnportal/cnapcPressList/cnapcPress/list.do?menuNo=500498&pageIndex={page}') WHERE `source_id` = 'src:chungnam:press' AND `adapter` = 'HTMLBoardAdapter';
--> statement-breakpoint
UPDATE `press_source` SET `adapter_profile` = json_set(`adapter_profile`, '$.page', 'https://www.daejeon.go.kr/drh/board/boardNormalList.do?boardId=normal_0189&menuSeq=1632&pageIndex={page}') WHERE `source_id` = 'src:daejeon:press' AND `adapter` = 'HTMLBoardAdapter';
--> statement-breakpoint
UPDATE `press_source` SET `adapter_profile` = json_set(`adapter_profile`, '$.page', 'https://state.gwd.go.kr/portal/briefing/pressRelease?pageIndex={page}') WHERE `source_id` = 'src:gangwon:press' AND `adapter` = 'HTMLBoardAdapter';
--> statement-breakpoint
UPDATE `press_source` SET `adapter_profile` = json_set(`adapter_profile`, '$.page', 'https://gnews.gg.go.kr/briefing/brief_gongbo.do?BS_CODE=s017&page={page}') WHERE `source_id` = 'src:gyeonggi:press' AND `adapter` = 'HTMLBoardAdapter';
--> statement-breakpoint
UPDATE `press_source` SET `adapter_profile` = json_set(`adapter_profile`, '$.page', 'https://www.incheon.go.kr/IC010205?curPage={page}') WHERE `source_id` = 'src:incheon:press' AND `adapter` = 'HTMLBoardAdapter';
--> statement-breakpoint
UPDATE `press_source` SET `adapter_profile` = json_set(`adapter_profile`, '$.page', 'https://www.jeonbuk.go.kr/newsroom/board/list.jeonbuk?boardId=BBS_0000090&listRow=10&listCel=1&menuCd=DOM_000001101000000000&orderBy=REGISTER_DATE:DESC&paging=ok&startPage={page}') WHERE `source_id` = 'src:jeonbuk:press' AND `adapter` = 'HTMLBoardAdapter';
--> statement-breakpoint
UPDATE `press_source` SET `adapter_profile` = json_set(`adapter_profile`, '$.page', 'https://www.seoul.go.kr/news/news_report.do?curPage={page}&bbsNo=158') WHERE `source_id` = 'src:seoul:press' AND `adapter` = 'HTMLBoardAdapter';
--> statement-breakpoint
UPDATE `press_source` SET `adapter_profile` = json_set(`adapter_profile`, '$.page', 'https://www.ulsan.go.kr/u/rep/bbs/list.ulsan?bbsId=BBS_0000000000000027&mId=001004003001000000&page={page}') WHERE `source_id` = 'src:ulsan:press' AND `adapter` = 'HTMLBoardAdapter';
