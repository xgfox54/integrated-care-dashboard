import { EMPTY_FILTERS, type FilterState } from "./dataset.ts";
import { isSearchSort } from "./search-terms.ts";

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
] as const satisfies readonly QueryField[];

const CSV_FILTER_FIELDS = [
  ["sido", "sido"],
  ["sigungu", "sigungu"],
  ["category", "category"],
  ["subcategory", "subcategory"],
  ["type", "type"],
  ["keyword", "q"],
  ["sort", "sort"],
] as const satisfies readonly QueryField[];

export function readDashboardFilters(search: string): FilterState {
  const params = new URLSearchParams(search);
  const filters: FilterState = { ...EMPTY_FILTERS };
  for (const [field, queryKey] of LEGACY_FILTER_FIELDS) {
    filters[field] = params.get(queryKey) ?? "";
  }
  const sort = params.get("sort");
  if (isSearchSort(sort)) filters.sort = sort;
  return filters;
}

export function dashboardPagePath(pathname: string, filters: FilterState, hash = ""): string {
  const params = new URLSearchParams();
  for (const [field, queryKey] of PAGE_FILTER_FIELDS) {
    if (filters[field]) params.set(queryKey, filters[field]);
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
    if (filters[field]) params.set(queryKey, filters[field]);
  }
  return `/api/dataset/export?${params.toString()}`;
}
