import { reviewStatisticsSource } from "./source-review.ts";
import { totalPopulationDataset } from "./total-population.ts";
import { OFFICIAL_REPORT_DATASETS } from "./official-reports.ts";
import { CITY_POPULATION_CHECKED_AT, CITY_POPULATION_DATASET, CITY_POPULATION_SOURCE } from "./city-population.ts";
import { STATISTICS_REFRESH_POLICY } from "./policy.ts";
import { APPROVED_STATISTICS, STATISTICS_REVISION, VERIFIED_AT, VERIFIED_DATASETS } from "./verified-data.ts";
import { POPULATION_DATASETS, POPULATION_REGION_COUNT, POPULATION_REVISION, POPULATION_SOURCE, POPULATION_VERIFIED_AT } from "./population.ts";
import { KOSIS_CHECKED_AT, KOSIS_DATASETS } from "./kosis.ts";
import { KOSIS_WELFARE_CHECKED_AT, KOSIS_WELFARE_DIRECTORY, KOSIS_WELFARE_URL } from "./kosis-welfare-directory.ts";
import { INDEX_ADDITIONAL_DATASETS, INDEX_API_SERIES, INDEX_CHECKED_AT } from "./index-verified-data.ts";
import type { CatalogKind, StatisticsCatalogItem, StatisticsDataset, StatisticsResult } from "./types.ts";

const CATALOG_REVISION = "welfare-statistics-menu-2026-10-16-kosis-welfare";
const DIRECTORY_CHECKED_AT = [VERIFIED_AT, POPULATION_VERIFIED_AT, INDEX_CHECKED_AT, KOSIS_WELFARE_CHECKED_AT].sort().at(-1)!;
export const STATISTICS_SOURCES = [
  { id: "mohw-approved", title: "보건복지부 승인통계", url: "https://www.mohw.go.kr/statList.es?mid=a10406010100&stts_nmss=ALL", scope: "현행 승인통계 37종의 통계명·소관부서·작성방법·공표일정", checked_at: VERIFIED_AT },
  { id: "mohw-indicators", title: "보건복지부 e-나라지표", url: "https://www.mohw.go.kr/menu.es?mid=a10406020000", scope: "보건·복지·기타 지표 34종과 확인된 공개 통계표", checked_at: VERIFIED_AT },
  { id: "mohw-portals", title: "보건복지부 관련 주요 사이트", url: "https://www.mohw.go.kr/menu.es?mid=a10406030000", scope: "통계 관련 기관·서비스 11곳의 원문 안내", checked_at: VERIFIED_AT },
  POPULATION_SOURCE,
  { id: "kosis-tables", title: "KOSIS 국가통계포털", url: KOSIS_WELFARE_URL, scope: `복지 주제 ${KOSIS_WELFARE_DIRECTORY.length}종 목록 · 보건·복지 ${KOSIS_DATASETS.length}종의 대표 공개 통계표 수치`, checked_at: KOSIS_CHECKED_AT },
  { id: "index-api", title: "지표누리 Open API", url: "https://www.index.go.kr/unity/openApi/openApiMenual.do", scope: "복지·보건 지표의 연결 통계표 · 등록한 인증키로 서버에서 매일 확인", checked_at: INDEX_CHECKED_AT },
] as const;

