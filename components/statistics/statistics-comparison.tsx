"use client";

import { useId, useMemo } from "react";
import { RegionalValueChart, StatisticsSeriesChart } from "@/components/statistics/statistics-charts";
import { comparisonPeriods, comparisonPoint, defaultComparisonRegions, statisticsComparisonGroups } from "@/lib/statistics/comparison";
import type { ComparisonRegion, StatisticsComparisonGroup } from "@/lib/statistics/comparison";
import type { StatisticsResult } from "@/lib/statistics/types";
import type { StatisticsComparisonChoice } from "@/lib/statistics/explorer-state";
import { statisticsComparisonCsv } from "@/lib/statistics/csv";

const FOCUS = "outline-none focus-visible:shadow-(--jeju-focus-ring)";
const CONTROL = "min-h-(--jeju-control-h) rounded-(--jeju-radius) border border-border bg-card px-3 py-2 text-(length:--jeju-text-sm) " + FOCUS;
const STATUS = { VALUE: "수록값", PROVISIONAL: "잠정치", ESTIMATE: "추정치", MISSING: "자료 없음", CONFIDENTIAL: "비공개" };
const COLORS = ["var(--jeju-blue)", "var(--jeju-green-dark)", "var(--jeju-orange-dark)", "var(--jeju-blue-deep)"];
const FORMAT = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 });
function periodLabel(period: string): string { return /^\d{4}$/.test(period) ? `${period}년` : /^\d{4}-\d{2}$/.test(period) ? `${period.slice(0, 4)}년 ${Number(period.slice(5))}월` : period; }

export function StatisticsComparison({ result, choice, onChange }: { readonly result: StatisticsResult; readonly choice: StatisticsComparisonChoice | null; readonly onChange: (choice: StatisticsComparisonChoice) => void }) {
  const groups = useMemo(() => statisticsComparisonGroups(result.dataset), [result.dataset]);
  if (!groups.length) return result.dataset.kosis ? <p className="mt-5 rounded-(--jeju-radius) bg-(--jeju-surface-inset) p-4 text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">현재 연결된 항목에는 비교 가능한 시·도별 자료가 없습니다. 아래에서 수록된 항목의 연도별 추이를 조회할 수 있습니다.</p> : null;
  return <ComparisonPanel groups={groups} result={result} choice={choice?.dataset === result.dataset.id ? choice : null} onChange={onChange} />;
}

