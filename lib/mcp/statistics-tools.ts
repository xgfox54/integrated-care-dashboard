import { z } from "zod";
import { searchStatistics, STATISTICS_SOURCES } from "../statistics/catalog.ts";
import { getStatisticsData, StatisticsError } from "../statistics/read.ts";
import { McpToolError, type McpToolName } from "./contract.ts";
import type { SqlDatabase } from "../sql-database.ts";
import { currentStatisticsCatalog, currentStatisticsStatus } from "../statistics/store.ts";
import { statisticsSourceDate } from "../statistics/source-date.ts";

export const STATISTICS_TOOL_NAMES = ["search_statistics", "get_statistics_data", "get_statistics_sources"] as const;
type Register = <Shape extends z.ZodRawShape>(name: McpToolName, title: string, description: string, shape: Shape, handler: (args: z.objectOutputType<Shape, z.ZodTypeAny>) => Promise<object>) => void;
export function registerStatisticsTools({ db, register, wrap }: { db: SqlDatabase; register: Register; wrap: (data: unknown, options?: { evidence?: readonly unknown[]; warnings?: readonly string[]; coverage?: { scope: string; complete: boolean; gaps: readonly string[] } }) => Promise<object> }) {
  register("search_statistics", "복지통계 찾기", "보건복지부 통계·KOSIS 복지 통계(31종)·지역별 연령 인구를 검색합니다. data_available=true 항목의 dataset_id를 get_statistics_data에 전달해 수치를 조회하세요.", {
    query: z.string().max(200).optional(), kind: z.enum(["indicator", "approved", "portal", "population", "kosis"]).optional(), category: z.string().max(30).optional(),
    data_only: z.boolean().optional(), offset: z.number().int().min(0).max(1000).optional(), limit: z.number().int().min(1).max(100).optional(),
  }, async args => { const result = searchStatistics(args, await currentStatisticsCatalog(db)); return wrap(result, { evidence: STATISTICS_SOURCES, coverage: result.coverage }); });

  register("get_statistics_data", "복지통계 수치·지역 비교", "공식 통계표(지표누리·KOSIS·주민등록인구)의 시계열 수치·단위·기준시점·결측/잠정치/추계 표시와 출처를 조회합니다. statistics_id에 search_statistics의 dataset_id를 넣고, 원자료 공표일(evidence.source_date)과 확인시각(checked_at)을 구분하세요.", {
    statistics_id: z.string().min(1).max(80), series_id: z.string().max(80).optional(), from_year: z.number().int().min(1900).max(2100).optional(), to_year: z.number().int().min(1900).max(2100).optional(), mode: z.enum(["auto", "verified"]).optional(),
  }, async ({ statistics_id, ...args }) => {
    try {
      const result = await getStatisticsData(statistics_id, args, { db });
      const sources = result.dataset.population?.source_urls ?? result.dataset.kosis?.tables.map(table => ({ title: table.title, url: table.url, table_code: table.tbl_id })) ?? result.dataset.index_api?.tables?.map(table => ({ title: table.table_title, url: table.source_url, table_code: table.table_code })) ?? [{ title: result.dataset.table_title, url: result.dataset.source_url }];
      const publication = result.dataset.source_review?.reference;
      const evidence = [...sources.map(source => ({ publisher: result.dataset.source_name, table_code: result.dataset.table_code, checked_at: result.checked_at, source_date: statisticsSourceDate(result.dataset), ...source })),
        ...(publication ? [{ ...publication, source_date: { kind: "published", label: "원자료 공표", date: publication.published_at }, verification_scope: "listed_values_and_reference_year_only" }] : [])];
      return wrap(result, { evidence, warnings: [...result.warnings, 'ESTIMATE는 추계 방식의 표시이며 그 자체가 미래연도를 뜻하지 않습니다. 현재 연도와 비교해 과거·현재·미래를 구분하고, 과거·현재 연도의 추계치도 실제 관측치로 바꾸지 마세요.'], coverage: result.coverage });
    } catch (error) { if (error instanceof StatisticsError) throw new McpToolError(error.code, error.message); throw error; }
  });

  register("get_statistics_sources", "복지통계 출처·연결 범위", "보건복지부 통계 목록과 행정안전부 주민등록인구의 출처, 관련 통계기관, 실제 수치 연결 범위를 조회합니다. 통계별 기준 시점·지역 범위·갱신 방식이 다릅니다. 전체 KOSIS·OECD DB가 연결된 것은 아닙니다.", {
    statistics_id: z.string().min(1).max(80).optional(),
  }, async ({ statistics_id }) => {
    const catalog = await currentStatisticsCatalog(db); const item = statistics_id ? catalog.find(row => row.id === statistics_id || row.dataset_id === statistics_id) : null;
    if (statistics_id && !item) throw new McpToolError("NOT_FOUND", "등록된 통계 항목을 찾지 못했습니다.");
    const status = await currentStatisticsStatus(db);
    return wrap({ sources: STATISTICS_SOURCES, item, portal_sites: catalog.filter(row => row.kind === "portal"), ...status }, { evidence: STATISTICS_SOURCES, coverage: { scope: "statistics_sources_and_coverage", complete: false, gaps: status.warnings } });
  });
}
