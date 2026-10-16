import { Button } from "@/components/ui/button";
import { CheckIcon } from "@/components/ui/jeju-icons";
import type { SearchAggregates } from "@/lib/official-query";

const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");

function StatCard({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-lg border border-border bg-(--jeju-surface-inset) px-3 py-2.5">
      <dt className="text-(length:--jeju-text-sm) font-bold text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-(length:--jeju-text-xl) font-extrabold tabular-nums text-(--jeju-text-strong)">{value}</dd>
    </div>
  );
}

function Pills({
  title,
  entries,
  filterLabel,
  selected,
  onChange,
}: {
  readonly title: string;
  readonly entries: [string, number][];
  readonly filterLabel: string;
  readonly selected: string;
  readonly onChange: (value: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div>
      <h3 className="text-(length:--jeju-text-sm) font-extrabold text-(--jeju-text-strong)">{title}</h3>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {entries.map(([label, value]) => (
          <li key={label}>
            <Button
              type="button"
              size="sm"
              variant={selected === label ? "default" : "outline"}
              aria-label={`${filterLabel} ${label} ${NUMBER_FORMAT.format(value)}건`}
              aria-pressed={selected === label}
              aria-controls="search-results"
              onClick={() => onChange(selected === label ? "" : label)}
              className={`min-h-11 rounded-full ${selected === label ? "" : "bg-(--jeju-surface-inset) hover:bg-(--jeju-primary-tint) hover:text-primary"}`}
            >
              {selected === label ? <CheckIcon aria-hidden="true" /> : null}
              {label} <strong className="font-extrabold tabular-nums">{NUMBER_FORMAT.format(value)}</strong>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RegionSummaryPanel({
  summary,
  totalRowCount,
  regionName,
  selectedCategory,
  selectedType,
  onCategoryChange,
  onTypeChange,
}: {
  readonly summary: SearchAggregates;
  readonly totalRowCount: number;
  readonly regionName: string;
  readonly selectedCategory: string;
  readonly selectedType: string;
  readonly onCategoryChange: (value: string) => void;
  readonly onTypeChange: (value: string) => void;
}) {
  const categories = Object.entries(summary.categoryCounts).sort((left, right) => right[1] - left[1]);
  const types = Object.entries(summary.typeCounts).sort((left, right) => right[1] - left[1]);
  const title = `${regionName} 요약`;

  return (
    <section aria-label={title} className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)">{title}</h2>

      <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="등록 사업" value={`${NUMBER_FORMAT.format(summary.rowCount)}건`} />
        <StatCard label="사업 분야" value={`${categories.length}개`} />
        <StatCard label="사업구분 종류" value={`${types.length}개`} />
        <StatCard
          label="전체 데이터 대비 비중"
          value={`${totalRowCount > 0 ? ((summary.rowCount / totalRowCount) * 100).toFixed(1) : "0.0"}%`}
        />
      </dl>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Pills title="분야별 사업 수" entries={categories} filterLabel="분야" selected={selectedCategory} onChange={onCategoryChange} />
        <Pills title="사업구분별 사업 수" entries={types} filterLabel="사업구분" selected={selectedType} onChange={onTypeChange} />
      </div>
    </section>
  );
}
