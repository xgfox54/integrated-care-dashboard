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

export type MapColorTheme = "blue" | "green" | "orange";

const THEME_LABELS: Readonly<Record<MapColorTheme, string>> = {
  blue: "파란색",
  green: "초록색",
  orange: "주황색",
};

interface KoreaVectorMapProps {
  readonly statistics: readonly RegionStatistic[];
  readonly maximum: number;
  readonly selectedSido: string;
  readonly disabled: boolean;
  readonly onSelect: (sido: string) => void;
  /** 색 범례·설명에 쓸 값 이름. 기본은 대시보드의 "사업 수". */
  readonly measureLabel?: string;
  readonly title?: string;
  readonly description?: string;
  readonly fixedLayout?: boolean;
  readonly layout?: "standard" | "expanded";
  /** 지역 값 표시. 기본은 대시보드의 사업 건수(예: 12건). */
  readonly formatValue?: (value: number) => string;
  /** 색 단계를 나눌 최솟값. 비율처럼 값이 좁은 범위에 모일 때 쓴다. 기본 0. */
  readonly minimum?: number;
  readonly colorTheme?: MapColorTheme;
}

function regionTone(count: number, maximum: number, minimum = 0): string {
  if (count === 0 || maximum === 0) return "fill-[var(--map-region-empty)]";
  const ratio = maximum > minimum ? (count - minimum) / (maximum - minimum) : 1;
  const curved = Math.sqrt(Math.max(0, Math.min(1, ratio)));
  if (curved < 0.2) return "fill-[var(--map-step-1)]";
  if (curved < 0.4) return "fill-[var(--map-step-2)]";
  if (curved < 0.6) return "fill-[var(--map-step-3)]";
  if (curved < 0.8) return "fill-[var(--map-step-4)]";
  return "fill-[var(--map-step-5)]";
}

