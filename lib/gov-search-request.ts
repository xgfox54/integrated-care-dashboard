import { hasOnlyUniqueQueryKeys } from "./query-boundary.ts";

const MAX_KEYWORD_LENGTH = 80;

export type GovSearchRequest =
  | { readonly success: true; readonly keyword: string }
  | { readonly success: false; readonly message: string };

export function parseGovSearchRequest(params: URLSearchParams): GovSearchRequest {
  if (!hasOnlyUniqueQueryKeys(params, ["q"])) {
    return { success: false, message: "검색 조건이 올바르지 않습니다." };
  }
  const keyword = (params.get("q") ?? "").trim();
  if (!keyword) return { success: false, message: "검색어를 입력하세요." };
  if (keyword.length > MAX_KEYWORD_LENGTH) {
    return { success: false, message: "검색어가 너무 깁니다." };
  }
  return { success: true, keyword };
}
