// 이용통계 공통 코드표. 브라우저(수집)와 서버(검증·집계·관리자 화면)가 같은 표를 쓴다.
// 여기에 없는 코드는 서버가 거절한다. 자유 입력 문자열(검색어, 주소, 오류 원문)은 어느 이벤트에도 없다.

export const USAGE_SCHEMA_VERSION = 1;
/** 이용통계 안내의 판. 수집 범위나 방식이 바뀌면 올린다. 서버는 현재 판으로 보낸 요청만 받는다. */
export const USAGE_POLICY_VERSION = "2026-10-06";

export const PAGE_CODES = ["dashboard", "wiki", "welfare_list", "welfare_detail", "mindmap", "news", "budget", "law", "sources", "usage_policy"] as const;
export type PageCode = (typeof PAGE_CODES)[number];

/** 탭: 상단 메뉴 화면(메뉴 순서)과 대시보드 안의 검색 결과·지자체 비교 탭. */
export const TAB_CODES = [
  "dashboard_search",
  "dashboard_compare",
  "wiki",
  "welfare100",
  "mindmap",
  "news",
  "budget",
  "law",
  "sources",
  "usage_policy",
] as const;
export type TabCode = (typeof TAB_CODES)[number];

/** initial: 주소 입력·새로고침·외부 링크로 처음 표시된 탭, selected: 이용자가 메뉴나 탭을 눌러 고른 탭. */
export const TAB_ENTRIES = ["initial", "selected"] as const;
export type TabEntry = (typeof TAB_ENTRIES)[number];

export const ENTITY_KINDS = ["care_program", "welfare_policy"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** 상세를 연 경로. */
export const VIEW_ROUTES = ["search", "list", "compare", "direct"] as const;
export type ViewRoute = (typeof VIEW_ROUTES)[number];

export const SEARCH_SCOPES = ["care_dashboard", "care_wiki", "welfare_catalog", "mindmap_node", "press_news", "budget_project"] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];
/** 검색어를 등록된 사업·제도 이름과 대조하는 범위. null이면 대조하지 않는다(마인드맵 마디·보도자료 제목·예산 세부사업명). */
export const SEARCH_SCOPE_KIND: Record<SearchScope, EntityKind | null> = {
  care_dashboard: "care_program",
  care_wiki: "care_program",
  welfare_catalog: "welfare_policy",
  mindmap_node: null,
  press_news: null,
  budget_project: null,
};

export const SEARCH_STATUSES = ["ok", "error"] as const;
export type SearchStatus = (typeof SEARCH_STATUSES)[number];

export const RESULT_BUCKETS = ["0", "1", "2-10", "11-50", "51-200", "201+"] as const;
export type ResultBucket = (typeof RESULT_BUCKETS)[number];

export const MATCH_STATES = ["matched", "ambiguous", "unmatched"] as const;
export type MatchState = (typeof MATCH_STATES)[number];

export const FILTER_KINDS = [
  "care_region",
  "care_category",
  "welfare_region",
  "welfare_topic",
  "welfare_scope",
  "welfare_lifecycle",
  "welfare_household",
  "welfare_provision",
  "mindmap_branch",
  "news_category",
  "news_org_type",
  "news_region",
  "budget_field",
  "budget_region",
] as const;
export type FilterKind = (typeof FILTER_KINDS)[number];

export const ACTION_CODES = [
  "care_compare",
  "welfare_compare",
  "care_csv",
  "care_share",
  "wiki_welfare100",
  "mindmap_select",
  "news_original",
  "budget_query",
  "source_link",
] as const;
export type ActionCode = (typeof ACTION_CODES)[number];
/** 시작·끝을 따로 세는 기능. */
export const STAGED_ACTIONS: readonly ActionCode[] = ["care_compare", "welfare_compare", "care_csv", "care_share"];
/** 클릭만 세는 기능. 출처 링크만 연결 기관(dest)을 함께 받는다. */
export const CLICK_ACTIONS: readonly ActionCode[] = ["wiki_welfare100", "mindmap_select", "news_original", "budget_query", "source_link"];

export const ACTION_OUTCOMES = ["start", "success", "failure", "cancel", "click"] as const;
export type ActionOutcome = (typeof ACTION_OUTCOMES)[number];

export const LINK_DESTINATIONS = ["mohw", "bokjiro", "law", "data_portal", "gov", "other"] as const;
export type LinkDestination = (typeof LINK_DESTINATIONS)[number];

export const PERF_METRICS = [
  "search_care",
  "search_wiki",
  "care_detail",
  "welfare_catalog",
  "welfare_detail",
  "compare_data",
  "csv",
  "lcp",
  "cls",
] as const;
export type PerfMetric = (typeof PERF_METRICS)[number];
/** 밀리초 지표의 구간 경계. CLS는 1000배한 정수로 받는다. */
export const MS_BUCKET_EDGES = [200, 500, 1000, 2500, 5000] as const;
export const CLS_BUCKET_EDGES = [100, 250] as const;

