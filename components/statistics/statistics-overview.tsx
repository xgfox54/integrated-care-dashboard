"use client";

import { useState } from "react";
import { RegionalValueChart, StatisticsSeriesChart } from "@/components/statistics/statistics-charts";
import { formatStatistic, populationComposition, statisticChange, statisticChartKind, statisticPeriod, statisticNationalPoint, statisticRegionRows, statisticTitle, usablePoint, VALUE_LABELS } from "@/lib/statistics/presentation";
import type { StatisticsPoint, StatisticsResult, StatisticsSeries } from "@/lib/statistics/types";

const FOCUS = "outline-none focus-visible:shadow-(--jeju-focus-ring)";
export function StatisticsOverview({ result, series, points }: { readonly result: StatisticsResult; readonly series: StatisticsSeries; readonly points: readonly StatisticsPoint[] }) {
  const [basis, setBasis] = useState<"count" | "share">("count");
  const [allRegions, setAllRegions] = useState(false);
  const ordered = [...points].sort((a, b) => a.period.localeCompare(b.period));
  const latest = ordered.at(-1), previous = ordered.at(-2);
  const title = statisticTitle(result.dataset, series), kind = statisticChartKind(ordered);
  const change = result.dataset.source_review?.status === "SOURCE_YEAR_MISMATCH" ? null : statisticChange(ordered, series.unit);
  const composition = populationComposition(result.dataset, series, latest);
  const regions = latest ? statisticRegionRows(result.dataset, series, latest.period) : [];
  const national = latest ? statisticNationalPoint(result.dataset, series, latest.period) : null;
  const canShare = Boolean(result.dataset.population && regions.some(row => row.share !== null));
  const regionUnit = basis === "share" && canShare ? "%" : series.unit;
  const ranked = regions.map(row => ({ ...row, value: basis === "share" && canShare ? row.share : row.value, status: basis === "share" && canShare && row.share === null ? "MISSING" as const : row.status })).sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
  const shown = allRegions ? ranked : ranked.slice(0, 5);
  const direction = change ? change.difference > 0 ? "증가" : change.difference < 0 ? "감소" : "변화 없음" : "";
  const delta = change ? `${formatStatistic(Math.abs(change.difference))} ${change.percentPoints ? "%p" : series.unit}` : "";
  return <section aria-label="통계 요약" className="mt-4 min-w-0 space-y-4">
    <div><h4 className="text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)">{title}</h4><p className="mt-1 text-(length:--jeju-text-sm) text-muted-foreground">{latest ? statisticPeriod(latest.period) + " 기준" : "선택한 기간에 자료 없음"} · 단위: {series.unit}{result.dataset.population ? ` · ${result.dataset.population.population_scope}` : ""}</p></div>
    <dl className="grid min-w-0 gap-3 sm:grid-cols-3">
      <div className="min-w-0 rounded-(--jeju-radius) bg-(--jeju-primary-tint) p-4"><dt className="text-(length:--jeju-text-sm) font-bold text-muted-foreground">최근 시점 수치</dt><dd className="mt-2 break-words text-(length:--jeju-text-2xl) font-extrabold tabular-nums text-(--jeju-text-strong)">{latest && usablePoint(latest) ? formatStatistic(latest.value!) : latest ? VALUE_LABELS[latest.status] : "자료 없음"}<span className="ml-1 text-(length:--jeju-text-sm) font-normal">{latest && usablePoint(latest) ? series.unit : ""}</span></dd>{latest && latest.status !== "VALUE" && <p className="mt-1 text-(length:--jeju-text-sm)">{VALUE_LABELS[latest.status]}</p>}</div>
      <div className="min-w-0 rounded-(--jeju-radius) bg-(--jeju-surface-inset) p-4"><dt className="text-(length:--jeju-text-sm) font-bold text-muted-foreground">{composition ? "해당 지역 총인구 대비" : "직전 수록 시점"}</dt><dd className="mt-2 break-words text-(length:--jeju-text-xl) font-extrabold tabular-nums">{composition ? `${composition.share.toFixed(1)}%` : previous && usablePoint(previous) ? `${formatStatistic(previous.value!)} ${series.unit}` : "비교 자료 없음"}</dd><p className="mt-1 text-(length:--jeju-text-xs) text-muted-foreground">{composition ? `전체 인구 ${formatStatistic(composition.total)}명` : previous ? statisticPeriod(previous.period) : "이전 시점이 수록되지 않았습니다."}</p></div>
      <div className="min-w-0 rounded-(--jeju-radius) bg-(--jeju-surface-inset) p-4"><dt className="text-(length:--jeju-text-sm) font-bold text-muted-foreground">{latest?.period.length === 7 ? "전월 대비" : "전년 대비"}</dt><dd className="mt-2 break-words text-(length:--jeju-text-xl) font-extrabold tabular-nums">{change ? change.difference === 0 ? "변화 없음" : `${delta} ${direction}` : "비교 불가"}</dd><p className="mt-1 text-(length:--jeju-text-sm) text-muted-foreground">{change ? change.percentPoints ? "비율의 차이이며 단위는 %p입니다." : change.rate !== null ? `증감률 ${change.rate > 0 ? "+" : ""}${change.rate.toFixed(1)}%` : "이전 값이 0 이하라 증감률은 계산하지 않습니다." : "연속된 이전 시점의 수치가 있어야 비교합니다."}</p></div>
    </dl>
    <p className="text-(length:--jeju-text-sm) leading-relaxed text-(--jeju-text-body)">{latest && usablePoint(latest) ? `${statisticPeriod(latest.period)} 기준 ${formatStatistic(latest.value!)} ${series.unit}입니다.` : "최근 시점에 표시할 수치가 없습니다."} {change ? `${statisticPeriod(change.previous.period)} 대비 ${change.difference === 0 ? "수치가 같습니다." : `${delta} ${direction}했습니다.`}` : "현재 수록 범위로는 전년·전월 대비 변화를 판단하지 않습니다."} 증감 수치만으로 원인을 판단하지 않습니다.</p>
    {national && <p className="rounded-(--jeju-radius) bg-(--jeju-surface-inset) p-3 text-(length:--jeju-text-sm)">같은 시점 전국 집계: <strong>{usablePoint(national) ? `${formatStatistic(national.value!)} ${series.unit}` : VALUE_LABELS[national.status]}</strong>{national.status !== "VALUE" && usablePoint(national) ? ` · ${VALUE_LABELS[national.status]}` : ""}</p>}
    {previous && previous.status !== "VALUE" && <p className="text-(length:--jeju-text-sm) text-muted-foreground">직전 시점 {statisticPeriod(previous.period)}: {VALUE_LABELS[previous.status]}. 증감 해석 시 함께 확인하세요.</p>}
    {composition && <figure aria-label={`${title}의 총인구 대비 구성비`} className="space-y-2"><figcaption className="text-(length:--jeju-text-sm) font-bold">전체 인구 중 {result.dataset.population?.age_label} 비중 {composition.share.toFixed(1)}%</figcaption><div aria-hidden="true" className="flex h-5 overflow-hidden rounded-sm bg-(--jeju-surface-inset)"><span className="bg-primary" style={{ width: `${composition.share}%` }} /><span className="flex-1 bg-(--jeju-border-strong)" /></div><p className="text-(length:--jeju-text-xs) text-muted-foreground">해당 연령 {composition.share.toFixed(1)}% · 그 외 연령 {(100 - composition.share).toFixed(1)}%. 같은 지역·시점의 총인구를 기준으로 합니다.</p></figure>}
    {kind === "single" && regions.length ? <div className="space-y-3 rounded-(--jeju-radius) border border-border p-4">
      <p className="text-(length:--jeju-text-sm) text-muted-foreground">한 시점의 지역별 현황입니다. 전국 집계는 지역 순위에 포함하지 않습니다.</p>
      {canShare && <div role="group" aria-label="요약 지역 비교 기준" className="flex flex-wrap gap-2">{([["count", "인구 수"], ["share", "지역 내 비중"]] as const).map(([id, text]) => <button key={id} type="button" aria-pressed={basis === id} onClick={() => setBasis(id)} className={`min-h-11 rounded-(--jeju-radius) border border-border px-3 text-(length:--jeju-text-sm) font-bold ${basis === id ? "bg-(--jeju-primary-tint) text-primary" : "bg-card"} ${FOCUS}`}>{text}</button>)}</div>}
      <RegionalValueChart rows={shown} unit={regionUnit} title={`${title.replace(/^전국\s+/, "")} 지역별 ${regionUnit === "%" ? "비중" : "규모"}${allRegions ? "" : " 상위 5개"}`} />
      {ranked.length > 5 && <button type="button" aria-expanded={allRegions} onClick={() => setAllRegions(value => !value)} className={`min-h-11 rounded-(--jeju-radius) px-2 text-(length:--jeju-text-sm) font-bold text-primary underline underline-offset-4 ${FOCUS}`}>{allRegions ? "상위 5개만 보기" : `전체 ${ranked.length}개 지역 보기`}</button>}
    </div> : <StatisticsSeriesChart points={ordered} label={title} unit={series.unit} />}
    <p className="text-(length:--jeju-text-xs) leading-relaxed text-muted-foreground">출처: <a href={series.source_url ?? result.dataset.source_url} target="_blank" rel="noopener noreferrer" className={`font-bold text-primary underline underline-offset-4 ${FOCUS}`}>{result.dataset.source_name} 원문 보기 (새 창)</a> · {result.dataset.table_title}</p>
    {result.dataset.note && <p className="text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">해석 안내: {result.dataset.note}</p>}
  </section>;
}
