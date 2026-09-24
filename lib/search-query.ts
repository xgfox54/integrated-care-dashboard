import type { FilterState } from "./dataset";

/**
 * 검색 API 주소의 질의 문자열. 화면(검색·미리받기)과 서버(지역 묶음)가 같은 함수로
 * 만들어야 묶음으로 받은 결과를 화면의 검색 결과 자리에 그대로 넣을 수 있다.
 */
export function searchQueryString(
  filters: Pick<FilterState, "sido" | "sigungu" | "category" | "keyword">,
  page: number,
  pageSize: number,
): string {
  const params = new URLSearchParams({ page: String(page), size: String(pageSize) });
  if (filters.sido) params.set("sido", filters.sido);
  if (filters.sigungu) params.set("sigungu", filters.sigungu);
  if (filters.category) params.set("category", filters.category);
  if (filters.keyword) params.set("q", filters.keyword);
  return params.toString();
}
