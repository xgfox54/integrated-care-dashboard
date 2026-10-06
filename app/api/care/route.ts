import { getD1 } from "@/lib/d1";
import { errorResponse } from "@/lib/errors";
import { CARE_RESOURCES_PUBLIC } from "@/lib/integrations/care-hold";
import { careDemand, careInstitution, careInstitutions, SERVICE_GROUP_LABELS } from "@/lib/integrations/public";

export const dynamic = "force-dynamic";

const REGION = /^region:[가-힣]{2,20}(\|[가-힣0-9 ]{1,30})?$/;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const todayKst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * 지역 돌봄 수요·자원(공개). ?regions=1 → 선택 가능한 지역 목록, ?region=… → 수요 통계·기관 수·지표·기관 목록 한 쪽,
 * ?institution=ltc:… → 기관 상세. 공개 MCP(get_care_demand·find_care_institutions·get_care_institution)와 같은 함수를 쓴다.
 */
export async function GET(request: Request): Promise<Response> {
  // 돌봄자원 보류 동안 공개 조회를 열지 않는다(lib/integrations/care-hold.ts).
  if (!CARE_RESOURCES_PUBLIC) return json({ error: "NOT_FOUND", message: "제공하지 않는 자료입니다." }, 404);
  const url = new URL(request.url);
  try {
    const db = getD1();
    if (url.searchParams.get("regions") === "1") {
      const rows = await db.prepare("SELECT DISTINCT to_code FROM region_code_map WHERE from_type = 'LEGAL_DONG' AND to_type = 'CONTENT_REGION' AND status = 'VERIFIED' AND (valid_to IS NULL OR valid_to > ?) ORDER BY to_code")
        .bind(todayKst()).all<{ to_code: string }>();
      return json({ regions: rows.results.map((row) => row.to_code), groups: SERVICE_GROUP_LABELS });
    }
    const institution = url.searchParams.get("institution") ?? "";
    if (institution) {
      if (!/^ltc:\d{11}$/.test(institution)) return json({ error: "INVALID_INSTITUTION", message: "기관 ID 형식이 올바르지 않습니다." }, 400);
      const detail = await careInstitution(db, institution, todayKst());
      return detail ? json({ ok: true, institution: detail }) : json({ error: "NOT_FOUND", message: "수집된 장기요양기관에서 찾지 못했습니다." }, 404);
    }
    const region = url.searchParams.get("region") ?? "";
    if (!REGION.test(region)) return json({ error: "INVALID_REGION", message: "region:<시·도>|<시·군·구> 형식의 지역 ID가 필요합니다." }, 400);
    const group = url.searchParams.get("group") ?? "";
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 50);
    const page = Math.max(1, Math.min(500, Number(url.searchParams.get("page") ?? "1") || 1));
    const today = todayKst();
    const [demand, list] = await Promise.all([
      careDemand(db, region, today),
      careInstitutions(db, region, today, { group: group in SERVICE_GROUP_LABELS ? group : undefined, query: query || undefined, offset: (page - 1) * 20, limit: 20 }),
    ]);
    return json({ ok: true, demand, institutions: { ...list, page, page_size: 20 } });
  } catch (error) {
    return errorResponse(error, { code: "CARE_FAILED", message: "지역 돌봄 자원을 불러오지 못했습니다.", status: 500, path: "/api/care" });
  }
}
