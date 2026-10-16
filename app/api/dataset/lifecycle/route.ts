import { getD1 } from "@/lib/d1";
import { errorResponse } from "@/lib/errors";
import { isOfficialServiceId, readServiceLifecycle } from "@/lib/service-lifecycle";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const id = (new URL(request.url).searchParams.get("id") ?? "").trim();
  if (!isOfficialServiceId(id)) {
    return Response.json({ error: "INVALID_SERVICE", message: "사업 원문 식별자가 올바르지 않습니다." }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  try {
    const lifecycle = await readServiceLifecycle(getD1(), id);
    if (!lifecycle) return Response.json({ error: "NOT_FOUND", message: "현재 공개본에서 사업을 찾지 못했습니다." }, { status: 404, headers: { "cache-control": "no-store" } });
    return Response.json(lifecycle, { headers: { "cache-control": "public, max-age=300" } });
  } catch (error) {
    return errorResponse(error, { code: "LIFECYCLE_FAILED", message: "사업 상태 정보를 불러오지 못했습니다.", status: 500, path: "/api/dataset/lifecycle" });
  }
}

