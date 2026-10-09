-- 보도자료 서버 수집 간헐 실패 게시판을 PC 중계 수집으로 옮김(2026-10-09, 운영자 지시: 수집 대상 기관을 빠짐없이 수집).
-- 근거: 2026-10-09 공개 수집 현황에서 오류(ERROR) 48·차단(BLOCKED) 5. 같은 수집 코드(scripts/press/e2e-representative.mjs)를 운영자 데스크톱에서 실행하니 49곳 성공,
--   3곳(인제·곡성·의정부)은 기관 인증서 체인 누락으로 Node 통신만 실패하고 PC 중계가 쓰는 Windows HttpClient로는 HTTP 200. 정책브리핑(korea.kr) 1곳은 호스트 대기로 미실행.
-- 수집처 ID와 정확한 목록 주소가 모두 같고 지금 서버 수집일 때만 바꾼다. 승인·보류·파서·실패 기록은 그대로 둔다. 다음 PC 차례에 바로 받도록 예정 시각만 앞당긴다.
-- src:chungnam:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:chungnam:press' AND endpoint_url = 'https://www.chungnam.go.kr/cnportal/cnapcPressList/cnapcPress/list.do?menuNo=500498' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:chungnam:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:gyeryong.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:gyeryong.go.kr:press' AND endpoint_url = 'https://gyeryong.go.kr/kr/html/sub03/030105.html' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:gyeryong.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:m.inje.go.kr:press (PC 실측: failed:NETWORK_ERROR)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:m.inje.go.kr:press' AND endpoint_url = 'https://m.inje.go.kr/portal/inje-news/inje-pr/briefing' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:m.inje.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:sosa.bucheon.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:sosa.bucheon.go.kr:press' AND endpoint_url = 'https://sosa.bucheon.go.kr/site/program/board/basicboard/list?boardtypeid=28356&menuid=171003002' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:sosa.bucheon.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.ansan.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.ansan.go.kr:press' AND endpoint_url = 'https://www.ansan.go.kr/www/common/bbs/selectPageListBbs.do?bbs_code=B0238' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.ansan.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.anseong.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.anseong.go.kr:press' AND endpoint_url = 'https://www.anseong.go.kr/portal/saeol/newsList.do?mId=0502010100' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.anseong.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.anyang.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.anyang.go.kr:press' AND endpoint_url = 'https://www.anyang.go.kr/main/selectPressReleaseList.do?key=4107&bbsNo=1687' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.anyang.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.brcn.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.brcn.go.kr:press' AND endpoint_url = 'https://www.brcn.go.kr/prog/eminwon/kor/AA/sub04_02/list.do' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.brcn.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.bsseogu.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.bsseogu.go.kr:press' AND endpoint_url = 'https://www.bsseogu.go.kr/board/list.bsseogu?boardId=BBS_0000011&menuCd=DOM_000000103001015000&contentsSid=880' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.bsseogu.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.bucheon.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.bucheon.go.kr:press' AND endpoint_url = 'https://www.bucheon.go.kr/site/program/board/basicboard/list?boardtypeid=26748&menuid=148002002001' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.bucheon.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.busanjin.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.busanjin.go.kr:press' AND endpoint_url = 'https://www.busanjin.go.kr/board/list.busanjin?boardId=BBS_0000031&menuCd=DOM_000000110003000000&contentsSid=319' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.busanjin.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.buyeo.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.buyeo.go.kr:press' AND endpoint_url = 'https://www.buyeo.go.kr/_prog/_board/?code=news_07&site_dvs_cd=kr&menu_dvs_cd=0408' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.buyeo.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.cheongyang.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.cheongyang.go.kr:press' AND endpoint_url = 'https://www.cheongyang.go.kr/cop/bbs/BBSMSTR_000000000064/selectBoardList.do' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.cheongyang.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.chuncheon.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.chuncheon.go.kr:press' AND endpoint_url = 'https://www.chuncheon.go.kr/mayor/newsroom/press-release/' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.chuncheon.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.dalseong.daegu.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.dalseong.daegu.kr:press' AND endpoint_url = 'https://www.dalseong.daegu.kr/index.do?menu_id=00000195' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.dalseong.daegu.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.dong.daegu.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.dong.daegu.kr:press' AND endpoint_url = 'https://www.dong.daegu.kr/portal/saeol/news/list.do?mid=0201070000' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.dong.daegu.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.eumseong.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.eumseong.go.kr:press' AND endpoint_url = 'https://www.eumseong.go.kr/www/selectBbsNttList.do?bbsNo=27&key=353' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.eumseong.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.geochang.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.geochang.go.kr:press' AND endpoint_url = 'https://www.geochang.go.kr/00445/00452.web' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.geochang.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.gjcity.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.gjcity.go.kr:press' AND endpoint_url = 'https://www.gjcity.go.kr/portal/bbs/list.do?ptIdx=22&mId=0203010000' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.gjcity.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.gn.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.gn.go.kr:press' AND endpoint_url = 'https://www.gn.go.kr/www/selectBbsNttList.do?bbsNo=23&key=277' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.gn.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.gokseong.go.kr:press (PC 실측: failed:NETWORK_ERROR)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.gokseong.go.kr:press' AND endpoint_url = 'https://www.gokseong.go.kr/kr/board/list.do?bbsId=BBS_000000000000151&menuNo=102001002000' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.gokseong.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.goseong.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.goseong.go.kr:press' AND endpoint_url = 'https://www.goseong.go.kr/board/list.goseong?boardId=BBS_0000196&menuCd=DOM_000000102002008000&contentsSid=365' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.goseong.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.guri.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.guri.go.kr:press' AND endpoint_url = 'https://www.guri.go.kr/www/selectBbsNttList.do?bbsNo=42&key=393' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.guri.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.gwangsan.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.gwangsan.go.kr:press' AND endpoint_url = 'https://www.gwangsan.go.kr/boardList.do?boardId=REPORT_NEW&pageId=www16' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.gwangsan.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.hongseong.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.hongseong.go.kr:press' AND endpoint_url = 'https://www.hongseong.go.kr/bbs/BBSMSTR_000000000842/list.do' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.hongseong.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.hsg.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.hsg.go.kr:press' AND endpoint_url = 'https://www.hsg.go.kr/www/selectBbsNttList.do?bbsNo=67&key=827&' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.hsg.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.hygn.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.hygn.go.kr:press' AND endpoint_url = 'https://www.hygn.go.kr/01997/02007.web' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.hygn.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.iksan.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.iksan.go.kr:press' AND endpoint_url = 'https://www.iksan.go.kr/board/post/list.do?boardUid=ff80808199dd1d7d0199e1532f0c0a24&menuUid=ff80808198eafcbd019902ab80c32c06' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.iksan.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.jangseong.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.jangseong.go.kr:press' AND endpoint_url = 'https://www.jangseong.go.kr/home/www/news/jangseong/bodo' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.jangseong.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.jemulpo.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.jemulpo.go.kr:press' AND endpoint_url = 'https://www.jemulpo.go.kr/main/information/news/press.jsp' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.jemulpo.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.jeongeup.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.jeongeup.go.kr:press' AND endpoint_url = 'https://www.jeongeup.go.kr/board/list.jeongeup?boardId=BBS_0000019&menuCd=DOM_000000101002001000&contentsSid=16&cpath=' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.jeongeup.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.jeonju.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.jeonju.go.kr:press' AND endpoint_url = 'https://www.jeonju.go.kr/planweb/board/list.9is?contentUid=ff8080818990c349018b041a87fe3960&boardUid=ff8080818b5bc5cf018ba8ca7216641f&contentUid=ff8080818990c349018b041a87fe3960&subPath=' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.jeonju.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.jinan.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.jinan.go.kr:press' AND endpoint_url = 'https://www.jinan.go.kr/board/list.jinan?boardId=BBS_0000034&menuCd=DOM_000000107002002000&contentsSid=187&cpath=' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.jinan.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.jincheon.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.jincheon.go.kr:press' AND endpoint_url = 'https://www.jincheon.go.kr/home/sub.do?menukey=247' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.jincheon.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.jinju.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.jinju.go.kr:press' AND endpoint_url = 'https://www.jinju.go.kr/00130/02730/00138.web' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.jinju.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.junggu.seoul.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.junggu.seoul.kr:press' AND endpoint_url = 'https://www.junggu.seoul.kr/content.do?cmsid=14390' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.junggu.seoul.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.korea.kr:A00037 (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.korea.kr:A00037' AND endpoint_url = 'https://www.korea.kr/briefing/pressReleaseList.do?repCodeType=A&repCode=A00037' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.korea.kr:A00037' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.korea.kr:B00023 (PC 실측: skipped_host_busy)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.korea.kr:B00023' AND endpoint_url = 'https://www.korea.kr/briefing/pressReleaseList.do?repCodeType=B&repCode=B00023' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.korea.kr:B00023' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.ongjin.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.ongjin.go.kr:press' AND endpoint_url = 'https://www.ongjin.go.kr/open_content/main/community/board/report.jsp' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.ongjin.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.pohang.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.pohang.go.kr:press' AND endpoint_url = 'https://www.pohang.go.kr/news/board/post/list.do?bcIdx=644&mid=0102000000' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.pohang.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.sasang.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.sasang.go.kr:press' AND endpoint_url = 'https://www.sasang.go.kr/board/list.sasang?boardId=BBS_0000002&menuCd=DOM_000000104008002000&contentsSid=2733&cpath=' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.sasang.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.sunchang.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.sunchang.go.kr:press' AND endpoint_url = 'https://www.sunchang.go.kr/board/post/list.do?boardUid=ff8080819a2f0e3b019a71a46284217a&menuUid=ff8080819a2f0e3b019a5d1bb7da1652' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.sunchang.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.suncheon.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.suncheon.go.kr:press' AND endpoint_url = 'https://www.suncheon.go.kr/kr/news/0006/0001/' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.suncheon.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.suseong.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.suseong.kr:press' AND endpoint_url = 'https://www.suseong.kr/index.do?menu_id=00000070' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.suseong.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.taean.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.taean.go.kr:press' AND endpoint_url = 'https://www.taean.go.kr/cop/bbs/BBSMSTR_000000000040/selectBoardList.do' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.taean.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.ui4u.go.kr:press (PC 실측: failed:NETWORK_ERROR)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.ui4u.go.kr:press' AND endpoint_url = 'https://www.ui4u.go.kr/portal/bbs/list.do?ptIdx=1709&mId=0301020000' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.ui4u.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.uiryeong.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.uiryeong.go.kr:press' AND endpoint_url = 'https://www.uiryeong.go.kr/board/list.uiryeong;jsessionid=F6020D34F43D8680487EF1074F6553E6.urskoinfojvm?boardId=BBS_0000080&menuCd=DOM_000000203005001000&contentsSid=189' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.uiryeong.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.yanggu.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.yanggu.go.kr:press' AND endpoint_url = 'https://www.yanggu.go.kr/user_sub?gfnc=www&mu_idx=232' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.yanggu.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.yeongjong.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.yeongjong.go.kr:press' AND endpoint_url = 'https://www.yeongjong.go.kr/main/pst/list.do?pst_id=mn_news_yj' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.yeongjong.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.yeongju.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.yeongju.go.kr:press' AND endpoint_url = 'https://www.yeongju.go.kr/open_content/main/page.do?mnu_uid=1524&' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.yeongju.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.yeonje.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.yeonje.go.kr:press' AND endpoint_url = 'https://www.yeonje.go.kr/portal/bbs/list.do?ptIdx=12&mId=0206050000' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.yeonje.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.yesan.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.yesan.go.kr:press' AND endpoint_url = 'https://www.yesan.go.kr/bbs/BBSMSTR_000000000047/list.do' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.yesan.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
-- src:www.yw.go.kr:press (PC 실측: succeeded)
UPDATE press_source SET collect_via = 'relay' WHERE source_id = 'src:www.yw.go.kr:press' AND endpoint_url = 'https://www.yw.go.kr/www/selectBbsNttList.do?bbsNo=19&key=21' AND collect_via = 'server';
UPDATE press_crawl_state SET next_due_at = 0 WHERE source_id = 'src:www.yw.go.kr:press' AND EXISTS (SELECT 1 FROM press_source s WHERE s.source_id = press_crawl_state.source_id AND s.collect_via = 'relay');