const INDICATORS = [
  ["GDP대비 경상의료비 추이", "보건·의료", "1431"],
  ["건강보험 재정 및 급여율", "보건·의료", ""],
  ["국가 암검진 수검률", "보건·의료", ""],
  ["기대수명(0세 기대여명) 및 유병기간 제외 기대수명(건강수명)", "보건·의료", ""],
  ["뇌사자 장기기증 현황", "보건·의료", ""],
  ["세대당 건강보험료 부담액", "보건·의료", ""],
  ["병상 수 추이", "보건·의료", ""],
  ["암 발생 및 사망 현황", "보건·의료", ""],
  ["영아/모성 사망", "보건·의료", ""],
  ["의료급여 수급 현황", "보건·의료", "1406"],
  ["의료인력 추이", "보건·의료", ""],
  ["정신장애 유병률", "보건·의료", ""],
  ["항생제 및 주사제 처방률", "보건·의료", ""],
  ["헌혈인구 및 개인헌혈 비율", "보건·의료", ""],
  ["국내 입양아 수 및 입양 비율", "아동", ""],
  ["국민기초생활보장 수급 현황", "사회보장", "2760"],
  ["국민연금 수급자 현황", "노인", "2709"],
  ["국민연금 재정현황", "사회보장", ""],
  ["기준 중위소득 추이", "사회보장", "2762"],
  ["노년부양비", "노인", "1430"],
  ["노인 취업률 현황", "노인", ""],
  ["노인복지시설 현황", "노인", "2766"],
  ["노인일자리 및 노후생활 현황", "노인", "2767"],
  ["보호대상아동 현황보고", "아동", ""],
  ["사회복지 지출규모", "사회보장", "2759"],
  ["아동 안전사고 현황", "아동", ""],
  ["아동 인구 현황", "아동", "3053"],
  ["아동급식지원 현황", "아동", "2707"],
  ["장애인 현황", "장애인", ""],
  ["장애인복지시설 및 사업현황", "장애인", ""],
  ["취업장애인 월평균 소득", "장애인", ""],
  ["학대피해아동 보호 건수", "아동", ""],
  ["합계출산율", "아동", ""],
  ["보건복지부 일반회계 예산현황", "사회보장", ""],
] as const;

const PORTALS = [
  ["kosis", "국가통계포털 KOSIS", "https://kosis.kr", "국내 승인통계와 주제별·지역별 통계표"],
  ["oecd", "OECD Health Statistics", "https://stats.oecd.org", "국가 간 보건의료 비교 통계. 자료별 제공 경로는 원문에서 확인"],
  ["infection", "감염병포털", "https://www.kdca.go.kr", "질병관리청의 감염병 발생·감시 통계"],
  ["nhiss", "건강보험자료공유서비스", "https://nhiss.nhis.or.kr", "국민건강보험공단의 통계·자료 이용 안내"],
  ["index", "지표누리", "https://www.index.go.kr", "e-나라지표와 주요 국가지표의 통계표·해설"],
  ["konos", "국립장기조직혈액관리원", "https://www.konos.go.kr", "장기·조직 기증과 이식 관련 통계"],
  ["knhanes", "국민건강영양조사", "https://www.kdca.go.kr", "건강행태·만성질환·영양 조사 결과와 자료 안내"],
  ["nps", "국민연금통계", "https://www.nps.or.kr", "국민연금 가입자·수급자·재정 통계"],
  ["mdis", "마이크로데이터통합서비스", "https://mdis.kostat.go.kr", "조사 마이크로데이터의 이용 절차와 제공 범위"],
  ["hira", "보건의료빅데이터개방시스템", "https://opendata.hira.or.kr", "건강보험심사평가원의 진료·의료자원 통계"],
  ["ssc", "사회보장위원회", "https://www.ssc.go.kr", "사회보장 통계와 정책 자료"],
] as const;

const REGIONAL_POPULATION_DATASETS = [totalPopulationDataset(POPULATION_DATASETS[0]), ...POPULATION_DATASETS];
export const STATISTICS_DATASETS: readonly StatisticsDataset[] = [...(VERIFIED_DATASETS as readonly StatisticsDataset[]), ...INDEX_ADDITIONAL_DATASETS, ...REGIONAL_POPULATION_DATASETS, ...KOSIS_DATASETS, ...OFFICIAL_REPORT_DATASETS, CITY_POPULATION_DATASET];
function normalized(value: string): string { return value.normalize("NFKC").replace(/[\s·ㆍ()\[\]/_-]+/g, "").toLowerCase(); }
function categoryOf(value: string): string { return value === "사회" ? "사회보장" : /보건|건강|질병/.test(value) ? "보건·의료" : value; }

