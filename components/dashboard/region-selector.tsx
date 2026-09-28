import { cn } from "@/lib/utils";
import type { RegionStatistic } from "@/lib/region-statistics";

const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");

interface RegionSelectorProps {
  readonly statistics: readonly RegionStatistic[];
  readonly selectedSido: string;
  readonly disabled: boolean;
  readonly onSelect: (sido: string) => void;
}

export function RegionSelector({
  statistics,
  selectedSido,
  disabled,
  onSelect,
}: RegionSelectorProps) {
  return (
    <nav
      aria-label="16개 광역시·도 선택"
      className="rounded-xl border border-border bg-card p-3 sm:p-4 print:hidden"
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-1">
        <p className="text-(length:--jeju-text-sm) font-extrabold text-(--jeju-text-strong)">광역시·도 바로 선택</p>
        <p className="text-(length:--jeju-text-xs) text-muted-foreground">선택하면 지도와 검색 결과에 함께 반영됩니다</p>
      </div>
      <div className="grid grid-cols-4 gap-2 md:grid-cols-8">
        {statistics.map((region) => {
          const selected = region.dataValue === selectedSido;
          return (
            <button
              key={region.id}
              type="button"
              aria-label={`${region.fullName} ${NUMBER_FORMAT.format(region.count)}건`}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onSelect(selected ? "" : region.dataValue)}
              className={cn(
                "group flex min-h-12 min-w-0 cursor-pointer flex-col items-center justify-center rounded-lg border px-1.5 py-2 text-center outline-none transition-colors motion-reduce:transition-none",
                "border-input bg-card text-(--jeju-text-body) hover:border-primary hover:bg-(--jeju-primary-tint) hover:text-primary",
                "focus-visible:border-ring focus-visible:shadow-(--jeju-focus-ring)",
                "disabled:cursor-not-allowed disabled:border-(--jeju-disabled-border) disabled:bg-(--jeju-disabled-bg) disabled:text-(--jeju-disabled-text)",
                selected &&
                  "border-primary bg-primary text-(--jeju-on-fill) hover:bg-(--jeju-primary-hover) hover:text-(--jeju-on-fill) forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]",
              )}
            >
              <span className="max-w-full break-keep text-(length:--jeju-text-sm) leading-5 font-extrabold">
                {region.shortLabel}
              </span>
              <span
                className={cn(
                  "text-(length:--jeju-text-xs) tabular-nums",
                  selected ? "text-(--jeju-on-fill)" : "text-muted-foreground group-hover:text-primary",
                )}
              >
                {NUMBER_FORMAT.format(region.count)}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
