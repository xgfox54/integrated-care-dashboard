import { getD1 } from "@/lib/d1";
import { errorResponse } from "@/lib/errors";
import { readPressRegions } from "@/lib/press/query";

export const dynamic = "force-dynamic";

// 지도·지역 선택용 지역별 공개 보도자료 수(발행기관 관할 기준).
export async function GET(): Promise<Response> {
  try {
    return Response.json(await readPressRegions(getD1()), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, { code: "PRESS_REGIONS_FAILED", message: "지역별 보도자료 수를 읽지 못했습니다.", status: 500, path: "/api/press/regions" });
  }
}
