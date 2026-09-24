"use client";

import southKorea from "@svg-maps/south-korea";
import { useMemo, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";
import type { RegionId, RegionStatistic } from "@/lib/region-statistics";

const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");

const MAP_REGION_SHAPES = [
  { id: "gangwon", locationIds: ["gangwon"] },
  { id: "gyeonggi", locationIds: ["gyeonggi"] },
  { id: "chungbuk", locationIds: ["north-chungcheong"] },
  { id: "chungnam", locationIds: ["south-chungcheong"] },
  { id: "jeonbuk", locationIds: ["north-jeolla"] },
  { id: "jeonnam_gwangju", locationIds: ["south-jeolla", "gwangju"] },
  { id: "gyeongbuk", locationIds: ["north-gyeongsang"] },
  { id: "gyeongnam", locationIds: ["south-gyeongsang"] },
  { id: "jeju", locationIds: ["jeju"] },
  { id: "seoul", locationIds: ["seoul"] },
  { id: "incheon", locationIds: ["incheon"] },
  { id: "sejong", locationIds: ["sejong"] },
  { id: "daejeon", locationIds: ["daejeon"] },
  { id: "daegu", locationIds: ["daegu"] },
  { id: "ulsan", locationIds: ["ulsan"] },
  { id: "busan", locationIds: ["busan"] },
] as const satisfies readonly {
  readonly id: RegionId;
  readonly locationIds: readonly string[];
}[];

interface KoreaVectorMapProps {
  readonly statistics: readonly RegionStatistic[];
  readonly maximum: number;
  readonly selectedSido: string;
  readonly disabled: boolean;
  readonly onSelect: (sido: string) => void;
}

function regionTone(count: number, maximum: number): string {
  if (count === 0 || maximum === 0) return "fill-[var(--map-region-empty)]";
  const ratio = count / maximum;
  if (ratio < 0.34) return "fill-[var(--map-region-low)]";
  if (ratio < 0.67) return "fill-[var(--map-region-medium)]";
  return "fill-[var(--map-region-high)]";
}

export function KoreaVectorMap({
  statistics,
  maximum,
  selectedSido,
  disabled,
  onSelect,
}: KoreaVectorMapProps) {
  const [hoveredRegionId, setHoveredRegionId] = useState<RegionId | null>(null);
  const [focusedRegionId, setFocusedRegionId] = useState<RegionId | null>(null);
  const statisticsById = useMemo(
    () => new Map(statistics.map((region) => [region.id, region])),
    [statistics],
  );
  const selectedRegion = statistics.find((region) => region.dataValue === selectedSido);
  const highlightedRegionId = focusedRegionId ?? hoveredRegionId;
  const highlightedRegion = highlightedRegionId
    ? statisticsById.get(highlightedRegionId)
    : selectedRegion;

  const selectRegion = (region: RegionStatistic) => {
    if (disabled) return;
    onSelect(region.dataValue === selectedSido ? "" : region.dataValue);
  };

  const handleKeyDown = (
    event: KeyboardEvent<SVGGElement>,
    region: RegionStatistic,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectRegion(region);
  };

  return (
    <figure className="relative flex h-full min-h-[30rem] flex-col overflow-hidden rounded-2xl border border-white/80 bg-white/55 p-3 shadow-inner sm:p-5">
      <div className="relative z-10 flex min-h-16 flex-wrap items-center justify-between gap-2 rounded-xl border border-white/90 bg-white/85 px-3 py-2 shadow-sm backdrop-blur-sm">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">
            {highlightedRegion ? "현재 지역" : "지도 사용법"}
          </p>
          <p className="font-bold text-secondary-foreground">
            {highlightedRegion
              ? highlightedRegion.fullName
              : "원하는 지역을 클릭해서 현황을 확인하세요."}
          </p>
        </div>
        {highlightedRegion ? (
          <p className="rounded-full bg-[var(--secondary)] px-3 py-1 text-sm font-bold tabular-nums text-[var(--care-blue)]">
            {NUMBER_FORMAT.format(highlightedRegion.count)}건
          </p>
        ) : null}
      </div>

      <svg
        aria-labelledby="korea-vector-map-title korea-vector-map-description"
        className="relative z-10 mx-auto my-3 h-auto max-h-[26rem] w-full max-w-[23rem] overflow-visible"
        preserveAspectRatio="xMidYMid meet"
        viewBox={southKorea.viewBox}
      >
        <title id="korea-vector-map-title">대한민국 광역단위 사업 현황 지도</title>
        <desc id="korea-vector-map-description">
          원하는 지역을 클릭하거나 키보드로 선택하면 해당 광역단위 현황이 대시보드 검색
          조건에 반영됩니다.
        </desc>
        {MAP_REGION_SHAPES.map((shape) => {
          const region = statisticsById.get(shape.id);
          if (!region) return null;
          const highlighted = highlightedRegionId === region.id;
          const selected = selectedSido === region.dataValue;
          const muted = highlightedRegionId !== null && !highlighted;
          const focused = focusedRegionId === region.id;
          const paths = shape.locationIds.flatMap((locationId) => {
            const location = southKorea.locations.find(({ id }) => id === locationId);
            return location ? [location] : [];
          });

          return (
            <g
              key={region.id}
              aria-disabled={disabled}
              aria-label={`${region.fullName} ${NUMBER_FORMAT.format(region.count)}건`}
              aria-pressed={selected}
              data-region-id={region.id}
              onBlur={() => setFocusedRegionId(null)}
              onClick={() => selectRegion(region)}
              onFocus={() => setFocusedRegionId(region.id)}
              onKeyDown={(event) => handleKeyDown(event, region)}
              onPointerEnter={() => setHoveredRegionId(region.id)}
              onPointerLeave={() => setHoveredRegionId(null)}
              role="button"
              tabIndex={disabled ? -1 : 0}
              className={cn(
                "cursor-pointer outline-none",
                disabled && "cursor-not-allowed",
              )}
            >
              <title>{`${region.fullName} ${NUMBER_FORMAT.format(region.count)}건`}</title>
              {paths.map((location) => (
                <path
                  key={location.id}
                  d={location.path}
                  vectorEffect="non-scaling-stroke"
                  className={cn(
                    "stroke-[var(--map-region-border)] [stroke-linejoin:round] [stroke-width:1.25] transition-[fill,stroke,filter,opacity] duration-150 ease-out motion-reduce:transition-none",
                    regionTone(region.count, maximum),
                    muted && "opacity-35",
                    selected &&
                      "fill-[var(--care-blue)] stroke-white [filter:drop-shadow(0_7px_8px_rgb(1_115_188_/_0.3))] [stroke-width:2.25]",
                    highlighted && !selected &&
                      "fill-[var(--care-blue)] stroke-white opacity-100 [filter:drop-shadow(0_8px_10px_rgb(1_115_188_/_0.32))] [stroke-width:2.75]",
                    focused && "stroke-[var(--care-green)] [stroke-width:3.5]",
                  )}
                />
              ))}
            </g>
          );
        })}
      </svg>

      <figcaption className="relative z-10 mt-auto flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>파란색: 현재 가리키거나 선택한 지역</span>
          <span className="inline-flex items-center gap-1" aria-label="기본 지도 색상은 사업 수가 적음에서 많음 순서입니다">
            <span>사업 수</span>
            <span className="size-3 rounded-sm bg-[var(--map-region-low)]" aria-hidden="true" />
            <span className="size-3 rounded-sm bg-[var(--map-region-medium)]" aria-hidden="true" />
            <span className="size-3 rounded-sm bg-[var(--map-region-high)]" aria-hidden="true" />
            <span>적음→많음</span>
          </span>
        </span>
        <a
          className="underline decoration-slate-300 underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          href="https://github.com/VictorCazanave/svg-maps/tree/master/packages/south-korea"
          rel="noreferrer"
          target="_blank"
        >
          지도 경계: SVG Maps · MapSVG (CC BY 4.0)
        </a>
      </figcaption>
    </figure>
  );
}
