import { z } from "zod";

import { EMPTY_FILTERS, SERVICE_CATEGORY_ORDER, type FilterState } from "./dataset.ts";
import { REGION_DEFINITIONS } from "./region-statistics.ts";
import { isSearchSort } from "./search-terms.ts";

const FILTER_KEYS = ["sido", "sigungu", "category", "subcategory", "type", "q", "sort"] as const;
const SEARCH_KEYS = [...FILTER_KEYS, "page", "size"] as const;
const ALLOWED_SIDO = new Set<string>(REGION_DEFINITIONS.flatMap((region) => [...region.aliases]));
const ALLOWED_CATEGORY = new Set<string>(SERVICE_CATEGORY_ORDER);
const ALLOWED_PAGE_SIZES = new Set([20, 30, 50, 100]);

const boundedText = (maximum: number) => z.string().trim().max(maximum);
const filterSchema = z.object({
  sido: boundedText(40).refine((value) => !value || ALLOWED_SIDO.has(value)),
  sigungu: boundedText(40),
  category: boundedText(40).refine((value) => !value || ALLOWED_CATEGORY.has(value)),
  subcategory: boundedText(80),
  type: boundedText(40),
  keyword: boundedText(100),
  sort: boundedText(40).refine((value) => !value || isSearchSort(value)),
}).refine((value) => !value.sigungu || Boolean(value.sido));

const searchSchema = z.object({
  filters: filterSchema,
  page: z.number().int().min(1).max(10_000),
  pageSize: z.number().int().refine((value) => ALLOWED_PAGE_SIZES.has(value)),
});

export type DatasetRequestResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly message: string };

function hasOnlyUniqueAllowedKeys(params: URLSearchParams, allowed: readonly string[]): boolean {
  const allowlist = new Set(allowed);
  const seen = new Set<string>();
  for (const key of params.keys()) {
    if (!allowlist.has(key) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function integer(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  return Number(value);
}

function filterCandidate(params: URLSearchParams): FilterState {
  const sort = params.get("sort");
  return {
    ...EMPTY_FILTERS,
    sido: params.get("sido") ?? "",
    sigungu: params.get("sigungu") ?? "",
    category: params.get("category") ?? "",
    subcategory: params.get("subcategory") ?? "",
    type: params.get("type") ?? "",
    keyword: params.get("q") ?? "",
    sort: isSearchSort(sort) ? sort : "",
  };
}

function invalid<T>(): DatasetRequestResult<T> {
  return { success: false, message: "검색 조건이 올바르지 않습니다." };
}

export function parseDatasetFilterRequest(
  params: URLSearchParams,
): DatasetRequestResult<FilterState> {
  if (!hasOnlyUniqueAllowedKeys(params, FILTER_KEYS)) return invalid();
  const parsed = filterSchema.safeParse(filterCandidate(params));
  return parsed.success ? { success: true, data: parsed.data } : invalid();
}

export function parseDatasetSearchRequest(
  params: URLSearchParams,
): DatasetRequestResult<{ readonly filters: FilterState; readonly page: number; readonly pageSize: number }> {
  if (!hasOnlyUniqueAllowedKeys(params, SEARCH_KEYS)) return invalid();
  const parsed = searchSchema.safeParse({
    filters: filterCandidate(params),
    page: integer(params.get("page"), 1),
    pageSize: integer(params.get("size"), 30),
  });
  return parsed.success ? { success: true, data: parsed.data } : invalid();
}
