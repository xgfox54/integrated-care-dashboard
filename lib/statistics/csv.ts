import type { StatisticsResult } from "./types.ts";
import { comparisonPeriods, comparisonPoint, statisticsComparisonGroups } from "./comparison.ts";

const STATES = { VALUE: "수록값", MISSING: "자료 없음", CONFIDENTIAL: "비공개", PROVISIONAL: "잠정치", ESTIMATE: "추정치" };
function cell(value: string, numeric = false): string {
  const safeNumber = numeric && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value) && Number.isFinite(Number(value));
  const protectedValue = !safeNumber && /^[\s\uFEFF]*[=+@\-\t\r]/.test(value) ? "'" + value : value;
  return '"' + protectedValue.replace(/"/g, '""') + '"';
}

export function statisticsCsv(result: StatisticsResult, seriesId: string, periods: readonly string[]): string | null {
  const series = result.dataset.series.find(row => row.id === seriesId);
  if (!series) return null;
  const rows = [["통계명", "항목", "연도", "수치", "원문값", "단위", "상태", "원문", "확인시각"].map(value => cell(value)).join(",")];
  for (const point of series.points.filter(point => periods.includes(point.period))) {
    rows.push([cell(result.dataset.title), cell(series.label), cell(point.period),
      cell(point.value === null ? "" : String(point.value), true), cell(point.raw), cell(series.unit),
      cell(STATES[point.status]), cell(series.source_url ?? result.dataset.source_url), cell(result.checked_at)].join(","));
  }
  return "\uFEFF" + rows.join("\r\n");
}

export function statisticsComparisonCsv(result: StatisticsResult, groupId: string, seriesIds: readonly string[], from = "", to = ""): string | null {
  const group = statisticsComparisonGroups(result.dataset).find(group => group.id === groupId);
  if (!group) return null;
  const selected = new Set(seriesIds.slice(0, 4));
  const regions = group.regions.filter(row => selected.has(row.series.id));
  const periods = comparisonPeriods(group, from, to);
  if (!regions.length || !periods.length) return null;
  const rows = [["통계명", "비교항목", "지역", "시점", "수치", "원문값", "단위", "상태", "원문항목", "출처", "원문", "확인시각", "자료기준일", "집계범위"].map(value => cell(value)).join(",")];
  for (const period of [...periods].reverse()) for (const row of regions) {
    const point = comparisonPoint(row.series, period);
    rows.push([cell(result.dataset.title), cell(group.label), cell(row.name), cell(period),
      cell(point.value === null ? "" : String(point.value), true), cell(point.raw), cell(row.series.unit), cell(STATES[point.status]),
      cell(row.series.label), cell(result.dataset.source_name), cell(row.series.source_url ?? group.source_url), cell(result.checked_at),
      cell(result.dataset.population?.reference_date ?? ""), cell(result.dataset.population?.population_scope ?? result.dataset.note)].join(","));
  }
  return "\uFEFF" + rows.join("\r\n");
}
