// 관리자 「이용자 통계」 응답 형식(서버·화면 공용 타입).
import type {
  ActionCode,
  EntityKind,
  ErrorCode,
  FilterKind,
  LinkDestination,
  PageCode,
  PerfMetric,
  ScreenType,
  SearchScope,
  TabCode,
  ViewRoute,
} from "./codes";

export const REPORT_VIEWS = ["overview", "visits", "care", "welfare", "search", "tabs", "quality"] as const;
export type ReportView = (typeof REPORT_VIEWS)[number];

/** before: 수집을 처음 켜기 전, off: 수집을 끈 날, partial: 하루 중 일부만 수집, on: 종일 수집. */
export type DayState = "before" | "off" | "partial" | "on";

export interface ReportMeta {
  readonly from: string;
  readonly to: string;
  readonly prevFrom: string;
  readonly prevTo: string;
  readonly today: string;
  readonly includesToday: boolean;
  readonly generatedAt: number;
  readonly lastIngestAt: number | null;
  readonly enabled: boolean;
  readonly killSwitch: boolean;
  readonly dayStates: Readonly<Record<string, DayState>>;
  readonly prevCollected: boolean;
}

export interface OverviewTotals {
  readonly pageViews: number;
  readonly careViews: number;
  readonly welfareViews: number;
  readonly searches: number;
  readonly searchOk: number;
  readonly zeroResults: number;
  readonly activeMs: number;
}

export interface DailyPoint {
  readonly day: string;
  readonly pageViews: number;
  readonly careViews: number;
  readonly welfareViews: number;
  readonly searches: number;
  readonly activeMs: number;
}

export interface EntityRow {
  readonly id: number;
  readonly kind: EntityKind;
  readonly name: string;
  readonly sido: string;
  readonly sigungu: string;
  readonly category: string;
  readonly status: "active" | "inactive";
  readonly views: number;
  readonly searchMatches: number;
  readonly searchOpens: number;
  readonly activeMs: number;
  readonly activeViews: number;
  readonly prevViews: number;
}

export interface ActionRow {
  readonly action: ActionCode;
  readonly start: number;
  readonly success: number;
  readonly failure: number;
  readonly cancel: number;
  readonly click: number;
  readonly msSum: number;
  readonly msCount: number;
}

export interface OverviewReport {
  readonly view: "overview";
  readonly meta: ReportMeta;
  readonly current: OverviewTotals;
  readonly previous: OverviewTotals;
  readonly series: readonly DailyPoint[];
  readonly tabs: readonly { tab: TabCode; views: number; activeMs: number }[];
  readonly topCare: readonly EntityRow[];
  readonly topWelfare: readonly EntityRow[];
  readonly actions: readonly ActionRow[];
}

export type EntitySort = "views" | "searchMatches" | "searchOpens" | "activeMs";

export interface EntityTrendPoint {
  readonly day: string;
  readonly views: number;
  readonly searchMatches: number;
  readonly searchOpens: number;
  readonly activeMs: number;
}

export interface EntityReport {
  readonly view: "care" | "welfare";
  readonly meta: ReportMeta;
  readonly kind: EntityKind;
  readonly rows: readonly EntityRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly sort: EntitySort;
  readonly q: string;
  readonly totals: { readonly views: number; readonly searchMatches: number; readonly searchOpens: number; readonly activeMs: number; readonly activeViews: number };
  readonly durations: readonly number[];
  readonly routes: readonly { route: ViewRoute; views: number }[];
  readonly trend: { readonly entity: EntityRow; readonly series: readonly EntityTrendPoint[] } | null;
}

export interface SearchTotals {
  readonly searches: number;
  readonly ok: number;
  readonly errors: number;
  readonly zero: number;
  readonly converted: number;
  readonly matched: number;
  readonly ambiguous: number;
  readonly unmatched: number;
}

export interface SearchReport {
  readonly view: "search";
  readonly meta: ReportMeta;
  readonly current: SearchTotals;
  readonly previous: SearchTotals;
  readonly byScope: readonly ({ scope: SearchScope } & SearchTotals)[];
  readonly byResults: readonly { results: string; searches: number }[];
  readonly topMatched: readonly EntityRow[];
  readonly topOpened: readonly EntityRow[];
  readonly filters: readonly { filter: FilterKind; code: string; uses: number }[];
}

export interface TabsReport {
  readonly view: "tabs";
  readonly meta: ReportMeta;
  readonly tabs: readonly { tab: TabCode; initialViews: number; selectedViews: number; activeMs: number; measures: number; prevViews: number }[];
  readonly durations: Readonly<Record<string, readonly number[]>>;
  readonly pages: readonly { page: PageCode; views: number }[];
  readonly actions: readonly ActionRow[];
  readonly sources: readonly { dest: LinkDestination; clicks: number }[];
}

export interface PerfRow {
  readonly metric: PerfMetric;
  readonly page: PageCode | "";
  readonly count: number;
  readonly sum: number;
  readonly buckets: readonly number[];
}

export interface QualityReport {
  readonly view: "quality";
  readonly meta: ReportMeta;
  readonly actions: readonly ActionRow[];
  readonly searches: readonly { scope: SearchScope; ok: number; errors: number }[];
  readonly errors: readonly { op: string; code: ErrorCode; count: number }[];
  readonly perf: readonly PerfRow[];
  readonly screens: readonly { screen: ScreenType; views: number }[];
  readonly operation: {
    readonly periods: readonly { startedAt: number; endedAt: number | null }[];
    readonly cleanup: { at: number; ok: boolean; tempDeleted: number; aggregateDeleted: number } | null;
    readonly tempRows: number;
  };
}

export interface VisitsReport {
  readonly view: "visits";
  readonly meta: ReportMeta;
  readonly total: number;
  readonly since: string | null;
  readonly current: number;
  readonly previous: number;
  readonly before: number;
  readonly throughEnd: number;
  readonly series: readonly { readonly day: string; readonly visits: number; readonly cumulative: number }[];
  readonly entries: readonly { readonly tab: TabCode; readonly visits: number }[];
}

export type UsageReport = OverviewReport | VisitsReport | EntityReport | SearchReport | TabsReport | QualityReport;

