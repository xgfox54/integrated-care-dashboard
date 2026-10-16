// 2026-10-08: hosted audit repeatedly failed; the existing collector/parser succeeded on the laptop.
// Exact endpoints only. A changed endpoint needs fresh verification; holds and approvals are never overridden.
// Evidence: docs/acceptance/PRESS_RELAY_RECOVERY_2026-10-08.md
export const VERIFIED_RELAY_ROUTES = [
  ["src:busan:press", "https://www.busan.go.kr/nbtnewsBU.rss"],
  ["src:www.gyeyang.go.kr:press", "https://www.gyeyang.go.kr/open_content/main/open_info/admin/report.jsp"],
  ["src:www.donggu.kr:press", "https://www.donggu.kr/board.es?mid=a10102040100&bid=0243"],
  ["src:jeonnam-gwangju:press", "https://www.jeonnam-gwangju.go.kr/boardList.do?boardId=JG_0000000003&pageId=jngj22"],
  ["src:www.hadong.go.kr:press", "https://www.hadong.go.kr/media/00013/03607.web"],
  ["src:www.seogu.go.kr:press", "https://www.seogu.go.kr/bbs/BBSMSTR_000000000277/list.do"],
  ["src:www.hc.go.kr:press", "https://www.hc.go.kr/04923/04924/04953.web"],
  // 2026-10-10: hosted network errors, current parser + isolated SQLite passed on desktop.
  // Third value permits one verified recovery after a real transport failure; previous routes retain five.
  // Evidence: docs/acceptance/press-local-routes-20261010.json
  ["src:gyeongbuk:press", "https://www.gb.go.kr/page/10107/10004.do", 1],
  ["src:gyeonggi:press", "https://gnews.gg.go.kr/briefing/brief_gongbo.do", 1],
  ["src:eminwon.yangyang.go.kr:press", "https://eminwon.yangyang.go.kr/emwp/gov/mogaha/ntis/web/ofr/action/OfrAction.do?jndinm=OfrBcAdvNewsEJB&context=NTIS&method=selectListOfrNews&methodnm=selectListOfrNewsHomepage&news_epct_yn=1&subCheck=Y&ofr_pageSize=10&data_open_yn=1&countYn=Y", 1],
  ["src:jeonbuk:press", "https://www.jeonbuk.go.kr/newsroom/board/list.jeonbuk?boardId=BBS_0000090&menuCd=DOM_000001101000000000", 1],
  ["src:ojeong.bucheon.go.kr:press", "https://ojeong.bucheon.go.kr/site/program/board/basicboard/list?boardtypeid=28012&menuid=169003002", 1],
  ["src:www.boeun.go.kr:press", "https://www.boeun.go.kr/www/selectBbsNttList.do?bbsNo=209&key=138", 1],
  ["src:ulsan:press", "https://www.ulsan.go.kr/u/rep/bbs/list.ulsan?bbsId=BBS_0000000000000027&mId=001004003001000000", 1],
  ["src:nam.daegu.kr:press", "https://nam.daegu.kr/index.do?menu_id=00000854", 1],
  ["src:www.cheongju.go.kr:press", "https://www.cheongju.go.kr/www/selectBbsNttList.do?bbsNo=40&key=23485", 1],
  ["src:www.dangjin.go.kr:press", "https://www.dangjin.go.kr/cop/bbs/BBSMSTR_000000000014/selectBoardList.do", 1],
  ["src:www.bsdonggu.go.kr:press", "https://www.bsdonggu.go.kr/board/list.donggu?boardId=BBS_0000025&menuCd=DOM_000000103001006000&contentsSid=278", 1],
  ["src:www.donggu.ulsan.kr:press", "https://www.donggu.ulsan.kr/cop/bbs/selectBoardList.do?bbsId=BBSMSTR_000000000322", 1],
  ["src:www.gongju.go.kr:press", "https://www.gongju.go.kr/prog/saeolNews/sub04_02_01/list.do", 1],
  ["src:www.goyang.go.kr:press", "https://www.goyang.go.kr/news/user/bbs/BD_selectBbsList.do?q_bbsCode=1090&q_estnColumn1=All", 1],
  ["src:www.korea.kr:A00013", "https://www.korea.kr/briefing/pressReleaseList.do?repCodeType=A&repCode=A00013", 1],
  ["src:www.hongcheon.go.kr:press", "https://www.hongcheon.go.kr/www/selectEminwonNewsList.do?key=283&ofr_pageSize=10", 1],
  ["src:www.pocheon.go.kr:press", "https://www.pocheon.go.kr/www/selectBbsNttList.do?bbsNo=753&key=3729", 1],
  ["src:www.muju.go.kr:press", "https://www.muju.go.kr/planweb/board/list.9is?contentUid=ff8080816c5f9d47016cbd3baf240074&boardUid=ff8080816d3d662f016d4218d1360434", 1],
  ["src:www.miryang.go.kr:press", "https://www.miryang.go.kr/web/bbs/selectBoardList.do?bbsId=BBSMSTR_000000000356&mnNo=20100000000", 1],
  ["src:www.mokpo.go.kr:press", "https://www.mokpo.go.kr/www/mokpo_news/press_release", 1],
  ["src:www.taebaek.go.kr:press", "https://www.taebaek.go.kr/www/selectBbsNttList.do?bbsNo=31&key=359", 1],
  ["src:www.suwon.go.kr:press", "https://www.suwon.go.kr/web/board/BD_board.list.do?bbsCd=1043", 1],
  ["src:www.seohae.go.kr:press", "https://www.seohae.go.kr/open_content/main/community/news/report.jsp", 1],
  ["src:www.yeoncheon.go.kr:press", "https://www.yeoncheon.go.kr/www/selectBbsNttList.do?bbsNo=29&key=3398", 1],
  ["src:www.yp21.go.kr:press", "https://www.yp21.go.kr/www/selectBbsNttList.do?bbsNo=2&key=1112", 1],
  ["src:www.yeosu.go.kr:press", "https://www.yeosu.go.kr/www/govt/news/release/press", 1],
] as const;