export function statisticsCatalog(): StatisticsCatalogItem[] {
  return [
    ...INDICATORS.map(([title, category, code], index): StatisticsCatalogItem => {
      const dataset = (code ? STATISTICS_DATASETS.find(d => d.indicator_code === code) : undefined)
        ?? STATISTICS_DATASETS.find(d => !d.kosis && normalized(d.title) === normalized(title))
        ?? STATISTICS_DATASETS.find(d => d.kosis?.indicator_titles.includes(title));
      const indicatorCode = code || (dataset && INDEX_API_SERIES[dataset.id] ? dataset.indicator_code : "");
      return { id: code ? "stat:" + code : "indicator:" + (index + 1), kind: "indicator", title, category,
        description: dataset ? (INDEX_API_SERIES[dataset.id] ? "지표누리 API · " : "") + dataset.description : "보건복지부 e-나라지표 목록에 수록된 지표입니다. 수치 조회는 공식 원문을 이용하세요.",
        source_url: indicatorCode ? "https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=" + indicatorCode : STATISTICS_SOURCES[1].url,
        directory_url: STATISTICS_SOURCES[1].url, data_available: Boolean(dataset), dataset_id: dataset?.id ?? null, checked_at: VERIFIED_AT,
        ...(dataset && INDEX_API_SERIES[dataset.id] ? { data_provider: "index" } : {}) };
    }).filter(item => item.title !== "정신장애 유병률"),
    ...APPROVED_STATISTICS.map((row, index): StatisticsCatalogItem => {
      const dataset = STATISTICS_DATASETS.find(d => normalized(d.title).replace(/수급현황/, "수급자현황") === normalized(row.title));
      return { ...row, id: "approved:" + (index + 1), kind: "approved", category: categoryOf(row.category),
        description: row.department + " · " + row.method + " · 공표예정 " + row.publication_schedule,
        directory_url: STATISTICS_SOURCES[0].url, data_available: Boolean(dataset), dataset_id: dataset?.id ?? null, checked_at: VERIFIED_AT };
    }),
    ...REGIONAL_POPULATION_DATASETS.map((dataset): StatisticsCatalogItem => ({
      id: dataset.id, kind: "population", title: dataset.title, category: dataset.category, description: dataset.description,
      source_url: dataset.source_url, directory_url: POPULATION_SOURCE.url,
      data_available: true, dataset_id: dataset.id, checked_at: POPULATION_VERIFIED_AT,
    })),
    ...KOSIS_WELFARE_DIRECTORY.map(([listId, title, category, datasetId]): StatisticsCatalogItem => {
      const dataset = KOSIS_DATASETS.find(row => row.id === datasetId);
      const directoryUrl = `https://kosis.kr/statisticsList/statisticsListIndex.do?parentId=${listId}.2&vwcd=MT_ZTITLE&menuId=M_01_01`;
      return { id: "kosis-directory:" + listId, kind: "kosis", title, category, data_provider: "kosis",
        description: dataset ? "KOSIS · " + dataset.description : "KOSIS 복지 주제에 수록된 파일 제공 통계입니다. 원문에서 조사연도별 파일을 확인하세요. 수치표는 이 사이트에 연결하지 않았습니다.",
        source_url: dataset?.source_url ?? directoryUrl, directory_url: directoryUrl,
        data_available: Boolean(dataset), dataset_id: dataset?.id ?? null, checked_at: KOSIS_WELFARE_CHECKED_AT };
    }),
    ...PORTALS.map(([id, title, url, description]): StatisticsCatalogItem => ({ id: "portal:" + id, kind: "portal", title, category: "통계기관", description,
      source_url: url, directory_url: STATISTICS_SOURCES[2].url, data_available: false, dataset_id: null, checked_at: VERIFIED_AT })),
    { id: CITY_POPULATION_DATASET.id, kind: "population", title: CITY_POPULATION_DATASET.title,
      category: CITY_POPULATION_DATASET.category, description: CITY_POPULATION_DATASET.description,
      source_url: CITY_POPULATION_SOURCE, directory_url: CITY_POPULATION_SOURCE,
      data_available: true, dataset_id: CITY_POPULATION_DATASET.id, checked_at: CITY_POPULATION_CHECKED_AT },
  ];
}

