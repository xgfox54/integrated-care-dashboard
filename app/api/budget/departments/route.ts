import { getD1 } from "@/lib/d1";
import { errorResponse } from "@/lib/errors";
import { webDepartmentHistory } from "@/lib/fiscal/department-history";

export const dynamic = "force-dynamic";

// 재정주체 하나의 부서코드 연도별 관측 이력·연도 사이 사업 이관(공개 snapshot만). ?entity=lofin:laf:…
export async function GET(request: Request): Promise<Response> {
  const entity = (new URL(request.url).searchParams.get("entity") ?? "").slice(0, 40);
  const headers = { "cache-control": "no-store" };
  if (!/^lofin:laf:\d{1,12}$/.test(entity)) return Response.json({ error: "INVALID_ENTITY", message: "entity=lofin:laf:<자치단체코드> 형식이어야 합니다." }, { status: 400, headers });
  try {
    const history = await webDepartmentHistory(getD1(), entity);
    if (!history) return Response.json({ error: "NOT_FOUND", message: "이 재정주체의 공개 자료가 없습니다." }, { status: 404, headers });
    return Response.json(history, { headers });
  } catch (error) {
    return errorResponse(error, { code: "DEPARTMENT_HISTORY_FAILED", message: "부서 이력을 읽지 못했습니다.", status: 500, path: "/api/budget/departments" });
  }
}
