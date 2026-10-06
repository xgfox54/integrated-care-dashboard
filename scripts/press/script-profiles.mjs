// 스크립트 링크(onclick·javascript:) 보도자료 게시판의 개별 프로필(작업지시서 v5 §23.6).
// 자동 탐색이 상세 링크 묶음을 못 찾은 게시판을 사람이 목록 화면의 JS 함수 정의(원문 주소를 만드는 줄)를 읽어 프로필로 적고,
// 이 스크립트가 자동 탐색과 같은 기준(robots 허용, 목록 5건·날짜 3건 이상, 제목 150자 이하, 첫 게시물 원문 주소에서 제목 일치)으로 검증한다.
// 주소 틀 후보가 여럿이면 차례로 시험해 처음 통과한 것만 쓴다. 통과한 것만 boards.json에 AUTO_VERIFIED(개별 프로필)로 기록한다.
//   node scripts/press/script-profiles.mjs [--write] [--only <목록 주소 일부(영문)>]
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { parseHtmlBoard } from "../../lib/press/html-board.ts";
import { politeFetch, robotsFor } from "./discover.mjs";

const PROFILES = [
  { org: "org:경기도:과천시", endpoint: "https://www.gccity.go.kr/portal/newsList/list.do?mId=0301140000", basis: "fn_go_view(idx): /portal/newsList/view.do?mId=0301140100&idx=", link: "fn_go_view\\(\\s*'?(?<id>\\d+)", urls: ["https://www.gccity.go.kr/portal/newsList/view.do?mId=0301140100&idx={id}"] },
  { org: "org:경기도:고양시", endpoint: "https://www.goyang.go.kr/news/user/bbs/BD_selectBbsList.do?q_bbsCode=1090&q_estnColumn1=All", basis: "fnView(bbsCode, bbscttSn, …): /news/user/bbs/BD_selectBbs.do?q_bbsCode=&q_bbscttSn=", link: "fnView\\('1090',\\s*'(?<id>\\d+)'", urls: ["https://www.goyang.go.kr/news/user/bbs/BD_selectBbs.do?q_bbsCode=1090&q_bbscttSn={id}&q_estnColumn1=All"] },
  { org: "org:경기도:안성시", endpoint: "https://www.anseong.go.kr/portal/saeol/newsList.do?mId=0502010100", basis: "boardView(page, idx): /portal/saeol/newsView.do?newsEpctNo=", link: "boardView\\('\\d+',\\s*'(?<id>\\d+)'", urls: ["https://www.anseong.go.kr/portal/saeol/newsView.do?newsEpctNo={id}&mId=0502010100"] },
  { org: "org:대전광역시:중구", endpoint: "https://www.djjunggu.go.kr/bbs/BBSMSTR_000000000137/list.do", basis: "fn_search_detail(nttId): /bbs/BBSMSTR_000000000137/view.do (nttId)", link: "fn_search_detail\\('(?<id>[\\w]+)'\\)", urls: ["https://www.djjunggu.go.kr/bbs/BBSMSTR_000000000137/view.do?nttId={id}"] },
  { org: "org:대전광역시:유성구", endpoint: "https://www.yuseong.go.kr/bbs/BBSMSTR_000000000103/list.do", basis: "fn_search_detail(nttId): /bbs/BBSMSTR_000000000103/view.do (nttId)", link: "fn_search_detail\\('(?<id>[\\w]+)'\\)", urls: ["https://www.yuseong.go.kr/bbs/BBSMSTR_000000000103/view.do?nttId={id}"] },
  { org: "org:충청남도:홍성군", endpoint: "https://www.hongseong.go.kr/bbs/BBSMSTR_000000000842/list.do", basis: "fn_search_detail(nttId): /bbs/BBSMSTR_000000000842/view.do (nttId). 카드형 목록이라 제목은 strong.tit만 읽음(요약 제외)", link: "fn_search_detail\\('(?<id>[\\w]+)'\\)", title: "<strong class=\"tit\">\\s*([^<]+)", urls: ["https://www.hongseong.go.kr/bbs/BBSMSTR_000000000842/view.do?nttId={id}"] },
  { org: "org:충청남도:공주시", endpoint: "https://www.gongju.go.kr/prog/saeolNews/sub04_02_01/list.do", basis: "fn_search_detail(newsEpctNo): /prog/saeolNews/sub04_02_01/view.do?newsEpctNo=", link: "fn_search_detail\\('(?<id>\\d+)'\\)", urls: ["https://www.gongju.go.kr/prog/saeolNews/sub04_02_01/view.do?newsEpctNo={id}"] },
  { org: "org:울산광역시:동구", endpoint: "https://www.donggu.ulsan.kr/cop/bbs/selectBoardList.do?bbsId=BBSMSTR_000000000322", basis: "goBoardArticle(nttId): /cop/bbs/selectBoardArticle.do (nttId, bbsId). 번호 칸 링크는 건너뛰고 한글 제목 링크만 읽음", link: "goBoardArticle\\('(?<id>\\d+)'\\)", title: "^\\s*([^<]*[가-힣][^<]*)", urls: ["https://www.donggu.ulsan.kr/cop/bbs/selectBoardArticle.do?bbsId=BBSMSTR_000000000322&nttId={id}"] },
  ...[["org:경기도:광주시", "https://www.gjcity.go.kr", "22", "0203010000"], ["org:경상북도:김천시", "https://www.gc.go.kr", "1944", "1203060000", "<span class=\"tit\">\\s*([^<]+)"], ["org:경상북도:칠곡군", "https://www.chilgok.go.kr", "224", "0202010000"], ["org:부산광역시:연제구", "https://www.yeonje.go.kr", "12", "0206050000"]].map(([org, host, pt, mid, title]) => ({
    org, endpoint: host + "/portal/bbs/list.do?ptIdx=" + pt + "&mId=" + mid, basis: "goTo.view('list', bIdx, ptIdx, mId): 같은 CMS의 /portal/bbs/view.do(김천시는 data-action에도 같은 주소)", link: "goTo\\.view\\('list',\\s*'(?<id>\\d+)'", ...(title ? { title } : {}),
    urls: [host + "/portal/bbs/view.do?mId=" + mid + "&bIdx={id}&ptIdx=" + pt, host + "/portal/bbs/view.do?bIdx={id}&ptIdx=" + pt + "&mId=" + mid],
  })),
  ...[["org:대구광역시:수성구", "https://www.suseong.kr", "00000070", "BBSMSTR_000000000019"], ["org:대구광역시:달성군", "https://www.dalseong.daegu.kr", "00000195", "BBS_00071"], ["org:대구광역시:북구", "https://www.buk.daegu.kr", "00000201", "BBSMSTR_000000001178"]].map(([org, host, menu, bbs]) => ({
    org, endpoint: host + "/index.do?menu_id=" + menu, basis: "fn_icms_navi_common('view', nttId): icms.board.js getActionUrl → index.do?menu_link=/icms/bbs/selectBoardArticle.do + 폼의 menu_id·bbsId·nttId", link: "fn_icms_navi_common\\('view',\\s*'(?<id>\\d+)'",
    urls: [host + "/index.do?menu_link=/icms/bbs/selectBoardArticle.do&menu_id=" + menu + "&bbsId=" + bbs + "&nttId={id}"],
  })),
  { org: "org:경기도:수원시", endpoint: "https://www.suwon.go.kr/web/board/BD_board.list.do?bbsCd=1043", basis: "jsView(bbsCd, seq, …): board.js의 BD_board.view.do", link: "jsView\\('1043',\\s*'(?<id>\\d+)'", urls: ["https://www.suwon.go.kr/web/board/BD_board.view.do?bbsCd=1043&seq={id}"] },
  { org: "org:서울특별시:관악구", endpoint: "https://www.gwanak.go.kr/site/gwanak/ex/bbs/List.do?cbIdx=295", basis: "doBbsFView(cbIdx, bcIdx, …): /site/gwanak/ex/bbs/View.do?cbIdx=&bcIdx=", link: "doBbsFView\\('295',\\s*'(?<id>\\d+)'", title: "attr:title", urls: ["https://www.gwanak.go.kr/site/gwanak/ex/bbs/View.do?cbIdx=295&bcIdx={id}"] },
  { org: "org:서울특별시:서대문구", endpoint: "https://www.sdm.go.kr/news/news/masscom.do", basis: "goView(seq): 같은 주소에 mode=view, sdmBoardSeq", link: "goView\\('(?<id>\\d+)'\\)", title: "attr:title", urls: ["https://www.sdm.go.kr/news/news/masscom.do?mode=view&sdmBoardSeq={id}"] },
  { org: "org:전남광주통합특별시:광양시", endpoint: "https://gwangyang.go.kr/board.es?mid=a11007000000&bid=0057", basis: "href의 act=view&list_no (goView도 같은 주소). '새글' 표시는 제목에서 뺌", link: "bid=0057&(?:amp;)?act=view&(?:amp;)?list_no=(?<id>\\d+)", title: "(?:<span[^>]*>[^<]*</span>\\s*)?([^<\\s][^<]*)", urls: ["https://gwangyang.go.kr/board.es?mid=a11007000000&bid=0057&act=view&list_no={id}"] },
  { org: "org:서울특별시:노원구", endpoint: "https://www.nowon.kr/www/user/bbs/BD_selectBbsList.do?q_bbsCode=1027", basis: "href의 BD_selectBbs.do?q_bbsCode=1027&q_bbscttSn=", link: "q_bbscttSn=(?<id>\\d+)", urls: ["https://www.nowon.kr/www/user/bbs/BD_selectBbs.do?q_bbsCode=1027&q_bbscttSn={id}"] },
  { org: "org:경기도:파주시", endpoint: "https://www.paju.go.kr/user/board/BD_board.list.do?bbsCd=1023&q_ctgCds=5226,5227,5229", basis: "jsView(bbsCd, seq, …): 수원시와 같은 CMS의 BD_board.view.do", link: "jsView\\('1023',\\s*'(?<id>\\d+)'", title: "^\\s*([^<]+)", urls: ["https://www.paju.go.kr/user/board/BD_board.view.do?bbsCd=1023&seq={id}"] },
  { org: "org:대전광역시:대덕구", endpoint: "https://www.daedeok.go.kr/dpt/dpt04/DPT040301_cmmBoardList.do", basis: "href의 DPT040301_cmmBoardView.do?boardId=DPT_000001&ntatcSeq=. 모바일용 <p>(날짜·작성자) 뒤의 제목만 읽음", link: "cmmBoardView\\.do\\?boardId=DPT_000001[^\"']*?ntatcSeq=(?<id>\\d+)", title: "</p>\\s*([^<]+)", urls: ["https://www.daedeok.go.kr/dpt/dpt04/DPT040301_cmmBoardView.do?boardId=DPT_000001&ntatcSeq={id}"] },
  ...[["org:경상남도:고성군", "https://www.goseong.go.kr", "goseong", "BBS_0000196", "DOM_000000102002008000", "365"], ["org:부산광역시:부산진구", "https://www.busanjin.go.kr", "busanjin", "BBS_0000031", "DOM_000000110003000000", "319"], ["org:부산광역시:금정구", "https://www.geumjeong.go.kr", "geumj", "BBS_0000005", "DOM_000000124002002000", "3856"], ["org:부산광역시:동구", "https://www.bsdonggu.go.kr", "donggu", "BBS_0000025", "DOM_000000103001006000", "278"]].map(([org, host, ext, board, menu, sid]) => ({
    org, endpoint: host + "/board/list." + ext + "?boardId=" + board + "&menuCd=" + menu + "&contentsSid=" + sid, basis: "href의 /board/view." + ext + "?boardId=" + board + "&dataSid= (내려받기·첨부 아이콘 링크 제외, 날짜 칸 class=date 또는 다음 칸)",
    // 금정구는 날짜 칸에 class가 없어(<td> 2026-10-02 </td>) 날짜 칸 지정 없이 게시물 구간의 첫 날짜를 쓴다.
    link: "view\\." + ext + "\\?boardId=" + board + "&amp;menuCd=[^\"']*?&amp;paging=ok[^\"']*?dataSid=(?<id>\\d+)", title: "attr:title", ...(ext === "geumj" ? {} : { date: "<td class=\"(?:date|mobile_need)\">\\s*([0-9.\\-/]+)" }),
    urls: [host + "/board/view." + ext + "?boardId=" + board + "&menuCd=" + menu + "&dataSid={id}"],
  })),
  { org: "org:강원특별자치도:평창군", endpoint: "https://www.pc.go.kr/portal/government/government-press/government-press-press", basis: "첫 화면 메뉴가 스크립트라 /portal/sitemap.do에서 보도자료 메뉴를 찾음. 상세는 같은 주소 ?articleSeq=", link: "government-press-press[^\"']*?[?&](?:amp;)?articleSeq=(?<id>\\d+)", urls: ["https://www.pc.go.kr/portal/government/government-press/government-press-press?articleSeq={id}"] },
  ...[["org:충청남도:천안시", "https://www.cheonan.go.kr", "BBSMSTR_000000000030", "<strong class=\"bbs__title\">\\s*([^<]+)"], ["org:충청남도:예산군", "https://www.yesan.go.kr", "BBSMSTR_000000000047", "<strong class=\"bbs__title\">\\s*([^<]+)"], ["org:대전광역시:서구", "https://www.seogu.go.kr", "BBSMSTR_000000000277", "<strong class=\"bbs-subject-txt\">\\s*([^<]+)"]].map(([org, host, bbs, title]) => ({
    org, endpoint: host + "/bbs/" + bbs + "/list.do", basis: "<button onclick=fn_search_detail(nttId)>: /bbs/" + bbs + "/view.do (nttId). 목록 행이 button이라 tag=button", link: "fn_search_detail\\('(?<id>\\w+)'\\)", tag: "button", title, urls: [host + "/bbs/" + bbs + "/view.do?nttId={id}"],
  })),
  ...[["org:경기도:구리시", "https://www.guri.go.kr", "393", "42"], ["org:충청북도:음성군", "https://www.eumseong.go.kr", "353", "27"]].map(([org, host, key, bbs]) => ({
    org, endpoint: host + "/www/selectBbsNttList.do?bbsNo=" + bbs + "&key=" + key, basis: "href의 selectBbsNttView.do?key=&bbsNo=&nttNo=", link: "selectBbsNttView\\.do\\?key=" + key + "&(?:amp;)?bbsNo=" + bbs + "&(?:amp;)?nttNo=(?<id>\\d+)", title: "^\\s*([^<]*[가-힣][^<]*)", urls: [host + "/www/selectBbsNttView.do?key=" + key + "&bbsNo=" + bbs + "&nttNo={id}"],
  })),
  { org: "org:서울특별시:구로구", endpoint: "https://www.guro.go.kr/www/selectBbsNttList.do?bbsNo=665&key=1793", basis: "href의 selectBbsNttView.do?bbsNo=665&nttNo= (NEW 표시 제외, 날짜는 <time datetime>)", link: "selectBbsNttView\\.do\\?bbsNo=665&(?:amp;)?nttNo=(?<id>\\d+)", title: "^\\s*([^<]*[가-힣][^<]*)", date: "<time datetime=\"([0-9-]+)\"", urls: ["https://www.guro.go.kr/www/selectBbsNttView.do?bbsNo=665&nttNo={id}&key=1793"] },
  { org: "org:경기도:안산시", endpoint: "https://www.ansan.go.kr/www/common/bbs/selectPageListBbs.do?bbs_code=B0238", basis: "fnGoDetail(bbs_seq): GET /www/common/bbs/selectBbsDetail.do (bbs_code, bbs_seq)", link: "fnGoDetail\\(\\s*(?<id>\\d+)", title: "^\\s*([^<]*[가-힣][^<]*)", urls: ["https://www.ansan.go.kr/www/common/bbs/selectBbsDetail.do?bbs_code=B0238&bbs_seq={id}"] },
  { org: "org:경기도:이천시", endpoint: "https://www.icheon.go.kr/news/board/post/list.do?bcIdx=785&mid=0301000000", basis: "yhLib.inline.post: data-req-get-p-idx + viewForm action /news/board/post/view.do?bcIdx=785&mid=0301000000&idx=", link: "data-req-get-p-idx=\"(?<id>\\d+)\"", title: "<span class=\"tit\">\\s*([^<]+)", urls: ["https://www.icheon.go.kr/news/board/post/view.do?bcIdx=785&mid=0301000000&idx={id}"] },
  { org: "org:경상북도:구미시", endpoint: "https://www.gumi.go.kr/portal/board/post/list.do?bcIdx=211&mid=0504020000", basis: "yhLib.inline.post: data-req-get-p-idx + viewForm action /portal/board/post/view.do?bcIdx=211&mid=0504020000 (idx)", link: "data-req-get-p-idx=\"(?<id>\\d+)\"", title: "<span class=\"blind\">\\s*([^<]+?)\\s*게시글 상세보기", urls: ["https://www.gumi.go.kr/portal/board/post/view.do?bcIdx=211&mid=0504020000&idx={id}"] },
  { org: "org:전남광주통합특별시:영암군", endpoint: "https://www.yeongam.go.kr/home/www/open_information/yeongam_news/bodo/yeongam.go", basis: "href의 bodo/show/<글 ID>. 사진 링크는 건너뛰고 span.title만 제목으로 읽음, 요약(memo)은 읽지 않음", link: "bodo/show/(?<id>[\\w-]+)", title: "<span class=\"title[^\"]*\">\\s*([^<]+)", date: "class=\"date\">[^<]*?(20\\d{2}-\\d{2}-\\d{2})", urls: ["https://www.yeongam.go.kr/home/www/open_information/yeongam_news/bodo/show/{id}"] },
  { org: "org:전남광주통합특별시:장성군", endpoint: "https://www.jangseong.go.kr/home/www/news/jangseong/bodo", basis: "href의 bodo/show/<번호>", link: "bodo/show/(?<id>\\d+)", urls: ["https://www.jangseong.go.kr/home/www/news/jangseong/bodo/show/{id}"] },
  { org: "org:서울특별시:강남구", endpoint: "https://www.gangnam.go.kr/board/B_000031/list.do?mid=ID01_0313", basis: "href의 /board/B_000031/<번호>/view.do (번호가 경로 안에 있어 자동 탐색의 쿼리 기준에 안 맞음)", link: "/board/B_000031/(?<id>\\d+)/view\\.do", urls: ["https://www.gangnam.go.kr/board/B_000031/{id}/view.do?mid=ID01_0313"] },
  { org: "org:서울특별시:강동구", endpoint: "https://www.gangdong.go.kr/web/newportal/press/list", basis: "href의 /web/newportal/press/<번호>", link: "/web/newportal/press/(?<id>\\d+)[\"']", urls: ["https://www.gangdong.go.kr/web/newportal/press/{id}"] },
  { org: "org:경기도:성남시", endpoint: "https://www.seongnam.go.kr/bbs010501", basis: "onclick=fn_move_form(pstSn): 폼 action /bbs010501/<pstSn>(같은 주소 GET도 원문 열람). 날짜는 썸네일 목록의 작성일 칸. 목록의 요약 본문(dd)은 읽지 않음", link: "fn_move_form\\('(?<id>\\d+)'\\)", title: "^\\s*([^<]*[가-힣][^<]*)", date: "작성일</b></span>\\s*<span>([0-9-]+)", urls: ["https://www.seongnam.go.kr/bbs010501/{id}"] },
  { org: "org:경상북도:포항시", endpoint: "https://www.pohang.go.kr/news/board/post/list.do?bcIdx=644&mid=0102000000", basis: "포항시 누리집 뉴스 > 보도자료(포털 사이트맵에는 메뉴가 없고 /news/ 하위 사이트에 있음). yhLib.inline.post: data-req-get-p-idx + viewForm action /news/board/post/view.do?bcIdx=644&mid=0102000000 (idx)", link: "data-req-get-p-idx=\"(?<id>\\d+)\"", title: "<span class=\"tit\">\\s*([^<]+)", date: "<span class=\"date\">\\s*([0-9-]+)", urls: ["https://www.pohang.go.kr/news/board/post/view.do?bcIdx=644&mid=0102000000&idx={id}"] },
  { org: "org:강원특별자치도:속초시", endpoint: "https://www.sokcho.go.kr/sc/portal/sokchonews/pressrelease", basis: "<a class=goPage data-seq=번호>: 같은 주소 ?articleSeq=번호 GET 열람. 날짜는 목록 오른쪽 칸. 서버가 중간 인증서를 보내지 않아 scripts/press/ca/intermediates.pem으로 확인", link: "data-seq=\"(?<id>\\d+)\"", title: "<span[^>]*>\\s*([^<]+)", date: "color: #8d8d8d;\">\\s*([0-9-]+)", urls: ["https://www.sokcho.go.kr/sc/portal/sokchonews/pressrelease?articleSeq={id}"] },
  { org: "org:강원특별자치도:인제군", endpoint: "https://m.inje.go.kr/portal/inje-news/inje-pr/briefing", basis: "href ?articleSeq=번호(일반 링크)이지만 </a> 없이 </td>로 칸이 끝나 tag=a-unclosed. 날짜는 skinTb-date 칸", link: "briefing\\?articleSeq=(?<id>\\d+)", tag: "a-unclosed", title: "^\\s*([^<]*[가-힣][^<]*)", date: "skinTb-date[^\">]*\">\\s*([0-9-]+)", urls: ["https://m.inje.go.kr/portal/inje-news/inje-pr/briefing?articleSeq={id}"] },
  { org: "org:경기도:의정부시", endpoint: "https://www.ui4u.go.kr/portal/bbs/list.do?ptIdx=1709&mId=0301020000", basis: "onclick=boardView(site, form, writeId, public, bIdx, ptIdx, mId, page): board.js가 /portal/bbs/view.do?mId=&bIdx=&ptIdx= 로 보냄(GET 열람). 제목은 링크 title 속성", link: "boardView\\('portal', 'listForm', '\\w+', '\\w', '(?<id>\\d+)', '1709'", title: "attr:title", date: "작성일\\s*([0-9.]+)", urls: ["https://www.ui4u.go.kr/portal/bbs/view.do?mId=0301020000&bIdx={id}&ptIdx=1709"] },
  { org: "org:경상북도:문경시", endpoint: "https://www.gbmg.go.kr/portal/mayorForcus/list.do?mId=0302010000", basis: "onclick=goView(idx): unit/mayorForcus/list.js가 /portal/mayorForcus/view.do?idx=&mId= 로 보냄(GET 열람). robots.txt 금지 규칙은 Googlebot 전용", link: "goView\\('(?<id>\\d+)'\\)", title: "<span class=\"blog_tit\">\\s*([^<]+)", date: "작성일\\s*([0-9.-]+)", urls: ["https://www.gbmg.go.kr/portal/mayorForcus/view.do?idx={id}&mId=0302010000"] },
  { org: "org:경기도:광명시", endpoint: "https://news.gm.go.kr/bbs/list.html?table=bbs_12", basis: "자동 탐색이 http 주소로 확인했으나 수집기는 https 원문 주소만 받아 운영에서 PROFILE_INVALID. 같은 목록·원문(view.html?idxno=)이 https로 열려 https로 다시 확인", link: "view\\.html[^\"']*?[?&](?:amp;)?idxno=(?<id>\\d+)", title: "text", urls: ["https://news.gm.go.kr/bbs/view.html?idxno={id}"] },
  // 링크 안에 제목과 함께 담당 정보·본문 요약이 들어 있는 게시판. 자동 탐색의 title "text"(링크 글자 전체)가 본문까지 제목으로 저장해(2026-10-05 발견) 제목 요소만 읽게 고침.
  { org: "org:강원특별자치도:춘천시", endpoint: "https://www.chuncheon.go.kr/mayor/newsroom/press-release/", basis: "링크 안 <p>가 제목, 그 뒤 ul.news-box-info(부서·담당자·전화·날짜)와 <span>(본문 요약). 제목은 첫 <p>만, 날짜는 정보 목록의 날짜 칸", link: "press-release/\\?bbsId=BBSMSTR_000000000335&(?:amp;)?nttId=(?<id>\\d+)", title: "<p>\\s*([^<]+)", date: "<li>\\s*(20\\d{2}-\\d{2}-\\d{2})\\s*</li>", urls: ["https://www.chuncheon.go.kr/mayor/newsroom/press-release/?bbsId=BBSMSTR_000000000335&nttId={id}&flag=view"] },
  { org: "org:전북특별자치도:진안군", endpoint: "https://www.jinan.go.kr/board/list.jinan?boardId=BBS_0000034&menuCd=DOM_000000107002002000&contentsSid=187&cpath=", basis: "링크 안 <strong>이 제목, 뒤의 HTML 주석과 <p>는 본문 요약. 제목은 <strong>만", link: "view\\.jinan[^\"']*?[?&](?:amp;)?dataSid=(?<id>\\d+)", title: "<strong>\\s*([^<]+)", urls: ["https://www.jinan.go.kr/board/view.jinan?boardId=BBS_0000034&menuCd=DOM_000000107002002000&orderBy=REGISTER_DATE+DESC&paging=ok&startPage=1&dataSid={id}"] },
  { org: "org:전남광주통합특별시:목포시", endpoint: "https://www.mokpo.go.kr/www/mokpo_news/press_release", basis: "링크 안 div.title_box <h3>가 제목, 뒤의 <p>는 부제·본문 요약. 제목은 <h3>만, 날짜는 dd.date", link: "report_material\\?idx=(?<id>\\d+)&(?:amp;)?mode=view\" class=\"item_cont", title: "<h3>\\s*([^<]+)", date: "class=\"date\">\\s*([0-9-]+)", urls: ["https://www.mokpo.go.kr/www/mokpo_news/press_release/report_material?idx={id}&mode=view"] },
  { org: "org:경상남도:양산시", endpoint: "https://www.yangsan.go.kr/portal/saeol/news/list.do?mid=0105010000", basis: "req.post: data-action /portal/saeol/news/view.do + data-keyset newsEpctNo", link: "data-keyset=\"\\{'newsEpctNo':\\s*'(?<id>\\d+)'", urls: ["https://www.yangsan.go.kr/portal/saeol/news/view.do?newsEpctNo={id}&mid=0105010000"] },
  { org: "org:대구광역시:동구", endpoint: "https://www.dong.daegu.kr/portal/saeol/news/list.do?mid=0201070000", basis: "양산시와 같은 새올 보도자료 화면(req.post, data-keyset newsEpctNo). 자동 탐색은 메뉴 링크 묶음을 잘못 잡았음", link: "data-keyset=\"\\{'newsEpctNo':\\s*'(?<id>\\d+)'", urls: ["https://www.dong.daegu.kr/portal/saeol/news/view.do?newsEpctNo={id}&mid=0201070000"] },
  ...[["org:경기도:부천시:원미구", "wonmi", "28108", "170003002"], ["org:경기도:부천시:소사구", "sosa", "28356", "171003002"], ["org:경기도:부천시:오정구", "ojeong", "28012", "169003002"]].map(([org, sub, type, menu]) => ({
    org, endpoint: "https://" + sub + ".bucheon.go.kr/site/program/board/basicboard/list?boardtypeid=" + type + "&menuid=" + menu, basis: "일반구 자체 보도자료 게시판(구청 누리집 " + sub + ".bucheon.go.kr, scripts/press/general-districts.mjs에서 발견). 상세는 view?boardid=",
    link: "view\\?menuid=" + menu + "[^\"']*?boardtypeid=" + type + "[^\"']*?boardid=(?<id>\\d+)", urls: ["https://" + sub + ".bucheon.go.kr/site/program/board/basicboard/view?menuid=" + menu + "&boardtypeid=" + type + "&boardid={id}"],
 })),
  { org: "org:충청남도:당진시", endpoint: "https://www.dangjin.go.kr/cop/bbs/BBSMSTR_000000000014/selectBoardList.do", basis: "카드형 목록. 제목 링크(title 속성 있음)만 읽고 같은 번호의 요약 링크(div.pt, 본문 일부)는 건너뜀. 날짜는 '등록일자' 칸", link: "selectBoardArticle\\.do\\?nttId=(?<id>\\d+)\"\\s+title=", title: "attr:title", date: "등록일자</strong>\\s*([0-9.]+)", urls: ["https://www.dangjin.go.kr/cop/bbs/BBSMSTR_000000000014/selectBoardArticle.do?nttId={id}"] },
];

