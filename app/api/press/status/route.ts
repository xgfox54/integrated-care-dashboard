import { getD1 } from "@/lib/d1";
import { errorResponse } from "@/lib/errors";
import { readPressCoverage } from "@/lib/press/coverage";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json(await readPressCoverage(getD1(), Math.floor(Date.now() / 1000)), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, { code: "PRESS_STATUS_FAILED", message: "수집 현황을 읽지 못했습니다.", status: 500, path: "/api/press/status" });
  }
}
