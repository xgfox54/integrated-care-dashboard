import { withSharedCache } from "@/lib/edge-cache";
import { errorResponse } from "@/lib/errors";
import { parseGovSearchRequest } from "@/lib/gov-search-request";
import { ServiceKeyMissingError, callWelfareList } from "@/lib/welfare-api";

export const dynamic = "force-dynamic";

// 사업 상세에서 공공데이터포털 목록을 찾아보는 중계 경로. 인증키의 호출 한도를 지키려고
// 검색어 길이를 제한하고, 같은 검색어는 5분 동안 서버 메모리의 결과를 다시 쓴다.
const CACHE_HEADER = "public, max-age=300";

async function buildSearchResponse(request: Request): Promise<Response> {
  const parsed = parseGovSearchRequest(new URL(request.url).searchParams);
  if (!parsed.success) {
    return Response.json(
      { error: "INVALID_REQUEST", message: parsed.message },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  const keyword = parsed.keyword;

  try {
    const result = await callWelfareList({ keyword, numOfRows: 10 });
    return Response.json(
      {
        configured: true,
        ok: result.ok,
        resultCode: result.resultCode,
        resultMsg: result.resultMsg,
        totalCount: result.totalCount,
        items: result.items,
      },
      { headers: { "cache-control": result.ok ? CACHE_HEADER : "no-store" } },
    );
  } catch (error) {
    if (error instanceof ServiceKeyMissingError) {
      return Response.json(
        { configured: false, error: "SERVICE_NOT_CONFIGURED", message: "공공데이터 검색 기능이 준비되지 않았습니다." },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }
    return errorResponse(error, {
      code: "UPSTREAM_SEARCH_FAILED",
      message: "공공데이터 검색에 실패했습니다.",
      status: 502,
      path: "/api/gov/search",
    });
  }
}

export function GET(request: Request): Promise<Response> {
  return withSharedCache(request, () => buildSearchResponse(request));
}
