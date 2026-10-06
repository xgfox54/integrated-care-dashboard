import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync(new URL('../../docs/press/discovery/manual-profiles-20261006.json', import.meta.url), 'utf8'));
const profile = (id, fields) => ({ ...prior[id].profile, ...fields });
function saeol(host) {
  const action = `https://${host}/emwp/gov/mogaha/ntis/web/ofr/action/OfrAction.do`;
  return {
    endpoint: action + '?jndinm=OfrBcAdvNewsEJB&context=NTIS&method=selectListOfrNews&methodnm=selectListOfrNewsHomepage&news_epct_yn=1&subCheck=Y&ofr_pageSize=10&data_open_yn=1&countYn=Y',
    profile: { link: "searchDetail\\('(?<id>\\d+)'", url: action + '?jndinm=OfrBcAdvNewsEJB&context=NTIS&method=selectOfrNews&methodnm=selectOfrNewsMgt&news_epct_no={id}&news_epct_yn=1&subCheck=Y', title:'text', dateScope:'row' },
    press_confirmed:true,
    basis:'공식 보도자료 iframe의 onload/srchList와 searchDetail 읽기 동작, form의 공개 검색 파라미터를 그대로 사용한다.',
  };
}
export const overrides = {
  'org:경상북도:봉화군': { press_confirmed:true, require_municipal_release:true, basis:'공식 언론보도 게시판의 원문 2건에서 부서 명의 등록·제목의 담당부서·공공누리 공공저작물 표시를 확인했다. 본문 영역의 언론사 크레딧/외부 기사 링크가 없는 군 자체 보도자료이며 본문·등록자 값은 저장하지 않는다.' },
  'org:경상북도:성주군': { profile:profile('org:경상북도:성주군',{url:'https://www.sj.go.kr/page.do?mnu_uid=3546&bod_uid={id}&cmd=258'}), press_confirmed:true, basis:'공식 보도자료 목록 cmd=2 응답의 정상 location.href가 cmd=258 상세로 이동한다.' },
  'org:대구광역시:달서구': { endpoint:'https://www.dalseo.daegu.kr/index.do?menu_id=10000106', profile:{ link:"fn_icms_navi_common\\('view',\\s*'(?<id>\\d+)'", url:'https://www.dalseo.daegu.kr/index.do?menu_id=10000106&menu_link=/icms/bbs/selectBoardArticle.do&bbsId=BBS_00038&nttId={id}', title:'text', date:'data-table-type="date">\\s*([^<]+)', dateScope:'row' }, press_confirmed:true, basis:'공식 보도·해명 자료 BBS_00038. 기존 언론기사 모음 BBS_00121을 제외하고 공식 JS 읽기 action을 연결한다.' },
  'org:부산광역시:강서구': { endpoint:'https://www.bsgangseo.go.kr/portal/board/post/list.do?bcIdx=526&mid=0501050000', profile:{ link:'data-req-get-p-idx="(?<id>\\d+)"', url:'https://www.bsgangseo.go.kr/portal/board/post/view.do?bcIdx=526&mid=0501050000&idx={id}', title:'text', date:'class="list_date">\\s*([^<]+)', dateScope:'row' }, press_confirmed:true, basis:'공식 보도자료 bcIdx=526의 viewForm action 및 목록 게시물 ID.' },
  'org:부산광역시:남구': saeol('eminwon.bsnamgu.go.kr'),
  'org:전남광주통합특별시:남구': { ...saeol('eminwon.namgu.gwangju.kr'), profile:{ ...saeol('eminwon.namgu.gwangju.kr').profile, link:"(?=[\\s\\S]*tabindex=\"4\")searchDetail\\('(?<id>\\d+)'", dateScope:undefined, date:'class="col04">\\s*<a[^>]*>\\s*(20\\d{2}-\\d{2}-\\d{2})' }, basis:'공식 새올 보도자료 공개 조회. 동일 ID의 5개 칸 중 제목 링크(tabindex=4)와 col04 날짜만 수집한다.' },
  'org:전남광주통합특별시:북구': saeol('eminwon.bukgu.gwangju.kr'),
  'org:서울특별시:양천구': { profile:profile('org:서울특별시:양천구',{url:'https://www.yangcheon.go.kr/site/yangcheon/ex/bbs/View.do?cbIdx=290&bcIdx={id}', title:'js-string:wdigm_title', dateScope:'row'}), press_confirmed:true, basis:'공식 보도자료 cbIdx=290. wdigm_title의 문자열 리터럴만 읽고 스크립트는 실행하지 않는다. 세션 없는 원문 주소.' },
  'org:서울특별시:용산구': { profile:profile('org:서울특별시:용산구',{dateScope:'row'}), press_confirmed:true, basis:'공식 보도자료 B0000043. 4000자를 넘는 동일 표 행의 게시일 칸을 읽는다.' },
  'org:서울특별시:종로구': { profile:profile('org:서울특별시:종로구',{date:'class="output date1">\\s*(20\\d{2}년\\d{1,2}월\\d{1,2}일)',dateScope:'row'}), press_confirmed:true, basis:'공식 보도자료 BBSMSTR_000000001618, 등록일 칸의 YYYY년MM월DD일을 해석한다.' },
  'org:전남광주통합특별시:서구': { profile:profile('org:전남광주통합특별시:서구',{title:'text',dateScope:'row'}), press_confirmed:true, basis:'공식 보도자료 bid=0154. 새글 접근성 장식만 제거하고 링크 제목 전체를 읽는다.' },
  'org:충청북도': { profile:profile('org:충청북도',{title:'text',dateScope:'row'}), press_confirmed:true, basis:'공식 보도자료 bbsNo=65의 중첩 span 제목과 게시일 칸.' },
  'org:경상남도': { endpoint:'https://www.gyeongnam.go.kr/board/list.gyeong?boardId=BBS_0000060&menuCd=DOM_000000135002001000&contentsSid=6959', profile:{ link:'view\\.gyeong[^"\']*?dataSid=(?<id>\\d+)', url:'https://www.gyeongnam.go.kr/board/view.gyeong?boardId=BBS_0000060&menuCd=DOM_000000135002001000&dataSid={id}', title:'text',date:'class="date">\\s*([0-9.]+)',dateScope:'row'}, press_confirmed:true, basis:'공식 첫 화면 보도자료 더보기의 BBS_0000060. 날짜 칸의 두 자리 연도만 20yy로 해석한다.' },
  'org:충청북도:영동군': { endpoint:'https://www.yd21.go.kr/kr/html/sub02/02010601.html', profile:{link:'[?&](?:amp;)?no=(?<id>[a-f0-9]+)',url:'https://www.yd21.go.kr/kr/html/sub02/02010601.html?mode=V&no={id}',title:'<h2[^>]*>\\s*([\\s\\S]*?)</h2>',date:'class=["\']date["\']>\\s*([^<]+)'},press_confirmed:true,basis:'공식 군청 첫 화면 군정뉴스 더보기의 헤드라인뉴스. h2 제목과 date만 읽고 요약 본문은 제외한다.' },
};
