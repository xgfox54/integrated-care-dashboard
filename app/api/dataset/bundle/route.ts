import { describeError } from "@/lib/errors";
import { bundleBodyJson, parseBundleRequest } from "@/lib/dataset-responses";
import { SHARED_CACHE_HEADER, withSharedCache } from "@/lib/edge-cache";

export const dynamic = "force-dynamic";

// 대시보드 미리받기용: 여러 지역의 첫 쪽 검색 결과를 한 번에 돌려준다.
async function buildBundleResponse(request: Request): Promise<Response> {
  const bundle = parseBundleRequest(new URL(request.url).searchParams);
  if (!bundle) {
    return Response.json({ error: "지역 묶음 요청이 올바르지 않습니다.", entries: [] }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  try {
    const { body, stored } = await bundleBodyJson(bundle);
    return new Response(body, {
      headers: {
        "content-type": "application/json",
        "cache-control": SHARED_CACHE_HEADER,
        "x-dataset-cache": stored ? "hit" : "miss",
      },
    });
  } catch (error) {
    return Response.json(
      { error: `지역 묶음을 읽지 못했습니다: ${describeError(error)}`, entries: [] },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export function GET(request: Request): Promise<Response> {
  return withSharedCache(request, () => buildBundleResponse(request));
}