export function KoreaVectorMap({
  statistics,
  maximum,
  selectedSido,
  disabled,
  onSelect,
  measureLabel = "사업 수",
  title = "대한민국 광역단위 사업 현황 지도",
  description = "원하는 지역을 클릭하거나 키보드로 선택하면 해당 광역단위 현황이 대시보드 검색 조건에 반영됩니다.",
  fixedLayout = false,
  layout = "standard",
  formatValue = (value) => NUMBER_FORMAT.format(value) + "건",
  minimum = 0,
  colorTheme = "blue",
}: KoreaVectorMapProps) {
  const [hoveredRegionId, setHoveredRegionId] = useState<RegionId | null>(null);
  const [focusedRegionId, setFocusedRegionId] = useState<RegionId | null>(null);
  const themeLabel = THEME_LABELS[colorTheme];
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
    <figure
      data-map-theme={colorTheme}
      className={cn("relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-(--jeju-surface-inset) p-3 sm:p-5", layout === "expanded" ? "h-auto" : fixedLayout ? "h-[35rem]" : "h-full min-h-[30rem]")}
    >
      <div className={cn("relative z-10 flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2", fixedLayout ? "h-28 shrink-0 overflow-y-auto" : "min-h-16 flex-wrap")}>
        <div className="min-w-0">
          <p className="text-(length:--jeju-text-xs) font-bold text-muted-foreground">
            {highlightedRegion ? "현재 지역" : "지도 사용법"}
          </p>
          <p className="font-extrabold text-(--jeju-text-strong)">
            {highlightedRegion
              ? highlightedRegion.fullName
              : "원하는 지역을 클릭해서 현황을 확인하세요."}
          </p>
        </div>
        {highlightedRegion ? (
          <p className="shrink-0 rounded-full bg-[var(--map-badge-bg)] px-3 py-1 text-(length:--jeju-text-sm) font-extrabold tabular-nums text-[var(--map-badge-text)]">
            {formatValue(highlightedRegion.count)}
          </p>
        ) : null}
      </div>

      <svg
        aria-labelledby="korea-vector-map-title korea-vector-map-description"
        className={cn("relative z-10 mx-auto my-3 w-full overflow-visible", layout === "expanded" ? "h-auto shrink-0" : cn("max-w-[23rem]", fixedLayout ? "h-72 shrink-0" : "h-auto max-h-[26rem]"))}
        preserveAspectRatio="xMidYMid meet"
        viewBox="0 0 640 631"
      >
        <title id="korea-vector-map-title">{title}</title>
        <desc id="korea-vector-map-description">{description} 독도는 식별하기 쉽도록 확대 표시하며 경상북도와 함께 선택됩니다.</desc>
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
              aria-label={region.fullName + (region.id === "gyeongbuk" ? " (울릉도·독도 포함) " : " ") + formatValue(region.count)}
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
              <title>{region.fullName + " " + formatValue(region.count)}</title>
              {[...paths, ...(region.id === "gyeongbuk" ? [{ id: "dokdo", path: "M 591 157 L 594 148 L 598 151 L 599 156 L 596 160 Z M 602 161 L 605 155 L 610 157 L 612 163 L 607 166 Z" }] : [])].map((location) => (
                <path
                  key={location.id}
                  data-map-island={location.id === "dokdo" ? "dokdo" : undefined}
                  d={location.path}
                  vectorEffect="non-scaling-stroke"
                  className={cn(
                    "stroke-[var(--map-region-border)] [stroke-linejoin:round] [stroke-width:1.25] transition-[fill,stroke,filter,opacity] duration-150 ease-out motion-reduce:transition-none",
                    regionTone(region.count, maximum, minimum),
                    muted && "opacity-35",
                    selected &&
                      "fill-[var(--map-active)] stroke-(--jeju-surface) [filter:drop-shadow(0_7px_8px_color-mix(in_srgb,var(--map-active)_32%,transparent))] [stroke-width:2.25]",
                    highlighted && !selected &&
                      "fill-[var(--map-active)] stroke-(--jeju-surface) opacity-100 [filter:drop-shadow(0_8px_10px_color-mix(in_srgb,var(--map-active)_35%,transparent))] [stroke-width:2.75]",
                    focused && "stroke-[var(--map-focus)] [stroke-width:3.5]",
                  )}
                />
              ))}
              {region.id === "gyeongbuk" && <g data-map-island="dokdo-label">
                <rect x="572" y="138" width="64" height="64" fill="transparent" pointerEvents="all" />
                <text x="602" y="192" textAnchor="middle" fontSize="23" fontWeight="700" fill="var(--jeju-text-strong)" pointerEvents="none">독도</text>
              </g>}
            </g>
          );
        })}
      </svg>

      <figcaption className={cn("relative z-10 flex flex-wrap items-center justify-between gap-2 text-(length:--jeju-text-xs) text-muted-foreground", layout !== "expanded" && "mt-auto")}>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>진한 {themeLabel} + 흰 테두리: 선택한 지역</span>
          <span>독도는 확대 표시</span>
          <span className="inline-flex items-center gap-1" aria-label={`${measureLabel}가 적을수록 연한 ${themeLabel}, 많을수록 진한 ${themeLabel}으로 표시합니다`}>
            <span>{measureLabel}</span>
            <span className="size-3 rounded-sm border border-(--map-region-border) bg-[var(--map-step-1)]" aria-hidden="true" />
            <span className="size-3 rounded-sm border border-(--map-region-border) bg-[var(--map-step-2)]" aria-hidden="true" />
            <span className="size-3 rounded-sm border border-(--map-region-border) bg-[var(--map-step-3)]" aria-hidden="true" />
            <span className="size-3 rounded-sm border border-(--map-region-border) bg-[var(--map-step-4)]" aria-hidden="true" />
            <span className="size-3 rounded-sm border border-(--map-region-border) bg-[var(--map-step-5)]" aria-hidden="true" />
            <span>연한 {themeLabel} → 진한 {themeLabel} (적음→많음)</span>
          </span>
        </span>
        <a
          className="underline decoration-(--jeju-border-strong) underline-offset-2 hover:text-foreground focus-visible:rounded-(--jeju-radius-xs) focus-visible:shadow-(--jeju-focus-ring) focus-visible:outline-none"
          href="https://github.com/VictorCazanave/svg-maps/tree/master/packages/south-korea"
          rel="noreferrer"
          target="_blank"
        >
          지도 경계: SVG Maps · MapSVG (CC BY 4.0)
        </a>
        <a
          className="underline decoration-(--jeju-border-strong) underline-offset-2 hover:text-foreground focus-visible:rounded-(--jeju-radius-xs) focus-visible:shadow-(--jeju-focus-ring) focus-visible:outline-none"
          href="https://dokdo.mofa.go.kr/kor/introduce/location.jsp"
          rel="noreferrer"
          target="_blank"
        >
          독도 위치·구성: 외교부
        </a>
      </figcaption>
    </figure>
  );
}
