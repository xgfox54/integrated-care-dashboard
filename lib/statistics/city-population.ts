import type { StatisticsDataset } from "./types.ts";

export const CITY_POPULATION_SOURCE = "https://www.jeju.go.kr/livingpopulation/jeju/jumin.htm?year=2026";
export const CITY_POPULATION_CHECKED_AT = "2026-10-12T04:21:20.000Z";
const residents = [179232, 179000, 178794, 178898, 178798, 178669, 178569, 178532, 178294] as const;
const periods = residents.map((_, index) => `2026-${String(index + 1).padStart(2, "0")}`);

export const CITY_POPULATION_DATASET: StatisticsDataset = {
  id: "city:seogwipo-population", indicator_code: "", table_code: "jeju-resident-population-2026",
  category: "인구", title: "서귀포시 주민등록인구",
  description: "서귀포시 2026년 1~9월 내국인 주민등록인구. 외국인을 제외한 전체 연령 인구입니다.",
  note: "제주특별자치도 공식 월별 표의 내국인 행을 확인한 고정 자료입니다. 기준월과 원문 확인일은 다르며 자동 갱신 대상이 아닙니다.",
  highlight_series_id: "region:5013000000", original_unit: "명", table_title: "서귀포시 주민등록인구 (내국인)",
  source_url: CITY_POPULATION_SOURCE, indicator_url: CITY_POPULATION_SOURCE,
  source_name: "제주특별자치도 인구정책 통합플랫폼 · 행정안전부 주민등록통계",
  source_notes: "2026년 월별 표의 서귀포시 내국인 행입니다. 9월 값은 공식 내려받기 자료의 기준일 2026.9.30, 인구현황(외국인포함) 시트 K33 주민등록인구 178,294명과 대조했습니다. 외국인 9,914명 및 외국인 포함 합계 188,208명과 구분합니다. 내려받기: https://www.jeju.go.kr/stats/stats/download.htm?act=download&year=2026&month=9",
  periods,
  series: [{ id: "region:5013000000", label: "서귀포시", source_label: "서귀포시 / 내국인", unit: "명",
    region: { code: "5013000000", name: "서귀포시", level: "sigungu", parent_code: "5000000000" },
    points: residents.map((value, index) => ({ period: periods[index], value, raw: String(value), status: "VALUE" })),
  }],
  official_report: { checked_at: CITY_POPULATION_CHECKED_AT, published_at: "",
    scope: "서귀포시 전체 연령 주민등록인구 2026년 1~9월만 제공합니다. 연령별·다른 시군구·다른 기준월은 포함하지 않으며 공표일은 확인하지 못했습니다." },
};
