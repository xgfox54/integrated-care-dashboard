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
      className="rounded-2xl border border-white/80 bg-white/80 p-3 shadow-sm sm:p-4"
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-1">
        <p className="text-sm font-bold text-foreground">광역시·도 바로 선택</p>
        <p className="text-xs text-muted-foreground">선택하면 지도와 검색 결과에 함께 반영됩니다</p>
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
                "group flex min-h-12 min-w-0 flex-col items-center justify-center rounded-lg border px-1.5 py-2 text-center transition-[background-color,border-color,color,box-shadow,opacity] duration-150 ease-out motion-reduce:transition-none",
                "border-[var(--border)] bg-white text-foreground hover:border-[var(--care-blue)] hover:bg-[var(--care-blue)] hover:text-white",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2",
                "disabled:cursor-not-allowed disabled:opacity-60",
                selected &&
                  "border-[var(--care-blue)] bg-[var(--care-blue)] text-white shadow-sm hover:border-[var(--care-blue)] hover:bg-[var(--care-blue)]",
              )}
            >
              <span className="max-w-full break-keep text-sm font-bold leading-5">
                {region.shortLabel}
              </span>
              <span
                className={cn(
                  "text-xs tabular-nums text-muted-foreground group-hover:text-white/85",
                  selected && "text-white/85",
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