function ComparisonPanel({ groups, result, choice, onChange }: { readonly groups: readonly StatisticsComparisonGroup[]; readonly result: StatisticsResult; readonly choice: StatisticsComparisonChoice | null; readonly onChange: (choice: StatisticsComparisonChoice) => void }) {
  const id = useId();
  const group = groups.find(group => group.regions[0]?.series.id === choice?.group) ?? groups[0];
  const selection = choice?.regions ?? defaultComparisonRegions(group);
  const allPeriods = comparisonPeriods(group);
  const from = choice?.from && allPeriods.includes(choice.from) ? choice.from : "";
  const to = choice?.to && allPeriods.includes(choice.to) ? choice.to : "";
  const periods = comparisonPeriods(group, from, to);
  const selected = group.regions.filter(row => selection.includes(row.series.id)).slice(0, 4);
  const invalid = Boolean(from && to && from > to);
  const latest = periods.at(-1);
  const periodUnit = result.dataset.population ? "시점" : "연도";
  const nationalRegion = group.regions.find(row => row.name === "전국" || row.series.region?.level === "national");
  const hasNational = Boolean(nationalRegion && selected.some(row => row.series.id === nationalRegion.series.id));

  function update(patch: Partial<StatisticsComparisonChoice>) {
    onChange({ dataset: result.dataset.id, group: group.regions[0].series.id, regions: selected.map(row => row.series.id), from, to, ...patch });
  }

  function toggleNational() {
    if (!nationalRegion) return;
    if (hasNational) {
      const withoutNational = selected.filter(row => row.series.id !== nationalRegion.series.id).map(row => row.series.id);
      const fallbackRegions = group.regions.filter(row => row.series.id !== nationalRegion.series.id);
      const jeju = fallbackRegions.find(row => row.name === "제주" || row.name === "제주특별자치도");
      const firstOther = fallbackRegions.find(row => row.series.id !== jeju?.series.id);
      const nextRegions = withoutNational.length >= 2
        ? withoutNational
        : [...new Set([...withoutNational, ...(jeju ? [jeju.series.id] : []), ...(firstOther ? [firstOther.series.id] : [])])].slice(0, 4);
      update({ regions: nextRegions });
    } else {
      update({ regions: [nationalRegion.series.id, ...selected.map(row => row.series.id)].slice(0, 4) });
    }
  }

  function download() {
    const csv = statisticsComparisonCsv(result, group.id, selected.map(row => row.series.id), from, to);
    if (csv === null) return;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${result.dataset.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-comparison-${periods[0]}-${periods.at(-1)}.csv`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function changeGroup(nextId: string) {
    const next = groups.find(group => group.id === nextId);
    if (!next) return;
    const names = new Set(selected.map(row => row.name));
    const retained = next.regions.filter(row => names.has(row.name)).map(row => row.series.id);
    update({ group: next.regions[0].series.id, regions: retained, from: "", to: "" });
  }

  return <section id="statistics-comparison" aria-labelledby={`${id}-heading`} className="mt-5 min-w-0 space-y-4 rounded-(--jeju-radius-lg) border border-border bg-card p-4 sm:p-5">
    <div><h4 id={`${id}-heading`} className="font-extrabold text-(--jeju-text-strong)">지역·{periodUnit} 비교</h4><p className="mt-1 text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">같은 통계표·항목·단위의 지역 자료를 최대 4개까지 비교합니다. 전국 집계는 요약 수치로 따로 표시하며 지역별 차트에서 제외합니다.</p></div>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <div className="min-w-0 sm:col-span-2"><label htmlFor={`${id}-measure`} className="mb-1.5 block text-(length:--jeju-text-sm) font-bold">비교 항목</label><select id={`${id}-measure`} data-comparison="measure" value={group.id} onChange={event => changeGroup(event.target.value)} className={`${CONTROL} w-full min-w-0`}>{groups.map(row => <option key={row.id} value={row.id}>{row.label} ({row.unit})</option>)}</select></div>
      <div><label htmlFor={`${id}-from`} className="mb-1.5 block text-(length:--jeju-text-sm) font-bold">비교 시작{periodUnit}</label><select id={`${id}-from`} data-comparison="from" value={from} onChange={event => update({ from: event.target.value })} className={`${CONTROL} w-full`}><option value="">전체</option>{allPeriods.map(period => <option key={period} value={period}>{periodLabel(period)}</option>)}</select></div>
      <div><label htmlFor={`${id}-to`} className="mb-1.5 block text-(length:--jeju-text-sm) font-bold">비교 종료{periodUnit}</label><select id={`${id}-to`} data-comparison="to" value={to} onChange={event => update({ to: event.target.value })} className={`${CONTROL} w-full`}><option value="">전체</option>{allPeriods.map(period => <option key={period} value={period}>{periodLabel(period)}</option>)}</select></div>
    </div>
    <fieldset className="min-w-0"><legend className="mb-2 text-(length:--jeju-text-sm) font-bold">비교 지역</legend><div className="flex flex-wrap gap-2">{group.regions.map(row => {
      const checked = selection.includes(row.series.id);
      const disabled = !checked && selected.length >= 4;
      return <label key={row.series.id} className={`flex min-h-(--jeju-control-h) max-w-full items-center gap-2 rounded-(--jeju-radius) border border-border px-3 py-2 text-(length:--jeju-text-sm) ${checked ? "bg-(--jeju-primary-tint) font-bold text-primary" : "bg-card text-(--jeju-text-body)"} ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}><input type="checkbox" checked={checked} disabled={disabled} onChange={() => update({ regions: checked ? selected.filter(value => value.series.id !== row.series.id).map(value => value.series.id) : selected.length < 4 ? [...selected.map(value => value.series.id), row.series.id] : selected.map(value => value.series.id) })} className={`size-4 shrink-0 accent-(--jeju-primary) ${FOCUS}`} /><span className="min-w-0 break-keep">{row.name}</span></label>;
    })}</div></fieldset>
    <div className="flex flex-wrap items-center justify-between gap-2"><p role="status" aria-live="polite" className="text-(length:--jeju-text-sm) text-muted-foreground">{selected.length}/4개 선택{selected.length === 4 ? " · 다른 지역을 고르려면 먼저 선택을 해제하세요." : ""}</p><div className="flex flex-wrap gap-2">{nationalRegion && <button type="button" onClick={toggleNational} className={`${CONTROL} font-bold text-primary`}>{hasNational ? "시·도끼리 비교 (전국 제외)" : "전국 집계도 확인"}</button>}<button type="button" onClick={() => update({ regions: defaultComparisonRegions(group), from: "", to: "" })} className={`${CONTROL} font-bold text-primary`}>기본 비교로 초기화</button><button type="button" onClick={download} disabled={invalid || !selected.length || !periods.length} className={`${CONTROL} font-bold text-primary disabled:cursor-not-allowed disabled:opacity-50`}>비교 결과 CSV</button></div></div>
    {invalid ? <p role="alert" className="text-(length:--jeju-text-sm) text-(--jeju-danger)">비교 시작{periodUnit}를 종료{periodUnit}보다 앞선 시점으로 선택해 주세요.</p>
      : !selected.length ? <p className="rounded-(--jeju-radius) bg-(--jeju-surface-inset) p-5 text-center text-muted-foreground">비교할 지역을 선택하세요.</p>
      : !periods.length ? <p className="p-5 text-center text-muted-foreground">선택한 기간의 자료가 없습니다.</p> : <>
        {latest && <div className="grid gap-3 sm:grid-cols-2">{selected.map((row, index) => {
          const point = comparisonPoint(row.series, latest);
          return <div key={row.series.id} className="min-w-0 rounded-(--jeju-radius) bg-(--jeju-surface-inset) p-3"><p className="text-(length:--jeju-text-sm) font-bold"><span aria-hidden="true" style={{ color: COLORS[index] }}>{index + 1}. </span>{row.name} <span className="font-normal text-muted-foreground">{periodLabel(latest)}</span></p><p className="mt-2 break-words text-xl font-extrabold tabular-nums">{point.value === null ? STATUS[point.status] : `${FORMAT.format(point.value)} ${group.unit}`}</p>{point.value !== null && point.status !== "VALUE" && <p className="mt-1 text-(length:--jeju-text-sm) text-muted-foreground">{STATUS[point.status]}</p>}</div>;
        })}</div>}
        <ComparisonChart regions={selected} periods={periods} unit={group.unit} label={group.label} />
        <div role="region" aria-label="지역·시점별 비교 수치표, 좁은 화면에서는 가로로 이동" tabIndex={0} className={`min-w-0 overflow-x-auto rounded-(--jeju-radius) border border-border ${FOCUS}`}>
          <table className="w-full text-(length:--jeju-text-sm)"><caption className="sr-only">{group.label} 지역·시점별 수치, 단위 {group.unit}</caption><thead className="bg-(--jeju-surface-inset)"><tr><th scope="col" className="whitespace-nowrap px-3 py-3 text-left">{periodUnit}</th>{selected.map((row, i) => <th key={row.series.id} scope="col" className="whitespace-nowrap px-3 py-3 text-right">{i + 1}. {row.name}<span className="block font-normal text-muted-foreground">({group.unit})</span></th>)}</tr></thead>
            <tbody className="divide-y divide-border">{[...periods].reverse().map(period => <tr key={period}><th scope="row" className="whitespace-nowrap px-3 py-3 text-left font-medium">{periodLabel(period)}</th>{selected.map(row => {
              const point = comparisonPoint(row.series, period);
              return <td key={row.series.id} className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{point.value === null ? STATUS[point.status] : FORMAT.format(point.value)}{point.value !== null && point.status !== "VALUE" && <span className="block text-muted-foreground">{STATUS[point.status]}</span>}</td>;
            })}</tr>)}</tbody></table>
        </div>
      </>}
    <p className="text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">{allPeriods.length === 1 ? "현재 연결된 자료는 한 시점뿐이며 연도별 추이는 제공하지 않습니다. " : ""}자료 없음·비공개는 0으로 바꾸거나 선으로 연결하지 않습니다. 지역 명칭과 구분은 원자료를 따릅니다. 인구 규모가 다른 지역의 수치를 비교할 때는 해당 항목의 집계 범위를 함께 확인하세요.</p>
    <details className="text-(length:--jeju-text-sm)"><summary className={`flex min-h-(--jeju-control-h) cursor-pointer items-center font-bold text-primary ${FOCUS}`}>비교 자료의 원문 항목 확인</summary><ul className="mt-2 space-y-2 text-muted-foreground">{selected.map(row => <li key={row.series.id}>{row.name}: {row.series.label} · {row.series.unit}</li>)}</ul><a href={group.source_url} target="_blank" rel="noopener noreferrer" className={`mt-3 inline-flex min-h-(--jeju-control-h) items-center font-bold text-primary underline underline-offset-4 ${FOCUS}`}>공식 통계표 열기 (새 창)</a></details>
  </section>;
}

