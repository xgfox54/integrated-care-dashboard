// 이용통계 코드의 한국어 이름(관리자 화면·CSV 전용). 공개 화면 번들에 들어가지 않도록 codes.ts와 나눴다.
import type {
  PageCode,
  TabCode,
  EntityKind,
  ViewRoute,
  SearchScope,
  MatchState,
  FilterKind,
  ActionCode,
  LinkDestination,
  PerfMetric,
  ErrorOp,
  ErrorCode,
  ScreenType,
} from "./codes.ts";
import { CATEGORY_LABELS, ORG_TYPE_LABELS } from "../press/dictionary.ts";

export const PAGE_LABELS: Record<PageCode, string> = {
  dashboard: "대시보드",
  wiki: "통합돌봄 WIKI",
  welfare_list: "복지제도100 목록",
  welfare_detail: "복지제도100 상세",
  mindmap: "복지정보 관계성 지도",
  news: "복지뉴스",
  budget: "복지예산",
  law: "법령정보",
  sources: "데이터 출처",
  usage_policy: "이용통계 안내",
};

export const TAB_LABELS: Record<TabCode, string> = {
  dashboard_search: "대시보드 · 검색 결과",
  dashboard_compare: "대시보드 · 지자체 비교",
  wiki: "통합돌봄 WIKI",
  welfare100: "복지제도100",
  mindmap: "복지정보 관계성 지도",
  news: "복지뉴스",
  budget: "복지예산",
  law: "법령정보",
  sources: "데이터 출처",
  usage_policy: "이용통계 안내",
};

export const ENTITY_LABELS: Record<EntityKind, string> = {
  care_program: "통합돌봄사업",
  welfare_policy: "복지제도",
};

export const ROUTE_LABELS: Record<ViewRoute, string> = {
  search: "검색 결과에서",
  list: "목록·지도에서",
  compare: "비교 화면에서",
  direct: "주소 직접 진입",
};

export const SEARCH_SCOPE_LABELS: Record<SearchScope, string> = {
  care_dashboard: "대시보드 통합검색",
  care_wiki: "WIKI 사업 검색",
  welfare_catalog: "복지제도100 검색",
  mindmap_node: "복지정보 관계성 지도 검색",
  press_news: "복지뉴스 제목 검색",
  budget_project: "복지예산 세부사업명 검색",
};

export const MATCH_LABELS: Record<MatchState, string> = {
  matched: "명칭 일치(대상 확인)",
  ambiguous: "여러 대상과 일치",
  unmatched: "명칭 불일치",
};

export const FILTER_LABELS: Record<FilterKind, string> = {
  care_region: "통합돌봄 조회 대상 지역",
  care_category: "통합돌봄 사업 분류",
  welfare_region: "복지제도 조회 대상 지역",
  welfare_topic: "복지제도 분야",
  welfare_scope: "복지제도 구분",
  welfare_lifecycle: "복지제도 생애주기",
  welfare_household: "복지제도 가구상황",
  welfare_provision: "복지제도 제공유형",
  mindmap_branch: "복지정보 관계성 지도 가지",
  news_category: "복지뉴스 분야",
  news_org_type: "복지뉴스 기관 유형",
  news_region: "복지뉴스 조회 지역",
  budget_field: "복지예산 분야",
  budget_region: "복지예산 조회 지역",
};

const MINDMAP_BRANCH_LABELS: Readonly<Record<string, string>> = {
  target: "대상자", service: "복지서비스", region: "지역", welfare: "복지제도", budget: "복지예산", news: "복지뉴스", advanced: "고급 탐색",
  svc: "통합돌봄 사업(이전 가지)", w100: "복지제도100(이전 가지)", fiscal: "복지예산(이전 가지)", onto: "구조(이전 가지)",
};
const BUDGET_FIELD_LABELS: Readonly<Record<string, string>> = { social_welfare: "사회복지", integrated_care: "통합돌봄", health: "보건" };

