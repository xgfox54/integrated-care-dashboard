// 관리자 통계 CSV. 화면과 같은 집계값만 담고, 임시 ID·원시 이벤트는 담지 않는다.
// 셀이 =, +, -, @, 탭, 줄바꿈으로 시작하면 앞에 작은따옴표를 붙여 스프레드시트 수식으로 실행되지 않게 한다.
import {
  ACTION_LABELS,
  CLS_BUCKET_LABELS,
  DESTINATION_LABELS,
  DURATION_LABELS,
  ENTITY_LABELS,
  ERROR_CODE_LABELS,
  ERROR_OP_LABELS,
  FILTER_LABELS,
  MS_BUCKET_LABELS,
  PAGE_LABELS,
  PERF_LABELS,
  ROUTE_LABELS,
  SCREEN_LABELS,
  SEARCH_SCOPE_LABELS,
  TAB_LABELS,
} from "./labels.ts";
import type { DayState, EntityRow, SearchTotals, UsageReport } from "./report-types";

type Cell = string | number | null;

export function csvCell(value: Cell): string {
  if (value === null) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r\n]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function table(title: string, header: string[], rows: Cell[][]): string[] {
  return [csvCell(title), header.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(",")), ""];
}

const STATE_LABELS: Record<DayState, string> = { before: "수집 전", off: "수집 중지", partial: "일부 수집", on: "수집" };
const seconds = (ms: number) => Math.round(ms / 1000);
const ratio = (part: number, whole: number): Cell => (whole > 0 ? Number(((part / whole) * 100).toFixed(1)) : null);

function entityRows(rows: readonly EntityRow[]): Cell[][] {
  return rows.map((row) => [
    row.name,
    ENTITY_LABELS[row.kind],
    [row.sido, row.sigungu].filter(Boolean).join(" "),
    row.category,
    row.status === "active" ? "현재 목록" : "현재 목록에 없음",
    row.views,
    row.searchMatches,
    row.searchOpens,
    seconds(row.activeMs),
    row.activeViews > 0 ? Math.round(row.activeMs / row.activeViews / 1000) : null,
    row.prevViews,
  ]);
}

const ENTITY_HEADER = [
  "이름",
  "구분",
  "대상 지역",
  "분류",
  "상태",
  "전체 상세 조회수",
  "명칭·별칭 검색 횟수",
  "검색 경유 상세 열람",
  "총 측정 활동시간(초)",
  "열람당 평균 활동시간(초)",
  "직전 기간 상세 조회수",
];

function searchRow(label: string, totals: SearchTotals): Cell[] {
  return [
    label,
    totals.searches,
    totals.ok,
    totals.errors,
    totals.zero,
    ratio(totals.zero, totals.ok),
    totals.converted,
    ratio(totals.converted, totals.ok),
    totals.matched,
    totals.ambiguous,
    totals.unmatched,
    ratio(totals.matched, totals.ok),
  ];
}

