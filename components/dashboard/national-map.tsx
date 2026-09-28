"use client";

import { useMemo } from "react";

import { KoreaVectorMap } from "@/components/dashboard/korea-vector-map";
import { RegionSelector } from "@/components/dashboard/region-selector";
import { buildRegionStatisticsFromCounts } from "@/lib/region-statistics";

const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");
/** 상위 5개 지역의 색 순서: 파랑·초록·주황·파랑·초록. */
const RANK_SERIES = [1, 2, 3, 1, 2] as const;

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
      className="rounded-xl border border-border bg-card p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1
            id="national-map-title"
            className="text-(length:--jeju-h1-size) leading-(--jeju-leading-tight) font-extrabold text-(--jeju-text-strong)"
          >
            대한민국 광역시·도 사업 현황
          </h1>
          <p className="mt-2 text-(length:--jeju-text-sm) text-muted-foreground">
            실제 행정경계 지도에서 광역단위를 가리키거나 선택하면 아래 검색 결과에 바로 반영됩니다.
          </p>
        </div>
        <p className="rounded-full border border-(--jeju-blue-light-strong) bg-(--jeju-primary-tint) px-3.5 py-1.5 text-(length:--jeju-text-sm) font-extrabold text-primary">
          {selectedRegion
            ? `${selectedRegion.fullName} ${NUMBER_FORMAT.format(selectedRegion.count)}건`
            : "전국 전체"}
        </p>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(25rem,0.95fr)_minmax(18rem,0.5fr)] lg:items-stretch">
        <div className="flex min-h-[30rem] flex-col gap-3 print:min-h-0">
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

        <div className="flex min-w-0 flex-col rounded-xl border border-border bg-(--jeju-surface-inset) p-5">
          <h2 className="text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)">사업 수 상위 5개 지역</h2>
          <ol className="mt-4 flex-1 space-y-3">
            {ranked.map((region, index) => (
              <li key={region.id} className="rounded-lg border border-border bg-card px-3 py-2.5">
                <div className="flex items-center justify-between gap-3 text-(length:--jeju-text-sm)">
                  <span className="flex min-w-0 items-center gap-2 truncate font-bold text-(--jeju-text-body)">
                    <span
                      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-(length:--jeju-text-xs) font-extrabold text-(--jeju-on-fill)"
                      style={{ backgroundColor: `var(--series-${RANK_SERIES[index % RANK_SERIES.length]}-strong)` }}
                    >
                      {index + 1}
                    </span>
                    {region.fullName}
                  </span>
                  <span className="shrink-0 font-extrabold tabular-nums text-(--jeju-text-strong)">
                    {NUMBER_FORMAT.format(region.count)}건
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-(--jeju-control-bg)" aria-hidden="true">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: maximum > 0 ? `${(region.count / maximum) * 100}%` : "0%",
                      backgroundColor: `var(--series-${RANK_SERIES[index % RANK_SERIES.length]})`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 rounded-lg border border-border bg-card px-3 py-3 text-(length:--jeju-text-sm) leading-6 text-muted-foreground">
            지도 수치는 현재 검색 조건 중 지역 조건을 제외한 나머지 조건을 반영합니다. 같은
            지역을 다시 선택하면 전국 결과로 돌아갑니다.
          </p>
        </div>
      </div>
    </section>
  );
}
