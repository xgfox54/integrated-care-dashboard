import { getD1 } from "@/lib/d1";
import { errorResponse } from "@/lib/errors";
import { parsePressSearch, searchPress } from "@/lib/press/query";

export const dynamic = "force-dynamic";

// 공식 보도자료 메타데이터 검색. 승인 해제가 바로 반영되도록 응답을 보관하지 않는다.
export async function GET(request: Request): Promise<Response> {
  const parsed = parsePressSearch(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return Response.json({ error: "INVALID_PRESS_QUERY", message: parsed.message }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  try {
    return Response.json(await searchPress(getD1(), parsed.search), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, { code: "PRESS_SEARCH_FAILED", message: "보도자료 목록을 읽지 못했습니다.", status: 500, path: "/api/press" });
  }
}
