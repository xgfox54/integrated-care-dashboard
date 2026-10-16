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
  register("search_statistics", "복지통계 찾기", "보건복지부 통계 목록과 행정안전부의 지역별 중장년·노년·아동 인구 3종, 관련 통계기관을 검색합니다. data_available=true인 항목만 수치가 연결되어 있습니다. dataset_id를 get_statistics_data에 전달하세요. kind는 출처 분류이며, 웹에서는 중복 출처를 하나의 목록으로 묶습니다. 공표일정은 관측연도가 아닙니다.", {
    query: z.string().max(200).optional(), kind: z.enum(["indicator", "approved", "portal", "population"]).optional(), category: z.string().max(30).optional(),
    data_only: z.boolean().optional(), offset: z.number().int().min(0).max(1000).optional(), limit: z.number().int().min(1).max(100).optional(),
  }, async args => { const result = searchStatistics(args, await currentStatisticsCatalog(db)); return wrap(result, { evidence: STATISTICS_SOURCES, coverage: result.coverage }); });

  register("get_statistics_data", "복지통계 수치·지역 비교", "공식 통계표의 숫자, 단위, 기준연도·월, 결측·잠정치·추정치, 주석과 출처를 제공합니다. statistics_id는 search_statistics의 dataset_id를 사용합니다. 지표누리 복지·보건 API 32종과 지역별 인구 3종은 서버가 24시간 간격으로 확인하고 검증 후 저장하며, KOSIS·공식 보고서 자료는 저장된 확인본을 제공합니다. 지표누리 자료는 전국 집계로 해석하고, 노년부양비의 장래인구 추계는 관측값과 구별하세요. population:*는 전국·16개 시도의 주민등록인구이며 만 40~64세·65세 이상·0~17세를 구분합니다. 응답의 population.reference_date를 기준일로 쓰세요. 외국인 제외, 시군구 미수록. auto_refresh로 마지막 시도·성공·다음 확인 예정·오류 상태를 확인하세요. source_review에는 출처명과 관측연도의 불일치 및 독립검수 보완근거가 있습니다. 보완근거의 공표일을 지표누리 갱신일로 바꾸지 마세요. 원자료 갱신·공표일은 evidence.source_date를 쓰고 checked_at은 사이트가 확인한 시각으로만 설명하세요. 지역은 series_id=region:행정기관코드로 선택하고 같은 지역의 total_population을 비중 분모로 사용하세요. from_year/to_year는 월자료의 연도도 필터합니다. 웹·API·MCP가 같은 저장 자료를 읽으며 MCP 조회는 배경 수집을 시작하지 않습니다. 실패·결측을 0으로 바꾸지 않습니다. mode=verified는 고정 확인본입니다.", {
    statistics_id: z.string().min(1).max(80), series_id: z.string().max(80).optional(), from_year: z.number().int().min(1900).max(2100).optional(), to_year: z.number().int().min(1900).max(2100).optional(), mode: z.enum(["auto", "verified"]).optional(),
  }, async ({ statistics_id, ...args }) => {
    try {
      const result = await getStatisticsData(statistics_id, args, { db });
      const sources = result.dataset.population?.source_urls ?? result.dataset.index_api?.tables?.map(table => ({ title: table.table_title, url: table.source_url, table_code: table.table_code })) ?? [{ title: result.dataset.table_title, url: result.dataset.source_url }];
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
