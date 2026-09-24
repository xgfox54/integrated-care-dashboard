import { describeError } from "@/lib/errors";
import { filtersFromSearchParams, positiveInteger } from "@/lib/dataset-request";
import { searchBodyJson } from "@/lib/dataset-responses";
import { SHARED_CACHE_HEADER, withSharedCache } from "@/lib/edge-cache";
import { MOHW_INTEGRATED_CARE_URL } from "@/lib/official-source";

export const dynamic = "force-dynamic";

async function buildSearchResponse(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  try {
    const { body, stored } = await searchBodyJson(
      filtersFromSearchParams(params),
      positiveInteger(params.get("page"), 1),
      positiveInteger(params.get("size"), 30),
    );
    return new Response(body, {
      headers: {
        "content-type": "application/json",
        "cache-control": SHARED_CACHE_HEADER,
        "x-dataset-cache": stored ? "hit" : "miss",
      },
    });
  } catch (error) {
    return Response.json(
      {
        state: "failed",
        sourceLabel: "보건복지부 통합돌봄 사업안내",
        sourceUrl: MOHW_INTEGRATED_CARE_URL,
        fetchedAt: "",
        dataAsOf: "",
        message: `검색 자료를 읽지 못했습니다: ${describeError(error)}`,
        rows: [],
        totalCount: 0,
        page: 1,
        pageSize: 30,
        pageCount: 1,
        regionCounts: {},
        categoryCounts: {},
        regionSummary: { rowCount: 0, categoryCounts: {}, typeCounts: {} },
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export function GET(request: Request): Promise<Response> {
  return withSharedCache(request, () => buildSearchResponse(request));
}
