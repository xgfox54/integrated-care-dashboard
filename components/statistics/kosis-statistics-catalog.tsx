"use client";

import { ExternalLinkIcon } from "@/components/ui/jeju-icons";
import type { StatisticsCatalogGroup } from "@/components/statistics-explorer";

export function KosisStatisticsCatalog({ groups, selectedId, onSelect }: {
  readonly groups: readonly StatisticsCatalogGroup[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}) {
  const entries = groups.flatMap(group => group.sources.filter(source => source.kind === "kosis").map(source => ({ source, item: group.item })));
  const connected = entries.filter(({ source }) => source.data_available).length;
  return <section aria-labelledby="kosis-statistics-title" className="rounded-(--jeju-radius-lg) border border-border bg-card p-4 sm:p-6">
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <h2 id="kosis-statistics-title" className="text-(length:--jeju-h2-size) font-extrabold text-(--jeju-text-strong)">KOSIS 복지 통계 <span className="text-(length:--jeju-text-sm) font-normal text-muted-foreground">{entries.length}종</span></h2>
      <a href="https://kosis.kr/statisticsList/statisticsListIndex.do?parentId=G.1&vwcd=MT_ZTITLE&menuId=M_01_01" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-(length:--jeju-text-sm) font-bold text-primary underline underline-offset-4 outline-none focus-visible:shadow-(--jeju-focus-ring)">KOSIS 복지 전체 목록<ExternalLinkIcon /><span className="sr-only">(새 창)</span></a>
    </div>
    <p className="mt-2 text-(length:--jeju-text-sm) text-muted-foreground">국가통계포털의 복지 주제 목록 · {connected}종 대표 수치표 조회 · {entries.length - connected}종 원문 안내</p>
    <p className="mt-2 text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">항목을 누르면 아래에서 수치·차트·CSV·공식 원문을 확인합니다. KOSIS API로 24시간마다 최신 공표 자료를 확인하며 원자료의 단위를 유지합니다. 표마다 조회기간과 조사 대상이 다르고, 확인 실패 시 마지막 정상 자료를 표시합니다.</p>
    <details open={entries.some(({ item }) => item.id === selectedId)} className="group mt-4">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-(--jeju-radius) bg-(--jeju-surface-inset) px-3.5 py-2 text-(length:--jeju-text-sm) font-bold text-primary outline-none focus-visible:shadow-(--jeju-focus-ring)">
        <span>KOSIS 복지 통계항목 전체 보기 ({entries.length}종)</span>
        <span className="text-(length:--jeju-text-xs) text-muted-foreground group-open:hidden">목록 펼치기 ▼</span>
        <span className="hidden text-(length:--jeju-text-xs) text-muted-foreground group-open:inline">목록 접기 ▲</span>
      </summary>
      <div role="group" aria-label="KOSIS 복지 통계항목" className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {entries.map(({ source, item }) => <button key={source.id} type="button" aria-pressed={selectedId === item.id} aria-controls="statistics-detail-title" onClick={() => onSelect(item.id)}
          className={`min-h-11 min-w-0 rounded-(--jeju-radius) border border-border p-3 text-left outline-none transition-colors hover:bg-(--jeju-primary-tint) focus-visible:shadow-(--jeju-focus-ring) ${selectedId === item.id ? "bg-(--jeju-primary-tint)" : "bg-card"}`}>
          <span className="block text-(length:--jeju-text-xs) text-muted-foreground">{source.category} · KOSIS · {source.data_available ? "수치 조회" : "원문 안내"}</span>
          <span className="mt-1 block text-(length:--jeju-text-sm) font-bold text-(--jeju-text-strong)">{source.title}</span>
        </button>)}
      </div>
    </details>
  </section>;
}
