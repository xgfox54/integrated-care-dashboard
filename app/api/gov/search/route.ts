import { describeError } from "@/lib/errors";
import { withSharedCache } from "@/lib/edge-cache";
import { ServiceKeyMissingError, callWelfareList } from "@/lib/welfare-api";

export const dynamic = "force-dynamic";

// 사업 상세에서 공공데이터포털 목록을 찾아보는 중계 경로. 인증키의 호출 한도를 지키려고
// 검색어 길이를 제한하고, 같은 검색어는 5분 동안 서버 메모리의 결과를 다시 쓴다.
const MAX_KEYWORD_LENGTH = 80;
const CACHE_HEADER = "public, max-age=300";

async function buildSearchResponse(request: Request): Promise<Response> {
  const keyword = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!keyword) {
    return Response.json({ error: "검색어를 입력하세요." }, { status: 400 });
  }
  if (keyword.length > MAX_KEYWORD_LENGTH) {
    return Response.json({ error: "검색어가 너무 깁니다." }, { status: 400 });
  }

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
      return Response.json({ configured: false, error: error.message }, { status: 409, headers: { "cache-control": "no-store" } });
    }
    return Response.json({ configured: true, error: describeError(error) }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}

export function GET(request: Request): Promise<Response> {
  return withSharedCache(request, () => buildSearchResponse(request));
}