function ComparisonChart({ regions, periods, unit, label }: { readonly regions: readonly ComparisonRegion[]; readonly periods: readonly string[]; readonly unit: string; readonly label: string }) {
  const local = regions.filter(row => row.name !== "전국" && row.series.region?.level !== "national");
  if (!local.length) return <p className="text-(length:--jeju-text-sm) text-muted-foreground">전국 집계는 위 수치와 아래 표에서 확인합니다. 지역을 선택하면 지역별 차트를 표시합니다.</p>;
  if (periods.length === 1) return <RegionalValueChart rows={local.map(row => ({ id: row.series.id, name: row.name, ...comparisonPoint(row.series, periods[0]) }))} unit={unit} title={`${periodLabel(periods[0])} ${label} 지역별 비교`} />;
  return <div className="space-y-5"><p className="text-(length:--jeju-text-sm) text-muted-foreground">각 지역의 변화를 읽기 쉽게 차트를 나누었습니다. 지역별 세로축 범위가 다르므로 막대·선의 높이 대신 표시된 수치로 규모를 비교하세요.</p>{local.map(row => <StatisticsSeriesChart key={row.series.id} points={periods.map(period => comparisonPoint(row.series, period))} unit={unit} label={`${row.name} ${label}`} />)}</div>;
}
