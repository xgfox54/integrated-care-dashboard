import { comparisonPoint, statisticsComparisonGroups } from "./comparison.ts";
import { STATISTICS_HIGHLIGHTS } from "./highlights.ts";
import type { StatisticsDataset, StatisticsPoint, StatisticsSeries } from "./types.ts";

export const VALUE_LABELS = { VALUE: "수록값", PROVISIONAL: "잠정치", ESTIMATE: "추정치", MISSING: "자료 없음", CONFIDENTIAL: "비공개" } as const;
const FORMAT = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 });
export function formatStatistic(value: number): string { return FORMAT.format(value); }
export function statisticPeriod(period: string): string {
  return /^\d{4}-\d{2}$/.test(period) ? `${period.slice(0, 4)}년 ${Number(period.slice(5))}월` : /^\d{4}$/.test(period) ? `${period}년` : period;
}
export function invalidStatisticRange(from: string, to: string): boolean {
  return Boolean(from && to && from > (to.length === 4 ? `${to}-12` : to));
}
export function statisticPointsInRange(points: readonly StatisticsPoint[], from: string, to: string): readonly StatisticsPoint[] {
  if (invalidStatisticRange(from, to)) return [];
  return points.filter(point => (!from || point.period >= from) && (!to || point.period <= (to.length === 4 ? `${to}-12` : to)));
}
export function usablePoint(point: StatisticsPoint): boolean {
  return point.value !== null && Number.isFinite(point.value) && point.status !== "MISSING" && point.status !== "CONFIDENTIAL";
}
export function adjacentPeriods(previous: string, current: string): boolean {
  if (/^\d{4}$/.test(previous) && /^\d{4}$/.test(current)) return Number(current) === Number(previous) + 1;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(previous) && /^\d{4}-(0[1-9]|1[0-2])$/.test(current)) {
    const index = (period: string) => Number(period.slice(0, 4)) * 12 + Number(period.slice(5));
    return index(current) === index(previous) + 1;
  }
  return false;
}
export function statisticChange(points: readonly StatisticsPoint[], unit: string) {
  const ordered = [...points].sort((a, b) => a.period.localeCompare(b.period));
  const current = ordered.at(-1), previous = ordered.at(-2);
  if (!current || !previous || !usablePoint(current) || !usablePoint(previous) || !adjacentPeriods(previous.period, current.period)) return null;
  const difference = current.value! - previous.value!;
  return { current, previous, difference, rate: previous.value! > 0 ? difference / previous.value! * 100 : null, percentPoints: unit.trim() === "%" };
}
export function statisticChartKind(points: readonly StatisticsPoint[]): "empty" | "single" | "columns" | "line" {
  const count = points.filter(usablePoint).length;
  return count === 0 ? "empty" : count === 1 ? "single" : count === 2 ? "columns" : "line";
}
export function statisticTitle(dataset: StatisticsDataset, series: StatisticsSeries): string {
  const highlight = STATISTICS_HIGHLIGHTS.find(item => item.dataset_id === dataset.id && item.series_id === series.id);
  return highlight ? `${series.region?.name ?? (series.label.startsWith("전국") ? "전국" : "")} ${highlight.title}`.trim() : dataset.population ? `${series.region?.name ?? ""} ${dataset.population.age_label} 인구`.trim() : series.label.replace(/^전국 \/ 계$/, "전국 합계");
}
export function populationComposition(dataset: StatisticsDataset, series: StatisticsSeries, point: StatisticsPoint | undefined) {
  if (!dataset.population || !point || !usablePoint(point) || point.total_population === undefined || !Number.isFinite(point.total_population) || point.total_population <= 0 || point.value! < 0 || point.value! > point.total_population) return null;
  return { value: point.value!, total: point.total_population, share: point.value! / point.total_population * 100 };
}
export function statisticRegionRows(dataset: StatisticsDataset, series: StatisticsSeries, period: string) {
  const group = statisticsComparisonGroups(dataset).find(group => group.regions.some(row => row.series.id === series.id));
  if (!group) return [];
  return group.regions.filter(row => row.name !== "전국" && row.series.region?.level !== "national").map(row => {
    const point = comparisonPoint(row.series, period);
    const composition = populationComposition(dataset, row.series, point);
    return { id: row.series.id, name: row.name, value: usablePoint(point) ? point.value : null, share: composition?.share ?? null, status: point.status };
  });
}

export function statisticNationalPoint(dataset: StatisticsDataset, series: StatisticsSeries, period: string) {
  const group = statisticsComparisonGroups(dataset).find(group => group.regions.some(row => row.series.id === series.id));
  const national = group?.regions.find(row => row.name === "전국" || row.series.region?.level === "national");
  return national && national.series.id !== series.id ? comparisonPoint(national.series, period) : null;
}