export function searchStatistics(options: { query?: string; kind?: CatalogKind; category?: string; data_only?: boolean; offset?: number; limit?: number } = {}, catalog: readonly StatisticsCatalogItem[] = statisticsCatalog()) {
  const query = normalized(options.query ?? "");
  const directoryQuery = /^(?:복지|보건|통계|정보|자료|목록|전체|검색)+$/.test(query);
  const tokens = (options.query ?? "").split(/\s+/).map(normalized).filter(t => t.length > 1 && !["통계", "현황", "알려줘", "보여줘", "연도별", "추이", "최근", "비교해줘", "찾아줘", "수치를"].includes(t) && !/^\d{4}년?$/.test(t));
  const exact = (item: StatisticsCatalogItem) => normalized(item.title).includes(query) || query.includes(normalized(item.title));
  const relevance = (item: StatisticsCatalogItem) => tokens.filter(token => normalized(item.title + item.description + item.category).includes(token)).length;
  const rows = catalog.filter(item => (!options.kind || item.kind === options.kind) && (!options.category || item.category === options.category)
    && (!options.data_only || item.data_available) && (!query || directoryQuery || exact(item) || tokens.some(token => normalized(item.title + item.description + item.category).includes(token))));
  rows.sort((a,b) => Number(b.data_available) - Number(a.data_available) || Number(exact(b)) - Number(exact(a)) || relevance(b) - relevance(a) || a.title.localeCompare(b.title, "ko"));
  const offset = Math.max(0, options.offset ?? 0), limit = Math.min(100, Math.max(1, options.limit ?? 30));
  return { revision: CATALOG_REVISION, checked_at: DIRECTORY_CHECKED_AT, total: rows.length, items: rows.slice(offset, offset + limit), next_offset: offset + limit < rows.length ? offset + limit : null,
    coverage: { scope: "mohw_kosis_welfare_and_mois_population", complete: true, gaps: ["목록 수록과 수치 연결은 다릅니다. data_available=false는 원문 안내만 제공하며 0을 뜻하지 않습니다.", "KOSIS 복지 주제 31종의 목록과 연결한 대표 표만 제공하며 KOSIS 전체 통계표를 포함하지 않습니다.", "공표일정은 관측연도나 실제 공표 완료일이 아닙니다.", "기존 ID 호환을 위해 API 목록은 출처별 항목을 유지합니다. 웹 통합 목록은 같은 통계의 중복 출처를 묶어 보여줍니다."] } };
}

function rawVerifiedStatistics(id: string): StatisticsResult | null {
  const item = statisticsCatalog().find(item => item.id === id);
  const dataset = STATISTICS_DATASETS.find(d => d.id === (item?.dataset_id ?? id));
  if (!dataset) return null;
  if (dataset.population) return {
    dataset, revision: POPULATION_REVISION, verified_at: POPULATION_VERIFIED_AT, checked_at: POPULATION_VERIFIED_AT,
    state: "VERIFIED_SNAPSHOT", warnings: [dataset.note, dataset.source_notes], refresh_error: null, available_periods: dataset.periods,
    coverage: { scope: "national_and_sido_resident_population_selected_age_bands", complete: false,
      gaps: [`${dataset.population.reference_date} 기준 전국·${POPULATION_REGION_COUNT}개 광역시·도의 해당 연령층만 제공합니다. 시·군·구와 다른 기준월은 포함하지 않습니다.`, "mode=verified는 배포 확인본을 고정해 조회합니다. 기본 auto 조회는 서버에 저장된 최신 검증 자료와 자동 확인 상태를 제공합니다."] },
  };
  if (dataset.official_report) return { dataset, revision: "official-report:" + dataset.table_code + ":" + dataset.official_report.checked_at.slice(0, 10), verified_at: dataset.official_report.checked_at, checked_at: dataset.official_report.checked_at, state: "VERIFIED_SNAPSHOT", warnings: [dataset.note, dataset.source_notes], refresh_error: null, available_periods: dataset.periods, coverage: { scope: "official_published_report_selected_indicators", complete: false, gaps: [dataset.official_report.scope, "공식 보고서의 대표 항목만 제공하며 자동 API 갱신 대상이 아닙니다."] } };
  if (dataset.kosis) return {
    dataset, revision: "kosis-public-table:" + dataset.kosis.checked_at.slice(0, 10), verified_at: dataset.kosis.checked_at, checked_at: dataset.kosis.checked_at,
    state: "VERIFIED_SNAPSHOT", warnings: [dataset.note], refresh_error: null, available_periods: dataset.periods,
    coverage: { scope: "kosis_public_table_snapshot", complete: false, gaps: [
      "KOSIS 국가통계포털의 공개 통계표 화면에서 확인한 값입니다. 승인통계마다 대표 통계표를 연결했으며 같은 통계의 다른 표는 원문에서 확인하세요.",
      ...(dataset.kosis.tables.some(table => table.national_only) ? ["전국 합계만 제공합니다. 시·도별 값은 KOSIS 원문 표에서 확인하세요."] : []),
      "mode=verified는 배포 확인본입니다. 기본 조회는 KOSIS API로 검증한 최신 저장 자료와 자동 확인 상태를 제공합니다."] },
  };
  if (dataset.index_api) return { dataset, revision: "index-confirmed:" + dataset.table_code + ":2026-10-11", verified_at: INDEX_CHECKED_AT, checked_at: INDEX_CHECKED_AT,
    state: "VERIFIED_SNAPSHOT", warnings: [dataset.note], refresh_error: null, available_periods: dataset.periods,
    coverage: { scope: "index_selected_statistical_table", complete: false, gaps: ["지표누리 지표별 대표 통계표의 연결된 항목과 기간을 제공합니다. 다른 표와 지역별 세부 자료는 공식 원문에서 확인하세요."] } };
  return { dataset, revision: STATISTICS_REVISION, verified_at: VERIFIED_AT, checked_at: VERIFIED_AT, state: "VERIFIED_SNAPSHOT", warnings: [dataset.note], refresh_error: null, available_periods: dataset.periods,
    coverage: { scope: "national_selected_statistical_table", complete: false, gaps: ["전국 집계 중 연결된 통계표·항목·기간만 제공합니다. 시·군·구 통계나 지표의 다른 표는 포함하지 않습니다."] } };
}

