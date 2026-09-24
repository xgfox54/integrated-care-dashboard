import type { OfficialSearchResult } from "./official-query";
import { MOHW_INTEGRATED_CARE_URL } from "./official-source";

export const OFFICIAL_SOURCE_LABEL = "보건복지부 통합돌봄 사업안내";

/** 검색 API 응답 본문. 지역 묶음도 같은 모양으로 담는다. */
export function searchResponseBody(result: OfficialSearchResult) {
  return {
    state: result.totalCount > 0 ? "official" : "empty",
    sourceLabel: OFFICIAL_SOURCE_LABEL,
    sourceUrl: MOHW_INTEGRATED_CARE_URL,
    fetchedAt: result.completedAt,
    message: "",
    ...result,
  };
}