// 글자·숫자만 남겨 비교한다(목록은 &lt; 등을 풀어 쓰고 원문은 그대로 두는 차이를 없앰).
const compact = (text) => text.replace(/&[a-z#0-9]+;/gi, "").replace(/[^\p{L}\p{N}]/gu, "");

async function verify(spec) {
  if ((await robotsFor(spec.endpoint)) === "DISALLOWED") return { status: "BLOCKED_ROBOTS", reason: "목록 경로를 robots.txt가 막음" };
  const list = await politeFetch(spec.endpoint);
  if (!list.ok) return { status: "ACCESS_ERROR", reason: String(list.error ?? "HTTP_" + list.status) };
  const tries = [];
  for (const url of spec.urls) {
    const profile = { link: spec.link, url, title: spec.title ?? "text", ...(spec.date ? { date: spec.date } : {}), ...(spec.tag ? { tag: spec.tag } : {}) };
    const items = parseHtmlBoard(list.text, profile);
    const dated = items.filter((item) => item.pubDate).length;
    if (items.length < 5 || dated < 3) return { status: "CANDIDATE_NEEDS_REVIEW", reason: "목록 항목 " + items.length + "건, 날짜 " + dated + "건(기준 미달)" };
    if (items.some((item) => item.title.length > 150)) return { status: "CANDIDATE_NEEDS_REVIEW", reason: "제목이 150자를 넘음" };
    const detailUrl = items[0].link;
    if ((await robotsFor(detailUrl)) === "DISALLOWED") { tries.push(url + " → robots 금지"); continue; }
    const detail = await politeFetch(detailUrl);
    if (!detail.ok) { tries.push(url + " → " + (detail.error ?? detail.status)); continue; }
    if (!compact(detail.text).includes(compact(items[0].title).slice(0, 12))) { tries.push(url + " → 제목 불일치"); continue; }
    return { status: "AUTO_VERIFIED", reason: "개별 프로필(자동 탐색 실패 게시판): 목록 " + items.length + "건·날짜 " + dated + "건 확인, 첫 게시물 원문 주소에서 제목 일치", profile, items: items.length, latest: items.map((item) => item.pubDate).filter(Boolean).sort().pop() ?? null, tries };
  }
  return { status: "CANDIDATE_NEEDS_REVIEW", reason: "개별 프로필 주소 틀이 원문과 맞지 않음", tries };
}

const write = process.argv.includes("--write");
const boardsFile = new URL("../../docs/press/discovery/boards.json", import.meta.url);
const boards = JSON.parse(readFileSync(boardsFile, "utf8"));
// 자동 탐색은 통과했지만 메뉴명이 '보도자료'가 아니어서 보류된 게시판 중, 사람이 목록을 읽고 기관이 직접 낸 보도·해명·군정 뉴스임을 확인한 곳.
// 공지·안내 게시판(하남 시정소식·경주 시정소식·울산 북구 알림사항), 웹진(김제), 외부 언론 보도 모음일 수 있는 곳(장수 언론보도)은 넣지 않았다.
const MENU_REVIEWED = {
  "org:경상북도:청송군": "메뉴 '보도·해명 자료', 게시물 제목이 'YYMMDD보도자료(…)'",
  "org:부산광역시:서구": "메뉴 '보도/해명 자료'(서구소식), 구청 발표 글",
  "org:인천광역시:옹진군": "메뉴 '보도/해명', 군청 발표 글",
  "org:경상남도:함양군": "메뉴 '군정뉴스'(뉴스포털), '함양군, …' 형식의 군청 발표 글",
  "org:경상북도:예천군": "메뉴 '군정소식 > 주요뉴스', '예천군, …' 형식의 군청 발표 글",
  "org:충청북도:제천시": "메뉴 '보도해명', 시청 공식 입장·해명(게시 빈도 낮음)",
};
for (const [org, basis] of Object.entries(MENU_REVIEWED)) {
  const board = boards.boards[org];
  if (!board?.pattern?.profile || PROFILES.some((spec) => spec.org === org)) continue;
  PROFILES.push({ org, endpoint: board.endpoint.replace(/;jsessionid=[^?]*/i, ""), basis: "자동 탐색 프로필 + 메뉴 사람 확인: " + basis, link: board.pattern.profile.link, title: board.pattern.profile.title, urls: [board.pattern.profile.url] });
}
// 자동 탐색 프로필은 맞지만 '원문에서 제목 찾기'가 목록의 풀린 문자(‘ 등)와 원문의 엔티티(&lsquo;) 차이로 실패한 게시판.
// 글자·숫자만 비교하는 이 스크립트의 기준으로 다시 확인한다. 주소 틀은 자동 탐색 값과 검색 조건을 뺀 짧은 주소를 차례로 시험한다.
const REVERIFY = {
  "org:경상북도:울릉군": "https://www.ulleung.go.kr/ko/page.do?mnu_uid=574&bod_uid={id}&cmd=2",
  "org:경상북도:의성군": "https://www.usc.go.kr/ko/page.do?mnu_uid=190&bod_uid={id}&cmd=2",
  "org:대구광역시:군위군": "https://www.gunwi.go.kr/ko/page.do?mnu_uid=106&bod_uid={id}&cmd=2",
  "org:강원특별자치도:양구군": "https://www.yanggu.go.kr/user_sub?gfnc=www&bk={id}&mu_idx=232&bt=rd&bcd=press",
  "org:경기도:부천시": "https://www.bucheon.go.kr/site/program/board/basicboard/view?menuid=148002002001&boardtypeid=26748&encid={id}",
};
for (const [org, short] of Object.entries(REVERIFY)) {
  const board = boards.boards[org];
  if (!board?.pattern?.profile || PROFILES.some((spec) => spec.org === org)) continue;
  // 부천시 encid처럼 '='·'+'·'/'가 들어가는 번호도 받는다.
  const link = org.endsWith("부천시") ? "view[^\"']*?[?&](?:amp;)?encid=(?<id>[\\w=+/-]+)" : board.pattern.profile.link;
  PROFILES.push({ org, endpoint: board.endpoint.replace(/;jsessionid=[^?]*/i, ""), basis: "자동 탐색 프로필 재검증(문장부호·엔티티 차이 무시)", link, title: board.pattern.profile.title, urls: [board.pattern.profile.url, short] });
}
const results = [];
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
// --only는 쉼표로 여러 개를 줄 수 있다(목록 주소 일부, 영문).
for (const spec of PROFILES.filter((item) => !only || only.split(",").some((part) => item.endpoint.includes(part)))) {
  const result = await verify(spec);
  results.push({ org: spec.org, endpoint: spec.endpoint, basis: spec.basis, ...result });
  console.log(spec.org, result.status, result.reason, (result.tries ?? []).join(" ; "));
  const previous = boards.boards[spec.org];
  // 일반구처럼 자동 탐색 대상이 아니었던 기관은 앞선 기록 없이 새로 적는다.
  if (write && result.status === "AUTO_VERIFIED") {
    boards.boards[spec.org] = { ...(previous ?? { homepage: new URL(spec.endpoint).origin + "/" }), status: "AUTO_VERIFIED", reason: result.reason, endpoint: spec.endpoint, pattern: { profile: result.profile, basis: spec.basis, method: "SCRIPT_LINK_PROFILE" }, items: result.items, latest: result.latest, previous_status: previous?.status ?? null, previous_reason: previous?.reason ?? null, checked_at: new Date().toISOString() };
  }
}
const asOf = new Date().toISOString().slice(0, 10);
const resultFile = new URL("../../docs/press/discovery/script-profiles-" + asOf + ".json", import.meta.url);
// --only로 일부만 다시 돌리면 같은 날 앞선 결과는 남기고 해당 기관만 바꾼다.
const earlier = only && existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, "utf8")).results.filter((row) => !results.some((fresh) => fresh.org === row.org)) : [];
writeFileSync(resultFile, JSON.stringify({ checked_at: new Date().toISOString(), rule: "자동 탐색과 같은 기준. 주소 틀은 목록 화면 JS 함수 정의에서 사람이 확인", results: [...earlier, ...results] }, null, 1) + "\n");
if (write) writeFileSync(boardsFile, JSON.stringify(boards, null, 2));
console.log("통과 " + results.filter((r) => r.status === "AUTO_VERIFIED").length + "/" + results.length + (write ? " (boards.json 갱신)" : ""));
