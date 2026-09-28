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
}: {
  readonly title: string;
  readonly entries: [string, number][];
}) {
  if (entries.length === 0) return null;
  return (
    <div>
      <h3 className="text-(length:--jeju-text-sm) font-extrabold text-(--jeju-text-strong)">{title}</h3>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {entries.map(([label, value]) => (
          <li
            key={label}
            className="rounded-full border border-border bg-(--jeju-surface-inset) px-2.5 py-1 text-(length:--jeju-text-sm) text-(--jeju-text-body)"
          >
            {label} <strong className="font-extrabold tabular-nums text-(--jeju-text-strong)">{NUMBER_FORMAT.format(value)}</strong>
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
}: {
  readonly summary: SearchAggregates;
  readonly totalRowCount: number;
  readonly regionName: string;
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
        <Pills title="분야별 사업 수" entries={categories} />
        <Pills title="사업구분별 사업 수" entries={types} />
      </div>
    </section>
  );
}
