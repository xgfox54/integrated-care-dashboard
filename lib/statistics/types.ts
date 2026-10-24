export type ValueStatus = "VALUE" | "PROVISIONAL" | "ESTIMATE" | "MISSING" | "CONFIDENTIAL";
export interface StatisticsPoint { readonly period: string; readonly value: number | null; readonly raw: string; readonly status: ValueStatus; readonly total_population?: number }
export interface PopulationRegion { readonly code: string; readonly name: string; readonly level: "national" | "sido" | "sigungu"; readonly parent_code: string | null }
export interface PopulationMetadata {
  readonly reference_date: string; readonly age_min: number; readonly age_max: number | null;
  readonly age_label: string; readonly population_scope: string; readonly calculation: string;
  readonly source_urls: readonly { readonly title: string; readonly url: string }[];
}
export interface KosisTableMetadata {
  readonly org_id: string; readonly tbl_id: string; readonly title: string; readonly statistic: string; readonly organization: string;
  readonly url: string; readonly updated_at: string | null; readonly coverage: string | null; readonly checked_at: string; readonly national_only: boolean;
}
export interface KosisMetadata { readonly approved_title: string; readonly indicator_titles: readonly string[]; readonly checked_at: string; readonly tables: readonly KosisTableMetadata[] }
export interface StatisticsSeries { readonly id: string; readonly label: string; readonly source_label: string; readonly unit: string; readonly source_url?: string; readonly points: readonly StatisticsPoint[]; readonly region?: PopulationRegion; readonly kosis_key?: string; readonly unit_source?: "api" | "verified_table" }
export interface IndexTable { readonly table_code: string; readonly table_title: string; readonly original_unit: string; readonly frequency: "Y" | "R" | "U"; readonly source_url: string }
export interface StatisticsSourceReview {
  readonly revision: string;
  readonly status: "SOURCE_YEAR_CORRECTED" | "SOURCE_YEAR_MISMATCH" | "VERIFIED_ADDITIONAL_SOURCE";
  readonly original_source_name: string;
  readonly display_source_name: string;
  readonly source_years: readonly number[];
  readonly latest_observed_year: number;
  readonly warning: string | null;
  readonly reference?: {
    readonly title: string; readonly publisher: string; readonly url: string;
    readonly reference_year: number; readonly published_at: string;
    readonly checked_at: string; readonly content_sha256: string; readonly location: string;
  };
}

export interface StatisticsDataset {
  readonly id: string; readonly indicator_code: string; readonly table_code: string;
  readonly category: string; readonly title: string; readonly description: string; readonly note: string;
  readonly highlight_series_id: string; readonly original_unit: string; readonly table_title: string;
  readonly source_url: string; readonly indicator_url: string; readonly source_name: string; readonly source_notes: string;
  readonly periods: readonly string[]; readonly series: readonly StatisticsSeries[];
  readonly source_review?: StatisticsSourceReview;
  readonly population?: PopulationMetadata;
  readonly kosis?: KosisMetadata;
  readonly index_api?: { readonly updated_at: string; readonly next_update: string; readonly projection: boolean; readonly frequency?: "Y" | "R" | "U"; readonly tables?: readonly IndexTable[] };
  readonly official_report?: { readonly checked_at: string; readonly published_at: string; readonly scope: string };
}
export type StatisticsState = "VERIFIED_SNAPSHOT" | "LIVE" | "CACHED" | "SNAPSHOT_FALLBACK";
export interface StatisticsAutoRefresh {
  readonly enabled: boolean;
  readonly interval_hours: number;
  readonly last_attempt_at: string | null;
  readonly last_success_at: string | null;
  readonly next_check_at: string | null;
  readonly status: "idle" | "checking" | "current" | "retry_wait" | "unavailable";
  readonly error_code: string | null;
  readonly check_due?: boolean;
  readonly overdue_seconds?: number;
  readonly failure_count?: number;
  readonly continuation_pending?: boolean;
}
export interface StatisticsResult {
  readonly dataset: StatisticsDataset; readonly revision: string; readonly verified_at: string;
  readonly checked_at: string; readonly state: StatisticsState; readonly warnings: readonly string[];
  readonly refresh_error: string | null; readonly available_periods: readonly string[];
  readonly coverage: { readonly scope: string; readonly complete: boolean; readonly gaps: readonly string[] };
  readonly auto_refresh?: StatisticsAutoRefresh;
}
export type CatalogKind = "indicator" | "approved" | "portal" | "population" | "kosis";
export interface StatisticsCatalogItem {
  readonly id: string; readonly kind: CatalogKind; readonly title: string; readonly category: string;
  readonly description: string; readonly source_url: string; readonly directory_url: string;
  readonly data_available: boolean; readonly dataset_id: string | null; readonly checked_at: string;
  readonly department?: string; readonly method?: string; readonly publication_schedule?: string;
  readonly data_provider?: "index" | "kosis";
}
