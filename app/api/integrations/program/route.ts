import { getD1 } from "@/lib/d1";
import { errorResponse } from "@/lib/errors";
import { programPublicInfo } from "@/lib/integrations/public";

export const dynamic = "force-dynamic";

/** 사업 상세의 공식 혜택정보(정부24)·법적 근거. 관리자가 확인한 연결만 내용을 주고 후보는 대기 건수만 준다(MCP get_program_public_info와 같음). */
export async function GET(request: Request): Promise<Response> {
  const id = (new URL(request.url).searchParams.get("service") ?? "").trim();
  if (!id.startsWith("service:") || id.length > 400) {
    return Response.json({ error: "INVALID_SERVICE", message: "service: 로 시작하는 사업 ID가 필요합니다." }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  try {
    return Response.json({ ok: true, ...(await programPublicInfo(getD1(), id)) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, { code: "PROGRAM_INFO_FAILED", message: "공식 혜택정보를 불러오지 못했습니다.", status: 500, path: "/api/integrations/program" });
  }
}
