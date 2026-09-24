"use client";

const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");
const VISIBLE_ROWS = 10;
const CHART_COLORS = ["var(--care-blue)", "var(--care-green)", "var(--care-orange)"] as const;

export function CategoryChart({
  counts,
  regionName,
}: {
  readonly counts: [string, number][];
  readonly regionName: string;
}) {
  const title = `${regionName} 분야별 사업 분포`;

  if (counts.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          조건에 맞는 사업이 없어 분야별 분포를 표시할 수 없습니다.
        </p>
      </section>
    );
  }

  const visible = counts.slice(0, VISIBLE_ROWS);
  const max = visible[0][1] || 1;
  const total = counts.reduce((sum, entry) => sum + entry[1], 0);

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <h2 className="text-base font-semibold">{title}</h2>
      <table className="mt-3 w-full border-collapse text-sm">
        <caption className="sr-only">
          {regionName}의 현재 검색조건에 해당하는 사업 대분류별 건수입니다.
        </caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">분야</th>
            <th scope="col">사업 수</th>
            <th scope="col">비율</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(([label, value], index) => (
            <tr key={label}>
              <th scope="row" className="w-32 py-1.5 pr-3 text-left font-medium">
                {label}
              </th>
              <td className="py-1.5">
                <div className="h-4 w-full rounded-sm bg-secondary">
                  <div
                    className="h-4 rounded-sm"
                    style={{
                      width: `${Math.max(2, (value / max) * 100)}%`,
                      backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
                    }}
                  />
                </div>
              </td>
              <td className="w-28 py-1.5 pl-3 text-right tabular-nums">
                {NUMBER_FORMAT.format(value)}건
                <span className="ml-1 text-muted-foreground">
                  {total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "0%"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {counts.length > VISIBLE_ROWS ? (
        <p className="mt-2 text-sm text-muted-foreground">
          상위 {VISIBLE_ROWS}개 분야만 표시합니다. 전체 {counts.length}개 분야.
        </p>
      ) : null}
    </div>
  );
}
