"use client";

import { useMemo } from "react";

import { KoreaVectorMap } from "@/components/dashboard/korea-vector-map";
import { RegionSelector } from "@/components/dashboard/region-selector";
import { buildRegionStatisticsFromCounts } from "@/lib/region-statistics";

const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");
const RANK_COLORS = [
  "var(--care-blue)",
  "var(--care-green)",
  "var(--care-orange)",
  "var(--care-blue)",
  "var(--care-green)",
] as const;

interface NationalMapProps {
  readonly regionCounts: Readonly<Record<string, number>>;
  readonly selectedSido: string;
  readonly disabled: boolean;
  readonly onSelect: (sido: string) => void;
}

export function NationalMap({ regionCounts, selectedSido, disabled, onSelect }: NationalMapProps) {
  const statistics = useMemo(
    () => buildRegionStatisticsFromCounts(regionCounts),
    [regionCounts],
  );
  const ranked = useMemo(
    () => [...statistics].sort((left, right) => right.count - left.count).slice(0, 5),
    [statistics],
  );
  const maximum = ranked[0]?.count ?? 0;
  const selectedRegion = statistics.find((region) => region.dataValue === selectedSido);

  return (
    <section
      aria-labelledby="national-map-title"
      aria-busy={disabled}
      className="relative overflow-hidden rounded-2xl border border-[var(--care-blue)]/20 bg-[linear-gradient(135deg,var(--card)_0%,var(--map-panel-blue-wash)_50%,var(--map-panel-green-wash)_100%)] p-4 shadow-sm sm:p-6"
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--care-blue)_0_34%,var(--care-green)_34%_67%,var(--care-orange)_67%)]"
      />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2" aria-hidden="true">
            <span className="h-1.5 w-8 rounded-full bg-[var(--care-blue)]" />
            <span className="h-1.5 w-5 rounded-full bg-[var(--care-green)]" />
            <span className="h-1.5 w-3 rounded-full bg-[var(--care-orange)]" />
          </div>
          <h2 id="national-map-title" className="text-lg font-bold text-[var(--secondary-foreground)] sm:text-xl">
            대한민국 광역시·도 사업 현황
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            실제 행정경계 지도에서 광역단위를 가리키거나 선택하면 아래 검색 결과에 바로 반영됩니다.
          </p>
        </div>
        <p className="rounded-full border border-[var(--care-blue)]/20 bg-white/90 px-3.5 py-1.5 text-sm font-bold text-[var(--care-blue)] shadow-sm">
          {selectedRegion
            ? `${selectedRegion.fullName} ${NUMBER_FORMAT.format(selectedRegion.count)}건`
            : "전국 전체"}
        </p>
      </div>

      <div className="relative mt-5 grid gap-5 lg:grid-cols-[minmax(25rem,0.95fr)_minmax(18rem,0.5fr)] lg:items-stretch">
        <div className="relative isolate flex min-h-[30rem] flex-col gap-3">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-20 top-8 size-56 rounded-full bg-[var(--care-blue)]/10 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 bottom-16 size-52 rounded-full bg-[var(--care-green)]/10 blur-3xl"
          />
          <RegionSelector
            statistics={statistics}
            selectedSido={selectedSido}
            disabled={disabled}
            onSelect={onSelect}
          />
          <KoreaVectorMap
            statistics={statistics}
            maximum={maximum}
            selectedSido={selectedSido}
            disabled={disabled}
            onSelect={onSelect}
          />
        </div>

        <div className="flex min-w-0 flex-col rounded-2xl border border-white/80 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-[var(--care-orange)]" aria-hidden="true" />
            <h3 className="text-base font-bold text-foreground">사업 수 상위 5개 지역</h3>
          </div>
          <ol className="mt-4 flex-1 space-y-3">
            {ranked.map((region, index) => (
              <li key={region.id} className="rounded-xl border border-slate-200/80 bg-white/75 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2 truncate font-medium">
                    <span
                      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: RANK_COLORS[index] }}
                    >
                      {index + 1}
                    </span>
                    {region.fullName}
                  </span>
                  <span className="shrink-0 font-bold tabular-nums text-[var(--secondary-foreground)]">
                    {NUMBER_FORMAT.format(region.count)}건
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: maximum > 0 ? `${(region.count / maximum) * 100}%` : "0%",
                      backgroundColor: RANK_COLORS[index],
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 rounded-xl bg-[var(--care-blue)]/6 px-3 py-3 text-sm leading-6 text-muted-foreground">
            지도 수치는 현재 검색 조건 중 지역 조건을 제외한 나머지 조건을 반영합니다. 같은
            지역을 다시 선택하면 전국 결과로 돌아갑니다.
          </p>
        </div>
      </div>
    </section>
  );
}