/** 고른 조건 코드를 사람이 읽는 이름으로(분야·기관 유형·가지 코드). 지역·분류 이름은 그대로 둔다. */
export function filterCodeLabel(filter: FilterKind, code: string): string {
  const table = filter === "news_category" ? CATEGORY_LABELS : filter === "news_org_type" ? ORG_TYPE_LABELS : filter === "mindmap_branch" ? MINDMAP_BRANCH_LABELS : filter === "budget_field" ? BUDGET_FIELD_LABELS : null;
  return table?.[code] ?? code.replace("|", " ");
}

/** 지역을 고른 조건(이용자 위치가 아니라 화면에서 고른 콘텐츠 지역). */
export const REGION_FILTERS: readonly FilterKind[] = ["care_region", "welfare_region", "news_region", "budget_region"];

export const ACTION_LABELS: Record<ActionCode, string> = {
  care_compare: "지자체 비교",
  welfare_compare: "복지제도 비교",
  care_csv: "검색결과 CSV 생성",
  care_share: "검색조건 주소 복사",
  wiki_welfare100: "WIKI → 복지제도100 바로가기",
  mindmap_select: "복지정보 관계성 지도 항목 선택",
  news_original: "복지뉴스 원문 보기",
  budget_query: "복지예산 조회",
  source_link: "출처 링크 클릭",
};

export const DESTINATION_LABELS: Record<LinkDestination, string> = {
  mohw: "보건복지부",
  bokjiro: "복지로",
  law: "국가법령정보센터",
  data_portal: "공공데이터포털",
  gov: "기타 공공기관",
  other: "기타 사이트",
};

export const PERF_LABELS: Record<PerfMetric, string> = {
  search_care: "대시보드 검색 응답",
  search_wiki: "WIKI 검색 응답",
  care_detail: "WIKI 사업 상세 불러오기",
  welfare_catalog: "복지제도 목록 불러오기",
  welfare_detail: "복지제도 상세 불러오기",
  compare_data: "지자체 비교 자료 불러오기",
  csv: "CSV 생성",
  lcp: "가장 큰 콘텐츠 표시(LCP)",
  cls: "누적 레이아웃 이동(CLS)",
};

export const MS_BUCKET_LABELS = ["0.2초 미만", "0.2~0.5초", "0.5~1초", "1~2.5초", "2.5~5초", "5초 이상"] as const;

export const CLS_BUCKET_LABELS = ["0.1 미만(좋음)", "0.1~0.25(개선 필요)", "0.25 이상(나쁨)"] as const;

export const ERROR_OP_LABELS: Record<ErrorOp, string> = {
  care_summary: "대시보드 요약 불러오기",
  care_list: "대시보드 사업 목록 불러오기",
  care_detail: "WIKI 사업 상세 불러오기",
  wiki_catalog: "WIKI 사업 목록 불러오기",
  welfare_catalog: "복지제도 목록 불러오기",
  welfare_detail: "복지제도 상세 불러오기",
  care_compare: "지자체 비교",
  care_csv: "검색결과 CSV 생성",
  care_share: "검색조건 주소 복사",
  mindmap_data: "복지정보 관계성 지도 자료 불러오기",
  press_list: "복지뉴스 목록 불러오기",
  budget_list: "복지예산 결과 불러오기",
};

export const ERROR_CODE_LABELS: Record<ErrorCode, string> = {
  network: "네트워크 연결 실패",
  timeout: "응답 시간 초과",
  http_4xx: "요청 오류(4xx)",
  http_5xx: "서버 오류(5xx)",
  not_found: "대상 없음",
  parse: "응답 해석 실패",
  unsupported: "브라우저 미지원",
  unknown: "분류되지 않은 오류",
};

export const SCREEN_LABELS: Record<ScreenType, string> = {
  mobile: "좁은 화면(768px 미만)",
  tablet: "중간 화면(768~1199px)",
  desktop: "넓은 화면(1200px 이상)",
};

export const DURATION_LABELS = ["30초 미만", "30초~2분", "2~5분", "5분 이상"] as const;
