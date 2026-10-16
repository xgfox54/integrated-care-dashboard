import type { StatisticsResult } from "./types.ts";

const STATES = { VALUE: "수록값", MISSING: "자료 없음", CONFIDENTIAL: "비공개", PROVISIONAL: "잠정치", ESTIMATE: "추정치" };
function cell(value: string, numeric = false): string {
  const safeNumber = numeric && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value) && Number.isFinite(Number(value));
  const protectedValue = !safeNumber && /^[=+@\-\t\r]/.test(value) ? "'" + value : value;
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
