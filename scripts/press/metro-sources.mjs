// 시·도 보도자료 수집처 확인 기록(2026-10-03). 마이그레이션은 build-metro-sources.mjs가 이 파일로 만든다.
// verification: ENDPOINT_VERIFIED(목록·원문 주소·robots 확인) / ROBOTS_UNREADABLE / BLOCKED_ROBOTS / NEEDS_REVIEW
// robots 판정은 lib/press/robots.ts로 했다. 원문 주소 틀은 실제 게시물 하나를 열어 제목이 보이는지 확인했다.

export const CHECKED_AT = Math.floor(Date.UTC(2026, 9, 3, 14, 30) / 1000);
// 2026-10-04 재확인: 부산·울산·대전을 ENDPOINT_VERIFIED로 바꿨다(0024 마이그레이션).
export const RECHECKED_AT = Math.floor(Date.UTC(2026, 9, 4, 1, 0) / 1000);

export const METRO_SOURCES = [
  {
    org: "서울특별시", key: "seoul", adapter: "HTMLBoardAdapter", method: "HTML", verification: "ENDPOINT_VERIFIED",
    homepage: "https://www.seoul.go.kr", endpoint: "https://www.seoul.go.kr/news/news_report.do", hosts: ["www.seoul.go.kr"],
    profile: { link: "fnTbbsView\\('(?<id>\\d+)'\\)", url: "https://www.seoul.go.kr/news/news_report.do?bbsNo=158&nttNo={id}", title: "text" },
    note: "보도자료 목록(news_report.do, bbsNo=158). robots.txt가 /news 를 Allow. 원문 주소(nttNo) 열람 확인. 공식 RSS 서버(rss.seoul.go.kr)는 응답하지 않음.",
  },
  {
    org: "인천광역시", key: "incheon", adapter: "HTMLBoardAdapter", method: "HTML", verification: "ENDPOINT_VERIFIED",
    homepage: "https://www.incheon.go.kr", endpoint: "https://www.incheon.go.kr/IC010205", hosts: ["www.incheon.go.kr"],
    profile: { link: "/IC010205/view\\?repSeq=(?<id>DOM_\\d+)", url: "https://www.incheon.go.kr/IC010205/view?repSeq={id}", title: "<strong class=\"subject\">([\\s\\S]*?)</strong>", date: "<dt>제공일자</dt>\\s*<dd>([\\d-]+)</dd>" },
    note: "인천소식 > 보도/해명 > 보도자료. robots.txt 없음(404). 목록 링크 안 요약(.txt)은 읽지 않고 제목(strong.subject)만 읽음. 원문 주소 열람 확인.",
  },
  {
    org: "경기도", key: "gyeonggi", adapter: "HTMLBoardAdapter", method: "HTML", verification: "ENDPOINT_VERIFIED",
    homepage: "https://www.gg.go.kr", endpoint: "https://gnews.gg.go.kr/briefing/brief_gongbo.do", hosts: ["gnews.gg.go.kr"],
    profile: { link: "brief_gongbo_view\\.do[^\"]*[?&]number=(?<id>\\d+)", url: "https://gnews.gg.go.kr/briefing/brief_gongbo_view.do?BS_CODE=s017&number={id}", title: "text" },
    note: "경기도 홈페이지 보도자료 메뉴가 연결하는 경기도뉴스포털 보도자료 목록. robots.txt가 Allow. 공식 보도자료 RSS는 인증키가 필요해 쓰지 않음. 원문 주소 열람 확인.",
  },
  {
    org: "강원특별자치도", key: "gangwon", adapter: "HTMLBoardAdapter", method: "HTML", verification: "ENDPOINT_VERIFIED",
    homepage: "https://state.gwd.go.kr", endpoint: "https://state.gwd.go.kr/portal/briefing/pressRelease", hosts: ["state.gwd.go.kr"],
    profile: { link: "href=\"/portal/briefing/pressRelease\\?seq=(?<id>\\d+)\"", url: "https://state.gwd.go.kr/portal/briefing/pressRelease?seq={id}", title: "text" },
    note: "보도자료 목록(portal/briefing/pressRelease). robots.txt가 Allow. 원문 주소(seq) 열람 확인.",
  },
  {
    org: "충청남도", key: "chungnam", adapter: "HTMLBoardAdapter", method: "HTML", verification: "ENDPOINT_VERIFIED",
    homepage: "https://www.chungnam.go.kr", endpoint: "https://www.chungnam.go.kr/cnportal/cnapcPressList/cnapcPress/list.do?menuNo=500498", hosts: ["www.chungnam.go.kr"],
    profile: { link: "cnapcPress/view\\.do\\?nttId=(?<id>\\d+)", url: "https://www.chungnam.go.kr/cnportal/cnapcPressList/cnapcPress/view.do?nttId={id}&menuNo=500498", title: "attr:title" },
    note: "보도자료 목록(menuNo=500498). robots.txt가 Allow. 원문 주소(nttId) 열람 확인.",
  },
  {
    org: "전북특별자치도", key: "jeonbuk", adapter: "HTMLBoardAdapter", method: "HTML", verification: "ENDPOINT_VERIFIED",
    homepage: "https://www.jeonbuk.go.kr", endpoint: "https://www.jeonbuk.go.kr/newsroom/board/list.jeonbuk?boardId=BBS_0000090&menuCd=DOM_000001101000000000", hosts: ["www.jeonbuk.go.kr"],
    profile: { link: "boardId=BBS_0000090[^\"]*dataSid=(?<id>\\d+)", url: "https://www.jeonbuk.go.kr/board/view.jeonbuk?boardId=BBS_0000090&menuCd=DOM_000001101000000000&dataSid={id}", title: "<strong>([\\s\\S]*?)</strong>", date: "작성일\\s*:\\s*([\\d-]+)" },
    note: "뉴스룸 > 보도자료(BBS_0000090). robots.txt의 * 묶음이 Allow: /. 목록 요약(span.txt)은 읽지 않고 제목(strong)만 읽음. 원문 주소(dataSid) 열람 확인.",
  },
  {
    org: "전남광주통합특별시", key: "jeonnam-gwangju", adapter: "HTMLBoardAdapter", method: "HTML", verification: "ENDPOINT_VERIFIED",
    homepage: "https://www.jeonnam-gwangju.go.kr", endpoint: "https://www.jeonnam-gwangju.go.kr/boardList.do?boardId=JG_0000000003&pageId=jngj22", hosts: ["www.jeonnam-gwangju.go.kr"],
    profile: { link: "boardView\\.do\\?pageId=jngj22&(?:amp;)?boardId=JG_0000000003&(?:amp;)?seq=(?<id>\\d+)", url: "https://www.jeonnam-gwangju.go.kr/boardView.do?pageId=jngj22&boardId=JG_0000000003&seq={id}", title: "text" },
    note: "보도자료 목록(JG_0000000003). robots.txt가 Allow. 원문 주소(seq) 열람 확인.",
  },
  {
    org: "부산광역시", key: "busan", adapter: "RSSAdapter", method: "RSS", verification: "ENDPOINT_VERIFIED", checkedAt: "recheck",
    homepage: "https://www.busan.go.kr", endpoint: "https://www.busan.go.kr/nbtnewsBU.rss", hosts: ["www.busan.go.kr"],
    note: "보도자료 RSS 2.0 정상(채널 제목 '부산광역시 : 보도자료'). 표준 주소 /robots.txt 는 보안 장비가 차단 페이지(HTTP 401)를 돌려주지만, 같은 서버의 //robots.txt 응답 내용은 'User-agent: * / Disallow: /search/' 뿐이라 이 RSS 경로는 허용 범위다. 이 경로로 읽은 정책을 인정할지는 운영자가 판단한다. RSS 링크는 http라 https로 올려 저장한다.",
  },
  ...[
    ["대구광역시", "daegu", "https://info.daegu.go.kr/newshome/mtnmain.php?mtnkey=scatelist&mkey=26", "robots.txt가 보도자료 목록 경로를 Disallow."],
    ["세종특별자치시", "sejong", "https://www.sejong.go.kr/bbs/R0071/list.do", "robots.txt가 보도자료 목록 경로를 Disallow."],
    ["충청북도", "chungbuk", "https://www.chungbuk.go.kr/www/selectBbsNttList.do?bbsNo=7&key=429", "robots.txt가 게시판 목록 경로를 Disallow."],
    ["경상남도", "gyeongnam", "https://www.gyeongnam.go.kr/board/list.gyeong?boardId=BBS_0000057&menuCd=DOM_000000135003001000", "robots.txt가 게시판 목록 경로를 Disallow."],
    ["제주특별자치도", "jeju", "https://www.jeju.go.kr/news/bodo/list.htm?act=rss", "보도자료 RSS가 있으나 robots.txt가 Disallow: / 이고 /news 는 허용 목록에 없음."],
  ].map(([org, key, endpoint, note]) => ({ org, key, adapter: "NONE", method: "HTML", verification: "BLOCKED_ROBOTS", homepage: new URL(endpoint).origin, endpoint, hosts: [], note })),
  {
    org: "울산광역시", key: "ulsan", adapter: "HTMLBoardAdapter", method: "HTML", verification: "ENDPOINT_VERIFIED", checkedAt: "recheck",
    homepage: "https://www.ulsan.go.kr", endpoint: "https://www.ulsan.go.kr/u/rep/bbs/list.ulsan?bbsId=BBS_0000000000000027&mId=001004003001000000", hosts: ["www.ulsan.go.kr"],
    profile: { link: "bbsId=BBS_0000000000000027&(?:amp;)?dataId=(?<id>\\d+)", url: "https://www.ulsan.go.kr/u/rep/bbs/view.do?mId=001004003001000000&bbsId=BBS_0000000000000027&dataId={id}", title: "text" },
    note: "홈페이지 '보도자료 더보기'가 연결하는 보도자료 게시판(BBS_0000000000000027). robots.txt가 Allow. 원문 주소(dataId) 열람 확인. 처음 확인한 BBS_0000000000000003은 새소식 게시판이라 바꿨다.",
  },
  {
    org: "경상북도", key: "gyeongbuk", adapter: "HTMLBoardAdapter", method: "HTML", verification: "ENDPOINT_VERIFIED", checkedAt: "recheck",
    homepage: "https://www.gb.go.kr", endpoint: "https://www.gb.go.kr/page/10107/10004.do", hosts: ["www.gb.go.kr"],
    profile: { link: "boardList\\.view\\('(?<id>\\d+)'\\)", url: "https://www.gb.go.kr/page/10107/10004.do?pageDtlOrdrNo=1&boardNo={id}&boardMngNo=12&importUrl=/board/view.do", title: "attr:title" },
    note: "보도자료 목록(공공누리 제3유형: 제목·주소·날짜만 보관). 상세보기 boardList.view(boardNo)는 page.js pageFormSubmit가 method 없이 GET으로 현재 주소에 boardNo·boardMngNo·importUrl=/board/view.do를 붙여 보낸다. 같은 GET 주소로 원문 열람·제목 일치 확인(2026-10-05, 이전 'POST 전용' 판정 정정). robots.txt는 없음(HTML 응답).",
  },
  {
    org: "대전광역시", key: "daejeon", adapter: "HTMLBoardAdapter", method: "HTML", verification: "ENDPOINT_VERIFIED", checkedAt: "recheck",
    homepage: "https://www.daejeon.go.kr", endpoint: "https://www.daejeon.go.kr/drh/board/boardNormalList.do?boardId=normal_0189&menuSeq=1632", hosts: ["www.daejeon.go.kr"],
    profile: { link: "boardNormalView\\.do\\?boardId=normal_0189[^\"]*ntatcSeq=(?<id>\\d+)", url: "https://www.daejeon.go.kr/drh/board/boardNormalView.do?boardId=normal_0189&menuSeq=1632&ntatcSeq={id}", title: "text", date: "class=\"date\">\\s*([\\d-]+)" },
    note: "홈페이지 메뉴 '보도자료'가 연결하는 게시판(normal_0189). robots.txt가 Allow. 원문 주소(ntatcSeq) 열람 확인. 같은 메뉴의 '대전소식모아보기(자치구)'는 자치구·교육청 자료 모음이라 시청 Source로 쓰지 않았다.",
  },
];
