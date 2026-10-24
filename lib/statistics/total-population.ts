import type { StatisticsDataset } from "./types.ts";

export function totalPopulationDataset(source: StatisticsDataset): StatisticsDataset {
  return {
    ...source,
    id: "population:total", indicator_code: "mois-total", table_code: "ageStatMonth.do",
    title: "전체 인구수", category: "인구", table_title: "지역별 전체 인구수 (주민등록 기준)",
    description: `전국과 광역시·도의 전체 연령 주민등록인구. 기준일 ${source.population?.reference_date ?? "미확인"}.`,
    note: "월말 전체 연령 주민등록인구입니다. 거주자·거주불명자·재외국민을 포함하고 외국인은 제외합니다. 비중의 분모는 같은 지역·월의 전체 연령 주민등록인구입니다.",
    source_url: "https://jumin.mois.go.kr/ageStatMonth.do",
    indicator_url: "https://jumin.mois.go.kr/ageStatMonth.do",
    ...(source.population ? { population: {
      ...source.population, age_min: 0, age_max: null, age_label: "전체 연령",
      calculation: "행정안전부 연령별 인구현황의 총인구수를 그대로 사용합니다. 연령층 인구를 합산하거나 추정하지 않습니다.",
      source_urls: [{ title: "연령별 인구현황", url: "https://jumin.mois.go.kr/ageStatMonth.do" }],
    } } : {}),
    series: source.series.map(series => ({ ...series, points: series.points.map(point => {
      const value = point.total_population ?? null;
      return { ...point, value, raw: value === null ? "-" : String(value), status: value === null ? "MISSING" : "VALUE" };
    }) })),
  };
}
