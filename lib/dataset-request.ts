import { EMPTY_FILTERS, type FilterState } from "./dataset";

export function filtersFromSearchParams(params: URLSearchParams): FilterState {
  return {
    ...EMPTY_FILTERS,
    sido: params.get("sido") ?? "",
    sigungu: params.get("sigungu") ?? "",
    category: params.get("category") ?? "",
    subcategory: params.get("subcategory") ?? "",
    type: params.get("type") ?? "",
    keyword: params.get("q") ?? "",
  };
}
export function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
