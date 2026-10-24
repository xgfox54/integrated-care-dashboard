"use client";

import { useMemo, useState } from "react";

import { KoreaVectorMap } from "@/components/dashboard/korea-vector-map";
import { buildRegionStatisticsFromCounts } from "@/lib/region-statistics";
import { cn } from "@/lib/utils";

export type PopulationMeasure = "total" | "middle" | "older" | "children";
export type PopulationBasis = "count" | "share";

export interface PopulationRegionRow {
  readonly name: string;
  readonly level: "national" | "sido";
  readonly total: number | null;
  readonly values: Readonly<Record<PopulationMeasure, number | null>>;
}

export interface RegionalPopulationData {
  readonly rows: readonly PopulationRegionRow[];
  readonly periods: Readonly<Record<PopulationMeasure, string>>;
  readonly datasetIds: Readonly<Record<PopulationMeasure, string>>;
  readonly sourceUrl: string;
  readonly seogwipo: { readonly value: number; readonly period: string } | null;
}

const MEASURES: readonly { readonly id: PopulationMeasure; readonly label: string; readonly age: string }[] = [
  { id: "total", label: "전체 인구수", age: "전체 연령" },
  { id: "middle", label: "중장년층", age: "40~64세" },
  { id: "older", label: "노년층", age: "65세 이상" },
  { id: "children", label: "아동", age: "0~17세" },
];
const NUMBER = new Intl.NumberFormat("ko-KR");
const PERCENT = new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const RANK_SERIES = [1, 2, 3] as const;

const periodLabel = (period: string) => /^\d{4}-\d{2}$/.test(period) ? period.slice(0, 4) + "년 " + Number(period.slice(5)) + "월" : period;
const shareOf = (row: PopulationRegionRow, measure: PopulationMeasure) => {
  const value = row.values[measure];
  return value !== null && row.total ? (value / row.total) * 100 : null;
};
const metricOf = (row: PopulationRegionRow, measure: PopulationMeasure, basis: PopulationBasis) => basis === "share" ? shareOf(row, measure) : row.values[measure];

