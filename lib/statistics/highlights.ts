import type { StatisticsSeries } from "./types.ts";

interface StatisticsHighlight {
  readonly dataset_id: string;
  readonly series_id: string;
  readonly title: string;
  readonly scope: string;
  readonly related?: { readonly dataset_id: string; readonly note: string };
}

export const STATISTICS_HIGHLIGHTS: readonly StatisticsHighlight[] = [
  { dataset_id: "kosis:basic-livelihood", series_id: "row-1", title: "국민기초생활보장 수급자", scope: "전국 · 일반·시설 수급자 합계", related: { dataset_id: "stat:2760", note: "KOSIS는 명, 지표누리는 천명 단위입니다. 각 원자료의 정밀도를 유지합니다." } },
  { dataset_id: "kosis:older-facilities", series_id: "row-1", title: "노인복지시설 수", scope: "전국 · 노인복지시설 총계", related: { dataset_id: "stat:2766", note: "같은 주제의 지표누리 통계입니다. 시설 구분과 자료 기준연도를 함께 확인하세요." } },
  { dataset_id: "kosis:registered-disabled", series_id: "row-1", title: "등록장애인 수", scope: "전국 · 장애유형·성별 원표 합계", related: { dataset_id: "stat:2768", note: "등록장애인 수를 다루는 지표누리 통계입니다. 원표의 기준연도와 집계 범위를 확인하세요." } },
  { dataset_id: "kosis:long-term-care-insurance", series_id: "row-1", title: "장기요양 등급판정 인원", scope: "전국 · 등급외 포함, 인정자 수와 구분" },
  { dataset_id: "kosis:childcare-users", series_id: "row-9", title: "어린이집 이용 아동", scope: "전국 · 보육아동 합계, 시설 수와 구분" },
  { dataset_id: "kosis:protected-children", series_id: "row-1", title: "보호대상아동 발생수", scope: "전국 · 원표의 보호대상아동 발생 인원" },
  { dataset_id: "kosis:national-pension", series_id: "row-1", title: "국민연금 급여 수급자", scope: "전국 · 일시금 포함 급여종류별 계", related: { dataset_id: "stat:2709", note: "KOSIS는 급여종류별 계(일시금 포함), 지표누리는 수급자 현황(누적)입니다. 집계 범위를 구분해 조회하세요." } },
  { dataset_id: "kosis:social-expenditure", series_id: "row-2", title: "공공 사회복지지출 비율", scope: "GDP 대비 · 공공지출", related: { dataset_id: "stat:2759", note: "관련 지표누리 지출 통계입니다. 공공지출 항목·단위·수록시점을 대조해 확인하세요." } },
] as const;

export const STATISTICS_HIGHLIGHT_IDS: ReadonlySet<string> = new Set(STATISTICS_HIGHLIGHTS.map(card => card.dataset_id));

export function statisticsYearChange(series: StatisticsSeries): { readonly value: number; readonly unit: "%" | "%p" } | null {
  const current = series.points.at(-1), previous = series.points.at(-2);
  if (!current || !previous || current.value === null || previous.value === null
    || !/^\d{4}$/.test(current.period) || !/^\d{4}$/.test(previous.period)
    || Number(current.period) !== Number(previous.period) + 1) return null;
  if (series.unit === "%") return { value: current.value - previous.value, unit: "%p" };
  return previous.value > 0 ? { value: (current.value - previous.value) / previous.value * 100, unit: "%" } : null;
}
