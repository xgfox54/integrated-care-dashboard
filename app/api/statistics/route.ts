import { searchStatistics, statisticsCatalog, verifiedStatistics, STATISTICS_SOURCES } from "@/lib/statistics/catalog";
import { getStatisticsData, StatisticsError } from "@/lib/statistics/read";
import type { CatalogKind } from "@/lib/statistics/types";
import { getD1 } from "@/lib/d1";
import { currentStatisticsCatalog, currentStatisticsStatus, readCurrentStatisticsSnapshots } from "@/lib/statistics/store";

export const dynamic = "force-dynamic";
function integer(value: string | null, name: string): number | undefined {
  if (value === null) return undefined;
  if (!/^\d{1,4}$/.test(value)) throw new StatisticsError("INVALID_INPUT", name + " 형식이 올바르지 않습니다.");
  return Number(value);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const allowed = new Set(["id", "view", "query", "kind", "category", "data_only", "offset", "limit", "from_year", "to_year", "series_id", "mode"]);
    if ([...params.keys()].some(key => !allowed.has(key))) throw new StatisticsError("INVALID_INPUT", "지원하지 않는 조회 조건입니다.");
    const id = params.get("id");
    if (id) {
      if (!verifiedStatistics(id) && !statisticsCatalog().some(item => item.id === id || item.dataset_id === id)) throw new StatisticsError("NOT_FOUND", "등록된 통계 항목을 찾지 못했습니다.", 404);
      const mode = params.get("mode") ?? "auto";
      if (mode !== "auto" && mode !== "verified") throw new StatisticsError("INVALID_INPUT", "조회 방식이 올바르지 않습니다.");
      const result = await getStatisticsData(id, { from_year: integer(params.get("from_year"), "시작연도"), to_year: integer(params.get("to_year"), "종료연도"), series_id: params.get("series_id") ?? undefined, mode }, { db: getD1() });
      return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
    }
    const view = params.get("view") ?? "catalog";
    if (view === "current") return Response.json({ ok: true, results: await readCurrentStatisticsSnapshots(getD1()) }, { headers: { "cache-control": "no-store" } });
    if (view === "status") return Response.json({ ok: true, status: await currentStatisticsStatus(getD1()) }, { headers: { "cache-control": "no-store" } });
    if (view === "sources") return Response.json({ ok: true, sources: STATISTICS_SOURCES, portals: statisticsCatalog().filter(item => item.kind === "portal"), status: await currentStatisticsStatus(getD1()) }, { headers: { "cache-control": "no-store" } });
    if (view !== "catalog") throw new StatisticsError("INVALID_INPUT", "조회 화면이 올바르지 않습니다.");
    const kind = params.get("kind") ?? undefined;
    if (kind && !["indicator", "approved", "portal", "population"].includes(kind)) throw new StatisticsError("INVALID_INPUT", "자료 구분이 올바르지 않습니다.");
    const query = params.get("query") ?? "";
    if (query.length > 200) throw new StatisticsError("INVALID_INPUT", "검색어는 200자 이하로 입력하세요.");
    const limit = integer(params.get("limit"), "건수"); const offset = integer(params.get("offset"), "시작 위치");
    if (limit !== undefined && (limit < 1 || limit > 100)) throw new StatisticsError("INVALID_INPUT", "건수는 1~100 사이로 입력하세요.");
    const [catalog, status] = await Promise.all([currentStatisticsCatalog(getD1()), currentStatisticsStatus(getD1())]);
    return Response.json({ ok: true, ...searchStatistics({ query, kind: kind as CatalogKind | undefined, category: params.get("category") ?? undefined, data_only: params.get("data_only") === "true", limit, offset }, catalog), status }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: { code: error instanceof StatisticsError ? error.code : "STATISTICS_UNAVAILABLE", message: error instanceof StatisticsError ? error.message : "통계를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." } }, { status: error instanceof StatisticsError ? error.status : 500, headers: { "cache-control": "no-store" } });
  }
}
