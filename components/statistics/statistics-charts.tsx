import { adjacentPeriods, formatStatistic, statisticChartKind, statisticPeriod, usablePoint, VALUE_LABELS } from "@/lib/statistics/presentation";
import type { StatisticsPoint, ValueStatus } from "@/lib/statistics/types";

export function RegionalValueChart({ rows, unit, title }: { readonly rows: readonly { readonly id: string; readonly name: string; readonly value: number | null; readonly status: ValueStatus }[]; readonly unit: string; readonly title: string }) {
  const values = rows.flatMap(row => row.value === null ? [] : [row.value]);
  const floor = Math.min(0, ...values), ceiling = Math.max(0, ...values), range = ceiling - floor || 1;
  return <figure aria-label={title} className="min-w-0">
    <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><strong className="text-(--jeju-text-strong)">{title}</strong><span className="text-(length:--jeju-text-sm) text-muted-foreground">단위: {unit}</span></figcaption>
    <ol className="space-y-3">{rows.map(row => <li key={row.id} className="min-w-0">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-(length:--jeju-text-sm)"><span className="break-words font-bold">{row.name}</span><span className="font-extrabold tabular-nums">{row.value === null ? VALUE_LABELS[row.status] : `${formatStatistic(row.value)} ${unit}`}{row.value !== null && row.status !== "VALUE" ? ` · ${VALUE_LABELS[row.status]}` : ""}</span></div>
      <div aria-hidden="true" className="relative h-3 overflow-hidden rounded-sm bg-(--jeju-surface-inset)">
        <span className="absolute inset-y-0 w-px bg-(--jeju-border-strong)" style={{ left: `${-floor / range * 100}%` }} />
        {row.value !== null && <span className="absolute inset-y-0 bg-primary" style={{ left: `${(Math.min(0, row.value) - floor) / range * 100}%`, width: `${Math.abs(row.value) / range * 100}%` }} />}
      </div>
    </li>)}</ol>
  </figure>;
}

export function StatisticsSeriesChart({ points, label, unit }: { readonly points: readonly StatisticsPoint[]; readonly label: string; readonly unit: string }) {
  const ordered = [...points].sort((a, b) => a.period.localeCompare(b.period));
  const valid = ordered.filter(usablePoint), kind = statisticChartKind(ordered);
  if (kind === "empty") return <p className="rounded-(--jeju-radius) bg-(--jeju-surface-inset) p-4 text-muted-foreground">선택한 기간에 표시할 수치가 없습니다. 자료 없음·비공개는 0을 뜻하지 않습니다.</p>;
  if (kind === "single") return <p className="rounded-(--jeju-radius) bg-(--jeju-surface-inset) p-4 text-(length:--jeju-text-sm) text-muted-foreground">수치가 있는 시점은 {statisticPeriod(valid[0].period)} 한 개입니다. 변화 추이는 표시하지 않습니다.</p>;
  const values = valid.map(point => point.value!);
  const minimum = Math.min(0, ...values), maximum = Math.max(0, ...values);
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(Math.abs(minimum), maximum, 1))));
  const floor = Math.floor(minimum / magnitude) * magnitude, ceiling = Math.ceil(maximum / magnitude) * magnitude || magnitude;
  const range = ceiling - floor || 1, y = (value: number) => 200 - (value - floor) / range * 200;
  const segments: string[][] = []; let segment: string[] = [];
  ordered.forEach((point, index) => {
    if (index && !adjacentPeriods(ordered[index - 1].period, point.period) && segment.length) { segments.push(segment); segment = []; }
    if (!usablePoint(point)) { if (segment.length) segments.push(segment); segment = []; }
    else segment.push(`${20 + index / Math.max(1, ordered.length - 1) * 560},${y(point.value!)}`);
  });
  if (segment.length) segments.push(segment);
  const labelled = kind === "columns" || valid.length <= 6 ? valid : [valid[0], valid[valid.length - 1]];
  return <figure aria-label={`${label} ${kind === "columns" ? "두 시점 비교" : "기간별 변화"}`} className="min-w-0">
    <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><strong className="text-(--jeju-text-strong)">{label} {kind === "columns" ? "두 시점 비교" : "기간별 변화"}</strong><span className="text-(length:--jeju-text-sm) text-muted-foreground">단위: {unit}</span></figcaption>
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-2">
      <div aria-hidden="true" className="flex h-48 flex-col justify-between text-right text-(length:--jeju-text-xs) tabular-nums text-muted-foreground">{[4, 3, 2, 1, 0].map(i => <span key={i}>{formatStatistic(floor + range * i / 4)}</span>)}</div>
      <svg viewBox="0 0 600 200" preserveAspectRatio="none" role="img" aria-label={`${label}의 ${statisticPeriod(ordered[0].period)}부터 ${statisticPeriod(ordered[ordered.length - 1].period)}까지 수치. 주요 수치는 아래에 표시합니다.`} className="block h-48 w-full overflow-visible">
        {[0, 50, 100, 150, 200].map(top => <line key={top} x1="0" x2="600" y1={top} y2={top} stroke="var(--jeju-border)" />)}
        {kind === "columns" ? valid.map((point, index) => <rect key={point.period} x={index ? 345 : 75} y={Math.min(y(0), y(point.value!))} width="180" height={Math.max(0, Math.abs(y(point.value!) - y(0)))} fill={index ? "var(--jeju-primary)" : "var(--jeju-text-subtle)"} />) : <>
          {segments.map((path, index) => <polyline key={index} points={path.join(" ")} fill="none" stroke="var(--jeju-primary)" strokeWidth="3" vectorEffect="non-scaling-stroke" />)}
          {ordered.map((point, index) => usablePoint(point) ? <circle key={point.period} cx={20 + index / Math.max(1, ordered.length - 1) * 560} cy={y(point.value!)} r="4" fill="var(--jeju-primary)"><title>{`${statisticPeriod(point.period)}: ${formatStatistic(point.value!)} ${unit} · ${VALUE_LABELS[point.status]}`}</title></circle> : null)}
        </>}
        {floor < 0 && <line x1="0" x2="600" y1={y(0)} y2={y(0)} stroke="var(--jeju-text-muted)" />}
      </svg>
    </div>
    <div className="mt-2 flex justify-between gap-2 text-(length:--jeju-text-xs) text-muted-foreground"><span>{statisticPeriod(valid[0].period)}</span><span>{statisticPeriod(valid[valid.length - 1].period)}</span></div>
    <dl className="mt-3 grid gap-2 text-(length:--jeju-text-sm) sm:grid-cols-2">{labelled.map(point => <div key={point.period} className="flex flex-wrap justify-between gap-x-2 rounded-(--jeju-radius-sm) bg-(--jeju-surface-inset) p-2"><dt>{statisticPeriod(point.period)}</dt><dd className="font-bold tabular-nums">{formatStatistic(point.value!)} {unit}{point.status !== "VALUE" ? ` · ${VALUE_LABELS[point.status]}` : ""}</dd></div>)}</dl>
    <p className="mt-2 text-(length:--jeju-text-xs) text-muted-foreground">{kind === "columns" ? "두 시점의 실제 수치를 비교합니다." : "시점 간격이 끊기거나 자료가 없는 구간은 선으로 연결하지 않습니다."} 전체 수치와 상태는 아래 수치표에서 확인합니다.</p>
  </figure>;
}