export function statisticsStatus() {
  return { revision: CATALOG_REVISION, status: "PARTIAL", directory_checked_at: DIRECTORY_CHECKED_AT, approved_statistics: APPROVED_STATISTICS.length, indicators: statisticsCatalog().filter(item => item.kind === "indicator").length, portals: PORTALS.length,
    regional_population_tables: REGIONAL_POPULATION_DATASETS.length, population_regions: POPULATION_REGION_COUNT, kosis_tables: KOSIS_DATASETS.length, kosis_checked_at: KOSIS_CHECKED_AT,
    kosis_welfare_statistics: KOSIS_WELFARE_DIRECTORY.length, kosis_welfare_connected: KOSIS_WELFARE_DIRECTORY.filter(row => row[3] !== null).length,
    connected_tables: STATISTICS_DATASETS.length, connected_series: STATISTICS_DATASETS.reduce((sum,d) => sum + d.series.length, 0),
    verified_observations: STATISTICS_DATASETS.reduce((sum,d) => sum + d.series.reduce((n,s) => n + s.points.length, 0), 0),
    datasets: STATISTICS_DATASETS.map(d => ({ id: d.id, title: d.title, periods: d.periods, table_code: d.table_code, source_url: d.source_url,
      ...(d.population ? { population: d.population } : {}), refresh_mode: d.official_report ? "verified_snapshot" : "daily_background" })),
    refresh_policy: STATISTICS_REFRESH_POLICY,
    index_api_tables: Object.keys(INDEX_API_SERIES).length,
    access: "지표누리·KOSIS API는 관리자에 등록한 인증키를 서버에서 사용합니다. 공개 응답에는 키를 포함하지 않습니다. 주민등록인구는 공식 공개 통계표를 확인합니다.",
    warnings: ["목록의 지표·승인통계에 대표 수치를 연결했으며 원문 전체 표를 제공하는 것은 아닙니다.", "승인통계 37종의 공표일정은 관측연도가 아닙니다.", "population:*의 연령별 인구는 전국·16개 광역시·도까지 제공합니다. 별도 city:seogwipo-population은 서귀포시 월말 총인구 확인본이며 시·군·구 연령별 인구는 미수록입니다.", "KOSIS API 확인 실패 시 마지막 정상 수치를 유지합니다. 파일 통계는 원문 안내만 제공합니다.", "일반회계 예산 지표 목록은 기존 복지예산 데이터와 별개이며 합산하지 않습니다."] };
}

export function verifiedStatistics(id: string): StatisticsResult | null {
  const result = rawVerifiedStatistics(id);
  return result ? reviewStatisticsSource(result) : null;
}
