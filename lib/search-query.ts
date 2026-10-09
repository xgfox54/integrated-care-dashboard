import type { FilterState } from "./dataset";

/**
 * 검색 API 주소의 질의 문자열. 화면(검색·미리받기)과 서버(지역 묶음)가 같은 함수로
 * 만들어야 묶음으로 받은 결과를 화면의 검색 결과 자리에 그대로 넣을 수 있다.
 */
export function searchQueryString(
  filters: Pick<FilterState, "sido" | "sigungu" | "category" | "keyword" | "sort"> & Partial<Pick<FilterState, "subcategory" | "type" | "targetGroup">>,
  page: number,
  pageSize: number,
): string {
  const params = new URLSearchParams({ page: String(page), size: String(pageSize) });
  if (filters.sido) params.set("sido", filters.sido);
  if (filters.sigungu) params.set("sigungu", filters.sigungu);
  if (filters.category) params.set("category", filters.category);
  if (filters.subcategory) params.set("subcategory", filters.subcategory);
  if (filters.type) params.set("type", filters.type);
  if (filters.keyword) params.set("q", filters.keyword);
  // 정렬은 기본값(검색어가 있으면 관련도순, 없으면 지역순)이 아닐 때만 적는다. 묶음 미리받기 주소와 같게 유지한다.
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.targetGroup) params.set("target_group", filters.targetGroup);
  return params.toString();
}
