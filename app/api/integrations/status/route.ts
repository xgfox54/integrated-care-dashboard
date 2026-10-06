import { getD1 } from "@/lib/d1";
import { errorResponse } from "@/lib/errors";
import { integrationStatus } from "@/lib/integrations/public";

export const dynamic = "force-dynamic";

/** 외부 연계별 제공기관·이용조건·한도·갱신주기·마지막 성공 수집·상태(공개). 인증값·내부 오류 원문은 포함하지 않는다. */
export async function GET(): Promise<Response> {
  try {
    return Response.json({ ok: true, datasets: await integrationStatus(getD1()) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, { code: "INTEGRATION_STATUS_FAILED", message: "연계 현황을 불러오지 못했습니다.", status: 500, path: "/api/integrations/status" });
  }
}
