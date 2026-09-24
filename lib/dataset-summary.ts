import { SERVICE_CATEGORY_ORDER, type ServiceRow, sortedUnique } from "./dataset.ts";

export const SEARCH_PAGE_SIZES = [20, 30, 50, 100] as const;
export const DEFAULT_SEARCH_PAGE_SIZE = 30;

export interface DatasetSummary {
  readonly totalCount: number;
  readonly sidoCount: number;
  readonly sigunguCount: number;
  readonly categoryCount: number;
  readonly regionCounts: Readonly<Record<string, number>>;
  readonly categoryCounts: Readonly<Record<string, number>>;
  readonly sigunguBySido: Readonly<Record<string, readonly string[]>>;
  readonly categories: readonly string[];
}
type SummaryRow = Pick<ServiceRow, "sido" | "sigungu" | "category" | "name">;

function increment(counts: Record<string, number>, key: string): void {
  if (!key) return;
  counts[key] = (counts[key] ?? 0) + 1;
}

export function orderServiceCategories(values: readonly string[]): readonly string[] {
  const categories = sortedUnique(values);
  return [
    ...SERVICE_CATEGORY_ORDER.filter((category) => categories.includes(category)),
    ...categories.filter(
      (category) => !SERVICE_CATEGORY_ORDER.includes(category as (typeof SERVICE_CATEGORY_ORDER)[number]),
    ),
  ];
}

export function buildDatasetSummary(rows: readonly SummaryRow[]): DatasetSummary {
  const regionCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  const municipalities = new Set<string>();
  const sigunguSets = new Map<string, Set<string>>();

  for (const row of rows) {
    increment(regionCounts, row.sido);
    increment(categoryCounts, row.category);
    if (row.sido && row.sigungu) {
      municipalities.add(`${row.sido}|${row.sigungu}`);
      const values = sigunguSets.get(row.sido) ?? new Set<string>();
      values.add(row.sigungu);
      sigunguSets.set(row.sido, values);
    }
  }

  const categories = orderServiceCategories(Object.keys(categoryCounts));
  const sigunguBySido = Object.fromEntries(
    [...sigunguSets].sort(([left], [right]) => left.localeCompare(right, "ko")).map(
      ([sido, values]) => [sido, sortedUnique([...values])],
    ),
  );

  return {
    totalCount: rows.length,
    sidoCount: Object.keys(regionCounts).length,
    sigunguCount: municipalities.size,
    categoryCount: Object.keys(categoryCounts).length,
    regionCounts,
    categoryCounts,
    sigunguBySido,
    categories,
  };
}

export function normalizeSearchPageSize(value: number | undefined): number {
  return SEARCH_PAGE_SIZES.includes(value as (typeof SEARCH_PAGE_SIZES)[number])
    ? (value as (typeof SEARCH_PAGE_SIZES)[number])
    : DEFAULT_SEARCH_PAGE_SIZE;
}

export function paginateRows<T>(rows: readonly T[], requestedPage: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    totalCount: rows.length,
    page,
    pageSize,
    pageCount,
  };
}
