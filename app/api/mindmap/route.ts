import { SHARED_CACHE_HEADER, withSharedCache } from "@/lib/edge-cache";
import { errorResponse } from "@/lib/errors";
import { readMindmapSource } from "@/lib/mindmap-source";

export const dynamic = "force-dynamic";

// 복지정보 관계성 지도용 온톨로지 집계(공개 자료의 분류별 수만, 본문·개인정보 없음).
// 관계 수 집계가 무거워(캐시 없을 때 약 2초) 서버 공유 캐시(edge-cache)에 5분 동안 둔다.
export async function GET(request: Request): Promise<Response> {
  return withSharedCache(request, async () => {
    try {
      return Response.json(await readMindmapSource(), { headers: { "cache-control": SHARED_CACHE_HEADER } });
    } catch (error) {
      return errorResponse(error, { code: "MINDMAP_FAILED", message: "관계성 지도 자료를 읽지 못했습니다.", status: 500, path: "/api/mindmap" });
    }
  });
}