export function RegionalPopulationMap({ data, initialRegion, initialMeasure, initialBasis }: {
  data: RegionalPopulationData;
  initialRegion: string;
  initialMeasure: PopulationMeasure;
  initialBasis: PopulationBasis;
}) {
  const [region, setRegion] = useState(initialRegion);
  const [measure, setMeasure] = useState<PopulationMeasure>(initialMeasure);
  const [basis, setBasis] = useState<PopulationBasis>(initialBasis);
  const national = data.rows.find(row => row.level === "national") ?? null;
  const sidoRows = useMemo(() => data.rows.filter(row => row.level === "sido"), [data.rows]);
  const statistics = useMemo(() => buildRegionStatisticsFromCounts(Object.fromEntries(sidoRows.map(row => {
    const value = metricOf(row, measure, basis);
    return [row.name, value === null ? 0 : basis === "share" ? Math.round(value * 10) / 10 : value];
  }))), [sidoRows, measure, basis]);
  const ranked = useMemo(() => [...sidoRows].sort((a, b) => (metricOf(b, measure, basis) ?? -1) - (metricOf(a, measure, basis) ?? -1)), [sidoRows, measure, basis]);
  const values = statistics.map(item => item.count).filter(value => value > 0);
  const maximum = Math.max(0, ...values);
  const minimum = basis === "share" && values.length ? Math.min(...values) * 0.98 : 0;
  const selectedRow = sidoRows.find(row => row.name === region) ?? national;
  const measureInfo = MEASURES.find(item => item.id === measure) ?? MEASURES[0];
  const format = (value: number | null) => value === null ? "자료 없음" : basis === "share" ? PERCENT.format(value) + "%" : NUMBER.format(value) + "명";

  function update(next: { region?: string; measure?: PopulationMeasure; basis?: PopulationBasis }) {
    const nextRegion = next.region ?? region, nextMeasure = next.measure ?? measure;
    const nextBasis = nextMeasure === "total" ? "count" : next.basis ?? basis;
    setRegion(nextRegion); setMeasure(nextMeasure); setBasis(nextBasis);
    const url = new URL(window.location.href);
    for (const [key, value, fallback] of [["region", nextRegion, ""], ["measure", nextMeasure, "middle"], ["basis", nextBasis, "count"]] as const) {
      if (value && value !== fallback) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    window.history.replaceState(window.history.state, "", url);
  }
  const selectRegion = (name: string) => update({ region: name === region ? "" : name });
  const regionNameOf = (sido: string) => sidoRows.find(row => row.name === sido)?.name
    ?? statistics.find(item => item.dataValue === sido)?.fullName ?? "";

  return <section aria-labelledby="regional-population-title" className="rounded-(--jeju-radius-lg) border border-border bg-card p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id="regional-population-title" className="text-(length:--jeju-h2-size) font-extrabold text-(--jeju-text-strong)">지역별 인구 현황 지도</h2>
        <p className="mt-1 text-(length:--jeju-text-sm) text-muted-foreground">
          행정안전부 주민등록 인구통계 · {periodLabel(data.periods[measure])} 기준. 지도나 순위에서 지역을 선택하고, 같은 지역을 다시 선택하면 전국으로 돌아갑니다.
        </p>
      </div>
      <p className="rounded-full border border-(--jeju-blue-light-strong) bg-(--jeju-primary-tint) px-3.5 py-1.5 text-(length:--jeju-text-sm) font-extrabold text-primary">
        {selectedRow && selectedRow.level === "sido" ? selectedRow.name : "전국 전체"}
      </p>
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-2">
      <div role="group" aria-label="지도에 표시할 인구 통계" className="flex flex-wrap gap-2">
        {MEASURES.map(item => <button key={item.id} type="button" aria-pressed={measure === item.id} onClick={() => update({ measure: item.id })}
          className={cn("min-h-11 rounded-full border px-4 text-(length:--jeju-text-sm) font-bold outline-none transition-colors focus-visible:shadow-(--jeju-focus-ring)",
            measure === item.id ? "border-primary bg-primary text-(--jeju-on-fill)" : "border-border bg-card text-(--jeju-text-body) hover:border-primary")}>
          {item.label} <span className="font-normal opacity-80">{item.age}</span>
        </button>)}
      </div>
      <div role="group" aria-label="표시 기준" className="inline-flex overflow-hidden rounded-full border border-border">
        {([["count", "인구 수"], ["share", "총인구 대비 비율"]] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={basis === id} disabled={measure === "total" && id === "share"} onClick={() => update({ basis: id })}
          title={measure === "total" && id === "share" ? "전체 인구수는 인구 수로 비교합니다." : undefined}
          className={cn("min-h-11 px-4 text-(length:--jeju-text-sm) font-bold outline-none focus-visible:shadow-(--jeju-focus-ring) disabled:cursor-not-allowed disabled:opacity-50",
            basis === id ? "bg-(--jeju-secondary-strong) text-(--jeju-on-fill)" : "bg-card text-(--jeju-text-body) hover:bg-(--jeju-primary-tint)")}>{label}</button>)}
      </div>
    </div>

    <div className="mt-5 grid gap-5 lg:grid-cols-2 lg:items-stretch">
      <KoreaVectorMap statistics={statistics} maximum={maximum} minimum={minimum} selectedSido={region ? statistics.find(item => item.fullName === regionNameOf(region) || item.dataValue === region)?.dataValue ?? "" : ""}
        disabled={false} onSelect={sido => update({ region: sido ? regionNameOf(sido) || sido : "" })}
        colorTheme="green"
        layout="expanded"
        formatValue={value => basis === "share" ? PERCENT.format(value) + "%" : NUMBER.format(value) + "명"}
        measureLabel={measureInfo.label + (measure === "total" ? "" : basis === "share" ? " 비율" : " 인구")}
        title={"대한민국 광역시·도 " + measureInfo.label + (measure === "total" ? "" : basis === "share" ? " 비율" : " 인구") + " 지도"}
        description="지역을 클릭하거나 키보드로 선택하면 오른쪽에 그 지역의 인구 현황이 나옵니다." />

        {selectedRow ? <div className="flex min-w-0 flex-col rounded-xl border border-border bg-(--jeju-surface-inset) p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)">{selectedRow.level === "sido" ? selectedRow.name : "전국"} 인구 현황</h3>
            <p className="text-(length:--jeju-text-sm) text-muted-foreground">총인구 <strong className="tabular-nums text-(--jeju-text-strong)">{selectedRow.total === null ? "자료 없음" : NUMBER.format(selectedRow.total) + "명"}</strong></p>
          </div>
          <div role="group" aria-label="인구 통계 선택" className="mt-3 grid flex-1 gap-2 min-[390px]:grid-cols-2 lg:grid-cols-1">
            {MEASURES.map(item => {
              const value = selectedRow.values[item.id];
              const share = shareOf(selectedRow, item.id);
              const nationalValue = national ? national.values[item.id] : null;
              const nationalShare = selectedRow.level === "sido" && value !== null && nationalValue ? (value / nationalValue) * 100 : null;
              return <button key={item.id} type="button" aria-pressed={measure === item.id} onClick={() => update({ measure: item.id })}
                className={cn("min-h-11 min-w-0 rounded-lg border border-border p-3 text-left outline-none transition-colors hover:bg-(--jeju-primary-tint) focus-visible:shadow-(--jeju-focus-ring)", measure === item.id ? "bg-(--jeju-primary-tint)" : "bg-card")}>
                <span className="block text-(length:--jeju-text-sm) font-bold text-muted-foreground">{item.label} <span className="font-normal">{item.age}</span></span>
                <span className="mt-1 block whitespace-nowrap text-(length:--jeju-text-base) font-extrabold tabular-nums text-(--jeju-text-strong) sm:text-(length:--jeju-text-xl) lg:text-(length:--jeju-text-2xl)">{value === null ? "자료 없음" : NUMBER.format(value) + "명"}</span>
                <span className="mt-1 block text-(length:--jeju-text-sm) text-muted-foreground">{item.id === "total" ? "전체 연령 주민등록인구" : "총인구의 " + (share === null ? "-" : PERCENT.format(share) + "%")}{nationalShare === null ? "" : " · 전국의 " + PERCENT.format(nationalShare) + "%"}</span>
                <span className="mt-2 block text-(length:--jeju-text-xs) font-bold text-primary">{measure === item.id ? "조회 중" : "지도·순위 조회"}</span>
              </button>;
            })}
          </div>
          {selectedRow.name === "제주특별자치도" && data.seogwipo ? <p className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-(length:--jeju-text-sm) text-(--jeju-text-body)">
            서귀포시 주민등록인구 <strong className="tabular-nums">{NUMBER.format(data.seogwipo.value)}명</strong> <span className="text-muted-foreground">({periodLabel(data.seogwipo.period)} 기준)</span>
          </p> : null}
          <p className="mt-3 text-(length:--jeju-text-sm)"><a href={"?id=" + encodeURIComponent(data.datasetIds[measure]) + "&measure=" + measure + "&basis=" + basis + "&region=" + encodeURIComponent(region) + "#statistics-explore"} className="font-bold text-primary underline underline-offset-4">{measureInfo.label}{measure === "total" ? "" : " 인구"} 통계표 보기</a></p>
        </div> : null}

        <div className="min-w-0 rounded-xl border border-border bg-card p-4 lg:col-span-2">
          <h3 className="font-extrabold text-(--jeju-text-strong)">{measureInfo.label}{measure === "total" ? "" : basis === "share" ? " 비율" : " 인구"} 순위 <span className="text-(length:--jeju-text-sm) font-normal text-muted-foreground">16개 시·도</span></h3>
          <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {ranked.map((row, index) => {
              const selected = region === row.name;
              return <li key={row.name}>
                <button type="button" aria-pressed={selected} onClick={() => selectRegion(row.name)}
                  className={cn("flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-left text-(length:--jeju-text-sm) outline-none focus-visible:shadow-(--jeju-focus-ring)",
                    selected ? "bg-(--jeju-primary-tint)" : "hover:bg-(--jeju-primary-tint)")}>
                  <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-(length:--jeju-text-xs) font-extrabold text-(--jeju-on-fill)"
                    style={{ backgroundColor: "var(--series-" + RANK_SERIES[index % RANK_SERIES.length] + "-strong)" }}>{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-bold text-(--jeju-text-body)">{row.name}</span>
                  <span className="shrink-0 font-extrabold tabular-nums text-(--jeju-text-strong)">{format(metricOf(row, measure, basis))}</span>
                </button>
              </li>;
            })}
          </ol>
          <p className="mt-3 text-(length:--jeju-text-xs) text-muted-foreground">
            {basis === "share" ? "비율은 연령층 인구를 그 지역 총인구로 나눈 값입니다. " : ""}지도는 초록색의 연하고 진함으로 시·도 사이의 상대적 크기(적음→많음)를 나타냅니다. 출처: <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">행정안전부 주민등록 인구통계<span className="sr-only">(새 창)</span></a>
          </p>
        </div>
    </div>
  </section>;
}

