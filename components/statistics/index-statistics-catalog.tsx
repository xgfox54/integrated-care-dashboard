"use client";

import type { StatisticsCatalogGroup } from "@/components/statistics-explorer";

export function IndexStatisticsCatalog({ groups, selectedId, onSelect }: {
  readonly groups: readonly StatisticsCatalogGroup[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}) {
  const connected = groups.filter(group => group.sources.some(source => source.data_provider === "index"));
  return <section aria-labelledby="index-statistics-title" className="rounded-(--jeju-radius-lg) border border-border bg-card p-4 sm:p-6">
    <h2 id="index-statistics-title" className="text-(length:--jeju-h2-size) font-extrabold text-(--jeju-text-strong)">지표누리 API 연결 통계 <span className="text-(length:--jeju-text-sm) font-normal text-muted-foreground">{connected.length}종</span></h2>
    <p className="mt-2 text-(length:--jeju-text-sm) text-muted-foreground">항목을 누르면 아래에서 연도별 수치·차트·원문을 조회합니다. 기존 통합 목록과 같은 통계입니다.</p>
    <details open={connected.some(({ item }) => item.id === selectedId)} className="group mt-4">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-(--jeju-radius) bg-(--jeju-surface-inset) px-3.5 py-2 text-(length:--jeju-text-sm) font-bold text-primary outline-none focus-visible:shadow-(--jeju-focus-ring)">
        <span>연결된 통계항목 전체 보기 ({connected.length}종)</span>
        <span className="text-(length:--jeju-text-xs) text-muted-foreground group-open:hidden">목록 펼치기 ▼</span>
        <span className="hidden text-(length:--jeju-text-xs) text-muted-foreground group-open:inline">목록 접기 ▲</span>
      </summary>
      <div role="group" aria-label="지표누리 통계항목" className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {connected.map(({ item }) => <button key={item.id} type="button" aria-pressed={selectedId === item.id} aria-controls="statistics-detail-title"
          onClick={() => onSelect(item.id)}
          className={`min-h-11 min-w-0 rounded-(--jeju-radius) border border-border p-3 text-left outline-none transition-colors hover:bg-(--jeju-primary-tint) focus-visible:shadow-(--jeju-focus-ring) ${selectedId === item.id ? "bg-(--jeju-primary-tint)" : "bg-card"}`}>
          <span className="block text-(length:--jeju-text-xs) text-muted-foreground">{item.category} · 지표누리 API</span>
          <span className="mt-1 block text-(length:--jeju-text-sm) font-bold text-(--jeju-text-strong)">{item.title}</span>
        </button>)}
      </div>
    </details>
  </section>;
}
