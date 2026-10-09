import { EMPTY_FILTERS, type FilterState } from "./dataset.ts";
import { isSearchSort } from "./search-terms.ts";
import { parseTargetGroup } from "./target-groups.ts";

type QueryField = readonly [keyof FilterState, string];

const LEGACY_FILTER_FIELDS = [
  ["sido", "sido"],
  ["sigungu", "sigungu"],
  ["category", "category"],
  ["subcategory", "subcategory"],
  ["type", "type"],
  ["keyword", "q"],
] as const satisfies readonly QueryField[];

const PAGE_FILTER_FIELDS = [
  ["sido", "sido"],
  ["sigungu", "sigungu"],
  ["category", "category"],
  ["subcategory", "subcategory"],
  ["type", "type"],
  ["sort", "sort"],
  ["targetGroup", "target_group"],
] as const satisfies readonly QueryField[];

const CSV_FILTER_FIELDS = [
  ["sido", "sido"],
  ["sigungu", "sigungu"],
  ["category", "category"],
  ["subcategory", "subcategory"],
  ["type", "type"],
  ["keyword", "q"],
  ["sort", "sort"],
  ["targetGroup", "target_group"],
] as const satisfies readonly QueryField[];

export function readDashboardFilters(search: string): FilterState {
  const params = new URLSearchParams(search);
  const filters: FilterState = { ...EMPTY_FILTERS };
  for (const [field, queryKey] of LEGACY_FILTER_FIELDS) {
    filters[field] = params.get(queryKey) ?? "";
  }
  const sort = params.get("sort");
  if (isSearchSort(sort)) filters.sort = sort;
  // 대상자 묶음: 알 수 없는 값은 화면 필터로 쓰지 않는다(검색 API도 거절한다).
  const targetGroup = parseTargetGroup(params.get("target_group") ?? "");
  if (targetGroup) filters.targetGroup = targetGroup;
  return filters;
}

export function dashboardPagePath(pathname: string, filters: FilterState, hash = ""): string {
  const params = new URLSearchParams();
  for (const [field, queryKey] of PAGE_FILTER_FIELDS) {
    const value = filters[field];
    if (value) params.set(queryKey, value);
  }
  const query = params.toString();
  const anchor = hash === "#search-results" ? hash : "";
  return (query ? `${pathname}?${query}` : pathname) + anchor;
}

export function dashboardShareUrl(origin: string, pathname: string, filters: FilterState, hash = ""): string {
  return new URL(dashboardPagePath(pathname, filters, hash), origin).toString();
}

export function dashboardCsvUrl(filters: FilterState): string {
  const params = new URLSearchParams();
  for (const [field, queryKey] of CSV_FILTER_FIELDS) {
    const value = filters[field];
    if (value) params.set(queryKey, value);
  }
  return `/api/dataset/export?${params.toString()}`;
}
