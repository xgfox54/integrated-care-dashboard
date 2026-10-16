import { getD1 } from "@/lib/d1";
import { errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const db = getD1();
    const [counts, state] = await Promise.all([
      db.prepare("SELECT sigungu_code AS code, COUNT(*) AS count FROM ltc_institution WHERE presence = 'PRESENT' AND sigungu_code IS NOT NULL GROUP BY sigungu_code").all<{ code: string; count: number }>(),
      db.prepare("SELECT COUNT(*) AS scopes, SUM(CASE WHEN last_status IN ('SUCCEEDED', 'SUCCEEDED_EMPTY') THEN 1 ELSE 0 END) AS ok, MIN(last_success_at) AS oldest FROM ext_scope_state WHERE dataset_key = 'nhis.ltc_search'").first<{ scopes: number; ok: number; oldest: number | null }>(),
    ]);
    const complete = Boolean(state && state.scopes > 0 && state.ok === state.scopes);
    return Response.json({
      source: "국민건강보험공단 장기요양기관 검색 서비스(공공데이터포털 15059029)",
      basis: "기관기호 기준, 서비스 유형 중복 제외. 지정 기관 수이며 빈자리·이용 가능 여부가 아닙니다.",
      state: complete ? "COLLECTED" : "INCOMPLETE",
      basis_date: state?.oldest ? new Date(state.oldest * 1000).toISOString().slice(0, 10) : null,
      counts: complete ? Object.fromEntries(counts.results.map((row) => [row.code, row.count])) : {},
    }, { headers: { "cache-control": "public, max-age=3600" } });
  } catch (error) {
    if (error instanceof Error && /no such table/i.test(error.message)) {
      return Response.json({ state: "NOT_COLLECTED", counts: {}, basis_date: null }, { headers: { "cache-control": "public, max-age=600" } });
    }
    return errorResponse(error, { code: "REGIONAL_INSTITUTIONS_FAILED", message: "지역별 기관 수를 불러오지 못했습니다.", status: 500, path: "/api/regional-indicators/institutions" });
  }
}

