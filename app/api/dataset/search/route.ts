import { parseDatasetSearchRequest } from "@/lib/dataset-request";
import { searchBodyJson } from "@/lib/dataset-responses";
import { SHARED_CACHE_HEADER, withSharedCache } from "@/lib/edge-cache";
import { errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

async function buildSearchResponse(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const parsed = parseDatasetSearchRequest(params);
  if (!parsed.success) {
    return Response.json(
      { error: "INVALID_REQUEST", message: parsed.message },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const { filters, page, pageSize } = parsed.data;
    const { body, stored } = await searchBodyJson(
      filters,
      page,
      pageSize,
    );
    return new Response(body, {
      headers: {
        "content-type": "application/json",
        "cache-control": SHARED_CACHE_HEADER,
        "x-dataset-cache": stored ? "hit" : "miss",
      },
    });
  } catch (error) {
    return errorResponse(error, {
      code: "DATA_SEARCH_FAILED",
      message: "검색 자료를 읽지 못했습니다.",
      status: 500,
      path: "/api/dataset/search",
    });
  }
}

export function GET(request: Request): Promise<Response> {
  return withSharedCache(request, () => buildSearchResponse(request));
}
