import { POPULATION_SNAPSHOT } from "./population-verified.ts";
import type { StatisticsDataset } from "./types.ts";

export interface PopulationSexCounts { readonly total: number; readonly male: number; readonly female: number }
export interface PopulationSnapshotRecord {
  readonly regionCode: string; readonly region: string; readonly level: "national" | "sido";
  readonly totalPopulation: number; readonly malePopulation: number; readonly femalePopulation: number;
  readonly middleAged: PopulationSexCounts; readonly elderly: PopulationSexCounts; readonly children: PopulationSexCounts;
  readonly sourceAgeUnder40: PopulationSexCounts;
}
export interface PopulationSnapshot {
  readonly period: string; readonly referenceDate: string; readonly checkedAt: string; readonly coverage: string;
  readonly records: readonly PopulationSnapshotRecord[];
}
export const POPULATION_PAGE_URLS = {
  age: "https://jumin.mois.go.kr/ageStatMonth.do",
  older: "https://jumin.mois.go.kr/etcStatOldAge.do",
  children: "https://jumin.mois.go.kr/etcStatChYouth.do",
} as const;

export const POPULATION_VERIFIED_AT = POPULATION_SNAPSHOT.checkedAt;
export const POPULATION_REVISION = "mois-population-2026-09-verified-2026-10-10";
export const POPULATION_REGION_COUNT = POPULATION_SNAPSHOT.records.filter(row => row.level === "sido").length;
export const POPULATION_SOURCE = {
  id: "mois-population", title: "행정안전부 주민등록 인구통계",
  url: "https://jumin.mois.go.kr/ageStatMonth.do",
  scope: `전국·${POPULATION_REGION_COUNT}개 광역시·도의 전체 인구수·중장년층·노년층·아동 인구와 비중 · 월별 공표자료 자동 확인`,
  checked_at: POPULATION_VERIFIED_AT,
} as const;

const SOURCES = {
  age: { title: "연령별 인구현황", url: POPULATION_PAGE_URLS.age },
  older: { title: "지역별 고령 인구현황", url: POPULATION_PAGE_URLS.older },
  children: { title: "지역별 아동·청소년·청년 인구현황", url: POPULATION_PAGE_URLS.children },
} as const;

const GROUPS = [
  { id: "middle-aged", key: "middleAged", title: "지역별 중장년층 인구", category: "중장년", min: 40, max: 64, label: "만 40~64세", table: "ageStatMonth.do + etcStatOldAge.do",
    calculation: "같은 기준월·지역의 총인구에서 0~39세 인구와 65세 이상 인구를 뺀 값입니다. 0~39세는 0~9세·10~19세·20~29세·30~39세를 합산했습니다. 연령구간을 분할 추정하지 않았습니다.",
    sources: [SOURCES.age, SOURCES.older] },
  { id: "older", key: "elderly", title: "지역별 노년층 인구", category: "노인", min: 65, max: null, label: "만 65세 이상", table: "etcStatOldAge.do",
    calculation: "행정안전부 지역별 고령 인구현황의 65세 이상 인구를 그대로 사용합니다.", sources: [SOURCES.older] },
  { id: "children", key: "children", title: "지역별 아동 인구", category: "아동", min: 0, max: 17, label: "만 0~17세", table: "etcStatChYouth.do",
    calculation: "행정안전부 지역별 아동·청소년·청년 인구현황의 아동(0~17세) 값을 그대로 사용합니다. 원문의 아동 기준은 18세 미만입니다.", sources: [SOURCES.children] },
] as const;

/** Shared by the immutable release snapshot and the all-or-nothing monthly refresh. */
export function buildPopulationDatasets(snapshot: PopulationSnapshot): readonly StatisticsDataset[] {
  if (!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(snapshot.period) || !/^20\d{2}-(?:0[1-9]|1[0-2])-\d{2}$/.test(snapshot.referenceDate)) throw new Error("인구 기준월·기준일 형식이 올바르지 않습니다.");
  const [year, month] = snapshot.period.split("-").map(Number);
  const periodLabel = `${year}년 ${month}월`;
  const referenceLabel = snapshot.referenceDate.split("-").map(Number).map((part, index) => `${part}${["년", "월", "일"][index]}`).join(" ");
  const regionCount = snapshot.records.filter(row => row.level === "sido").length;
  return GROUPS.map(group => ({
  id: "population:" + group.id, indicator_code: "mois-" + group.id, table_code: group.table,
  category: group.category, title: group.title,
  description: `전국과 ${regionCount}개 광역시·도의 ${group.label} 주민등록인구 및 해당 지역 총인구 대비 비중. 기준일 ${referenceLabel}.`,
  note: `${periodLabel} 말 주민등록인구 확인본입니다. ${group.label} 기준이며 거주자·거주불명자·재외국민을 포함하고 외국인은 제외합니다. 비중의 분모는 같은 지역·월의 전체 연령 주민등록인구입니다.`,
  highlight_series_id: "region:0000000000", original_unit: "명", table_title: group.title + " (주민등록 기준)",
  source_url: group.sources[0].url, indicator_url: group.sources[0].url, source_name: "행정안전부 주민등록 인구통계",
  source_notes: `매월 말일 기준입니다. 관측일(${snapshot.referenceDate})과 원문 확인일은 다릅니다. 이번 연결 범위는 전국과 ${regionCount}개 광역시·도이며 시·군·구와 다른 기준월은 포함하지 않습니다. 공식 월별 공표자료를 자동 확인하고 세 원문의 검증이 모두 통과하면 함께 갱신합니다. 확인에 실패하면 마지막 정상 확인본을 유지합니다.`,
  periods: [snapshot.period],
  population: { reference_date: snapshot.referenceDate, age_min: group.min, age_max: group.max, age_label: group.label,
    population_scope: snapshot.coverage, calculation: group.calculation, source_urls: group.sources },
  series: snapshot.records.map(row => ({
    id: "region:" + row.regionCode, label: row.region, source_label: row.region, unit: "명",
    region: { code: row.regionCode, name: row.region, level: row.level, parent_code: row.level === "national" ? null : "0000000000" },
    points: [{ period: snapshot.period, value: row[group.key].total, raw: String(row[group.key].total), status: "VALUE" as const, total_population: row.totalPopulation }],
  })),
}));
}

export const POPULATION_DATASETS = buildPopulationDatasets(POPULATION_SNAPSHOT);