export function reportToCsv(report: UsageReport): string {
  const { meta } = report;
  const lines: string[] = [
    csvCell("전국 통합돌봄 대시보드 이용자 통계(한국시간 기준)"),
    ["기간", meta.from + " ~ " + meta.to, "비교 기간", meta.prevFrom + " ~ " + meta.prevTo].map(csvCell).join(","),
    csvCell("정상 전송된 이용을 기준으로 하며, 추적 거부 신호를 보내거나 통계에서 빼기를 고른 브라우저, 자동화 도구, 관리자 이용, 전송 실패는 빠져 전체 이용과 차이가 있을 수 있습니다. 조회수는 사람 수가 아닙니다."),
    "",
  ];
  switch (report.view) {
    case "visits":
      lines.push(
        ...table("방문 집계", ["전체 누적 방문 수", "집계 시작일", "선택 기간 방문 수", "직전 기간 방문 수", "기간 시작 전 누적", "기간 종료일 누적"],
          [[report.total, report.since, report.current, report.previous, report.before, report.throughEnd]]),
        ...table("일별 방문 내역", ["날짜", "수집 상태", "방문 수", "해당 일까지 누적 방문 수"],
          report.series.map(row => [row.day, STATE_LABELS[meta.dayStates[row.day] ?? "before"], row.visits, row.cumulative])),
        ...table("처음 진입한 메뉴", ["메뉴", "방문 수"], report.entries.map(row => [TAB_LABELS[row.tab], row.visits])),
      );
      break;
    case "overview":
      lines.push(
        ...table(
          "일별 추이",
          ["날짜", "수집 상태", "페이지 조회", "통합돌봄사업 상세 조회", "복지제도 상세 조회", "검색 실행", "측정 활동시간(초)"],
          report.series.map((point) => [
            point.day,
            STATE_LABELS[meta.dayStates[point.day] ?? "before"],
            point.pageViews,
            point.careViews,
            point.welfareViews,
            point.searches,
            seconds(point.activeMs),
          ]),
        ),
        ...table("많이 조회된 통합돌봄사업", ENTITY_HEADER, entityRows(report.topCare)),
        ...table("많이 조회된 복지제도", ENTITY_HEADER, entityRows(report.topWelfare)),
      );
      break;
    case "care":
    case "welfare":
      lines.push(...table(ENTITY_LABELS[report.kind] + " 목록", ENTITY_HEADER, entityRows(report.rows)));
      lines.push(
        ...table(
          "측정 활동시간 구간 분포(측정 수)",
          [...DURATION_LABELS],
          [[...report.durations]],
        ),
        ...table(
          "상세 진입 경로",
          ["경로", "상세 조회수"],
          report.routes.map((row) => [ROUTE_LABELS[row.route] ?? row.route, row.views]),
        ),
      );
      break;
    case "search":
      lines.push(
        ...table(
          "검색 범위별",
          ["검색 범위", "검색 실행", "정상 완료", "실패", "결과 0건", "무결과율(%)", "상세 열람 전환 검색", "전환율(%)", "명칭 일치", "여러 대상 일치", "불일치", "매칭률(%)"],
          [searchRow("전체", report.current), ...report.byScope.map((row) => searchRow(SEARCH_SCOPE_LABELS[row.scope], row))],
        ),
        ...table("검색 대상으로 확인된 사업·제도", ENTITY_HEADER, entityRows(report.topMatched)),
        ...table("검색 후 실제 열람한 사업·제도", ENTITY_HEADER, entityRows(report.topOpened)),
        ...table(
          "조회 대상 지역·분류 선택",
          ["구분", "코드", "선택 횟수"],
          report.filters.map((row) => [FILTER_LABELS[row.filter] ?? row.filter, row.code, row.uses]),
        ),
      );
      break;
    case "tabs":
      lines.push(
        ...table(
          "탭",
          ["탭", "처음 표시", "직접 선택", "열람 합계", "직전 기간 열람", "총 측정 활동시간(초)", "열람당 평균(초)", ...DURATION_LABELS.map((label) => "활동시간 " + label)],
          report.tabs.map((row) => {
            const views = row.initialViews + row.selectedViews;
            return [
              TAB_LABELS[row.tab],
              row.initialViews,
              row.selectedViews,
              views,
              row.prevViews,
              seconds(row.activeMs),
              views > 0 ? Math.round(row.activeMs / views / 1000) : null,
              ...(report.durations[row.tab] ?? []),
            ];
          }),
        ),
        ...table("페이지", ["페이지", "조회"], report.pages.map((row) => [PAGE_LABELS[row.page] ?? row.page, row.views])),
        ...table(
          "기능",
          ["기능", "실행", "성공", "실패", "취소", "미완료", "클릭", "평균 응답(ms)"],
          report.actions.map((row) => [
            ACTION_LABELS[row.action],
            row.start,
            row.success,
            row.failure,
            row.cancel,
            Math.max(0, row.start - row.success - row.failure - row.cancel),
            row.click,
            row.msCount > 0 ? Math.round(row.msSum / row.msCount) : null,
          ]),
        ),
        ...table("출처 링크 클릭", ["기관", "클릭"], report.sources.map((row) => [DESTINATION_LABELS[row.dest] ?? row.dest, row.clicks])),
      );
      break;
    case "quality":
      lines.push(
        ...table(
          "기능별 오류율",
          ["기능", "성공", "실패", "취소", "오류율(%)"],
          [
            ...report.actions.map((row) => [ACTION_LABELS[row.action], row.success, row.failure, row.cancel, ratio(row.failure, row.success + row.failure)]),
            ...report.searches.map((row) => [SEARCH_SCOPE_LABELS[row.scope], row.ok, row.errors, null, ratio(row.errors, row.ok + row.errors)]),
          ],
        ),
        ...table(
          "오류 코드",
          ["기능", "오류 코드", "건수"],
          report.errors.map((row) => [
            ERROR_OP_LABELS[row.op as keyof typeof ERROR_OP_LABELS] ?? ACTION_LABELS[row.op as keyof typeof ACTION_LABELS] ?? row.op,
            ERROR_CODE_LABELS[row.code] ?? row.code,
            row.count,
          ]),
        ),
        ...table(
          "응답시간·화면 표시 속도",
          ["지표", "페이지", "표본", "평균", ...MS_BUCKET_LABELS.map((label) => "구간 " + label)],
          report.perf.map((row) => [
            PERF_LABELS[row.metric],
            row.page ? PAGE_LABELS[row.page] : "",
            row.count,
            row.count > 0 ? (row.metric === "cls" ? Number((row.sum / row.count / 1000).toFixed(3)) : Math.round(row.sum / row.count)) : null,
            ...(row.metric === "cls" ? row.buckets.map((count, index) => CLS_BUCKET_LABELS[index] + " " + count) : row.buckets),
          ]),
        ),
        ...table("화면 유형(폭 기준 추정)", ["화면 유형", "페이지 조회"], report.screens.map((row) => [SCREEN_LABELS[row.screen] ?? row.screen, row.views])),
      );
      break;
  }
  return "\uFEFF" + lines.join("\r\n");
}