export const ERROR_OPS = [
  "care_summary",
  "care_list",
  "care_detail",
  "wiki_catalog",
  "welfare_catalog",
  "welfare_detail",
  "care_compare",
  "care_csv",
  "care_share",
  "mindmap_data",
  "press_list",
  "budget_list",
] as const;
export type ErrorOp = (typeof ERROR_OPS)[number];
export const ERROR_CODES = ["network", "timeout", "http_4xx", "http_5xx", "not_found", "parse", "unsupported", "unknown"] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** 화면 폭으로 나눈 화면 유형. 실제 기종을 뜻하지 않는다. */
export const SCREEN_TYPES = ["mobile", "tablet", "desktop"] as const;
export type ScreenType = (typeof SCREEN_TYPES)[number];

/** 활동시간 구간(0~30초 미만 / 30초~2분 미만 / 2~5분 미만 / 5분 이상). */
export const DURATION_EDGES_MS = [30_000, 120_000, 300_000] as const;

// ---- 설계 기준값(법정 기준이 아니다) ----
/** 마지막 상호작용 뒤 이 시간이 지나면 활동시간을 더하지 않는다. */
export const IDLE_LIMIT_MS = 60_000;
/** 이벤트를 모아 보내는 주기와 한 번에 보내는 상한. */
export const FLUSH_INTERVAL_MS = 15_000;
export const MAX_EVENTS_PER_REQUEST = 20;
export const MAX_REQUEST_BYTES = 16 * 1024;
/** 검색어가 이만큼 바뀌지 않고 결과가 확정되면 검색 1회로 센다. */
export const SEARCH_SETTLE_MS = 800;
/** 단기 처리 상태(중복 방지 ID, 임시 검색·측정·작업 상태)의 보관 상한. 매시 정리하므로 24시간 안에 지워진다. */
export const TEMP_STATE_TTL_MS = 23 * 60 * 60 * 1000;
/** 일별 집계 보관기간(24개월). */
export const AGGREGATE_RETENTION_DAYS = 731;
/** 측정 하나의 누적 활동시간 상한과 첫 보고 상한. */
export const MAX_MEASURE_MS = 4 * 60 * 60 * 1000;
export const MAX_FIRST_REPORT_MS = 180_000;
/** 누적값 증가가 서버 경과시간보다 이만큼까지는 커도 받는다(전송 지연 여유). */
export const ACTIVITY_SLACK_MS = 30_000;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 한국시간 날짜(YYYY-MM-DD). */
export function kstDay(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 한국시간 자정부터 지난 밀리초. */
export function msSinceKstMidnight(ms: number): number {
  return (ms + KST_OFFSET_MS) % DAY_MS;
}

export function shiftDay(day: string, days: number): string {
  const base = Date.parse(day + "T00:00:00Z");
  return new Date(base + days * DAY_MS).toISOString().slice(0, 10);
}

export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY_MS);
}

export function resultBucket(count: number): ResultBucket {
  if (count <= 0) return "0";
  if (count === 1) return "1";
  if (count <= 10) return "2-10";
  if (count <= 50) return "11-50";
  if (count <= 200) return "51-200";
  return "201+";
}

export function durationBucket(ms: number): number {
  let bucket = 0;
  for (const edge of DURATION_EDGES_MS) if (ms >= edge) bucket += 1;
  return bucket;
}

export function perfBucket(metric: PerfMetric, value: number): number {
  const edges: readonly number[] = metric === "cls" ? CLS_BUCKET_EDGES : MS_BUCKET_EDGES;
  let bucket = 0;
  for (const edge of edges) if (value >= edge) bucket += 1;
  return bucket;
}

/** SQL에서 쓰는 활동시간 구간식. durationBucket과 같은 경계다. */
export function durationBucketSql(column: string): string {
  const [a, b, c] = DURATION_EDGES_MS;
  return "(CASE WHEN " + column + " < " + a + " THEN 0 WHEN " + column + " < " + b + " THEN 1 WHEN " + column + " < " + c + " THEN 2 ELSE 3 END)";
}

/**
 * 명칭 대조용 정규화: 유니코드 NFKC, 소문자, 공백 제거. 대시보드 검색의 공백 무시 규칙과 같다.
 * 결과는 브라우저 메모리와 서버 검색 처리 안에서만 쓰고 통계로 보내지 않는다.
 */
export function normalizeName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

export function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** 브라우저가 만드는 임시 ID 형식(16바이트 무작위 값의 base64url, 22자). */
export const TEMP_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
