import { getD1 } from "@/lib/d1";
import { errorResponse } from "@/lib/errors";
import { parseBudgetRequest, readBudget } from "@/lib/fiscal/public";

export const dynamic = "force-dynamic";

// 복지예산 집행현황 공개 조회. 공개 snapshot만 읽는다.
export async function GET(request: Request): Promise<Response> {
  const parsed = parseBudgetRequest(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return Response.json({ error: "INVALID_BUDGET_QUERY", message: parsed.message }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  try {
    const started = Date.now();
    const body = await readBudget(getD1(), parsed.request);
    // 공개 승인 해제가 바로 반영되도록 공유·브라우저 캐시에 두지 않는다(T47). server-timing은 서버 처리 시간(ms)만 알린다.
    return Response.json(body, { headers: { "cache-control": "no-store", "server-timing": "app;dur=" + (Date.now() - started) } });
  } catch (error) {
    return errorResponse(error, { code: "BUDGET_READ_FAILED", message: "복지예산 자료를 읽지 못했습니다.", status: 500, path: "/api/budget" });
  }
}

