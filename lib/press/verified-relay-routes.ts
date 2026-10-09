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
] as const;
