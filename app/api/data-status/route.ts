import { getD1 } from "@/lib/d1";
import { readDataStatus } from "@/lib/data-status";
import { errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json(await readDataStatus(getD1()), { headers: { "cache-control": "public, max-age=120" } });
  } catch (error) {
    return errorResponse(error, { code: "DATA_STATUS_FAILED", message: "자료 상태를 불러오지 못했습니다.", status: 500, path: "/api/data-status" });
  }
}

