import type { Metadata } from "next";
import { PageUsage } from "@/components/usage/page-usage";
import { StatisticsExplorer } from "@/components/statistics-explorer";
import type { StatisticsCatalogGroup } from "@/components/statistics-explorer";
import { ExternalLinkIcon } from "@/components/ui/jeju-icons";
import { statisticsCatalog, statisticsStatus, verifiedStatistics, STATISTICS_SOURCES } from "@/lib/statistics/catalog";
import { loadCurrentStatisticsSnapshots } from "@/lib/statistics/current";
import type { StatisticsCatalogItem } from "@/lib/statistics/types";

export const metadata: Metadata = { title: "복지통계 | 전국 통합돌봄 사업 총괄 대시보드", description: "지역별 중장년·노년·아동 인구와 복지·보건 통계를 한곳에서 검색하고 수치, 기준 시점, 단위와 공식 원문을 확인합니다. 복지정보MCP와 같은 통계표를 제공합니다.", alternates: { canonical: "/statistics" } };
export const dynamic = "force-dynamic";

function groupStatisticsCatalog(catalog: readonly StatisticsCatalogItem[]): StatisticsCatalogGroup[] {
  const groups: StatisticsCatalogItem[][] = [];
  const titleKey = (title: string) => title.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  for (const item of catalog) {
    if (item.kind === "portal") continue;
    // A shared table ID is stronger evidence than a title. Similar names alone
    // must never combine distinct measures or national and regional tables.
    const sharedDataset = item.dataset_id && groups.find(group => group.some(row => row.dataset_id === item.dataset_id));
    const sameTitle = groups.find(group => group.some(row => titleKey(row.title) === titleKey(item.title) && row.category === item.category)
      && !group.some(row => row.dataset_id && item.dataset_id && row.dataset_id !== item.dataset_id));
    const group = sharedDataset || sameTitle;
    if (group) group.push(item); else groups.push([item]);
  }
  return groups.map(sources => ({
    item: sources.find(row => row.data_available && row.kind !== "approved")
      ?? sources.find(row => row.data_available)
      ?? sources.find(row => row.kind !== "approved") ?? sources[0],
    sources,
  })).sort((a, b) => Number(b.item.data_available) - Number(a.item.data_available) || a.item.title.localeCompare(b.item.title, "ko"));
}

export default async function StatisticsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const params = await searchParams;
  const snapshots = await loadCurrentStatisticsSnapshots();
  const currentById = new Map(snapshots.map(result => [result.dataset.id, result]));
  const catalog = statisticsCatalog().map(item => {
    const current = item.dataset_id ? currentById.get(item.dataset_id) : undefined;
    return current ? { ...item, description: current.dataset.description } : item;
  });
  const status = statisticsStatus();
  const groups = groupStatisticsCatalog(catalog);
  const portals = catalog.filter(item => item.kind === "portal");
  const aliases = Object.fromEntries(groups.flatMap(group => group.sources.flatMap(source => [[source.id, group.item.id], ...(source.dataset_id ? [[source.dataset_id, group.item.id]] : [])])));
  const defaultId = aliases["population:middle-aged"] ?? aliases["stat:2760"] ?? groups[0]?.item.id ?? "";
  const initialId = params.id && Object.hasOwn(aliases, params.id) ? aliases[params.id] : defaultId;
  const initialDatasetId = groups.find(group => group.item.id === initialId)?.item.dataset_id;
  const initialKosis = initialDatasetId?.startsWith("kosis:") ? verifiedStatistics(initialDatasetId) : null;
  const connectedCount = new Set(groups.filter(group => group.item.data_available && group.item.dataset_id).map(group => group.item.dataset_id)).size;
  const fieldCount = new Set(groups.map(group => group.item.category)).size;
  const checkedDate = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(status.directory_checked_at));
  return <main className="mx-auto max-w-[1280px] space-y-8 px-4 py-6 sm:px-6 sm:py-8">
    <PageUsage page="statistics" tab="statistics" />
    <section aria-labelledby="statistics-title" className="overflow-hidden rounded-(--jeju-radius-lg) border border-(--jeju-shell-border) bg-card">
      <div aria-hidden="true" className="h-1 bg-[linear-gradient(90deg,var(--jeju-blue)_0_34%,var(--jeju-green)_34%_67%,var(--jeju-orange)_67%)]" />
      <div className="grid gap-6 p-5 sm:p-8 lg:grid-cols-[1.3fr_1fr] lg:items-center">
        <div><p className="text-(length:--jeju-text-sm) font-bold tracking-wide text-primary">공식 복지·인구 통계 · WELFARE STATISTICS</p><h1 id="statistics-title" className="mt-2 text-(length:--jeju-h1-size) font-extrabold leading-tight text-(--jeju-text-strong)">복지통계</h1><p className="mt-4 text-(length:--jeju-text-lg) font-bold text-(--jeju-text-strong)">복지의 현재를 숫자로 읽다.</p><p className="mt-2 max-w-[60ch] leading-relaxed text-muted-foreground">지역별 인구와 복지·보건 지표를 한곳에서 찾아보세요. 통계마다 연령 기준, 자료 시점과 단위를 확인하며 공식 원문까지 이어집니다.</p><p className="mt-3 max-w-[60ch] text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">새 공표자료를 주기적으로 확인해 검증 후 반영합니다. 자료마다 공표 주기가 다릅니다.</p></div>
        <div className="rounded-(--jeju-radius-lg) bg-(--jeju-surface-inset) p-5"><dl className="grid grid-cols-3 gap-3 text-center">{[["통계 항목", groups.length], ["수치 조회", connectedCount], ["통계 분야", fieldCount]].map(([label, count]) => <div key={label}><dt className="text-(length:--jeju-text-sm) text-muted-foreground">{label}</dt><dd className="mt-2 text-3xl font-extrabold tabular-nums text-(--jeju-text-strong)">{count}</dd></div>)}</dl><p className="mt-5 border-t border-border pt-4 text-center text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">중복 통계는 하나의 항목으로 모았습니다.<br />목록 {checkedDate} 확인 · 통계별 자료 시점 표시</p></div>
      </div>
    </section>
    <StatisticsExplorer groups={groups} aliases={aliases} snapshots={initialKosis ? [...snapshots, initialKosis] : snapshots} initialId={initialId} />
    <section aria-labelledby="statistics-official-sources"><h2 id="statistics-official-sources" className="text-(length:--jeju-h2-size) font-extrabold">자료의 출발점</h2><p className="mt-2 text-(length:--jeju-text-sm) text-muted-foreground">공식 통계 목록, 주민등록인구 자료와 KOSIS 공개 통계표를 바탕으로 구성했습니다. 각 통계의 상세 설명과 최신 공표 내용은 원문에서 확인하세요.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{STATISTICS_SOURCES.map(source => <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer" className="rounded-(--jeju-radius-lg) border border-border bg-card p-5 outline-none hover:border-primary focus-visible:shadow-(--jeju-focus-ring)"><span className="flex items-start justify-between gap-3 font-bold text-primary">{source.title}<ExternalLinkIcon /></span><span className="mt-2 block text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">{source.scope}</span><span className="sr-only">(새 창)</span></a>)}</div></section>
    <section aria-labelledby="statistics-portals"><div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="statistics-portals" className="text-(length:--jeju-h2-size) font-extrabold">통계기관·원문 서비스</h2><span className="text-(length:--jeju-text-sm) text-muted-foreground">{portals.length}곳</span></div><p className="mt-2 text-(length:--jeju-text-sm) text-muted-foreground">더 넓은 주제나 지역의 자료는 각 기관에서 찾아보세요. 아래 기관 링크는 위의 통계 항목 수에 포함하지 않습니다.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{portals.map(portal => <a id={`statistics-source-${portal.id.replace(":", "-")}`} key={portal.id} href={portal.source_url} target="_blank" rel="noopener noreferrer" className={`min-w-0 rounded-(--jeju-radius-lg) border p-4 outline-none hover:border-primary focus-visible:shadow-(--jeju-focus-ring) ${params.id === portal.id ? "border-primary bg-(--jeju-primary-tint)" : "border-border bg-card"}`}><span className="flex items-start justify-between gap-3 font-bold text-(--jeju-text-strong)">{portal.title}<ExternalLinkIcon className="shrink-0 text-primary" /></span><span className="mt-2 block text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">{portal.description}</span><span className="sr-only">(새 창)</span></a>)}</div></section>
    <p className="text-(length:--jeju-text-sm) text-muted-foreground">레이아웃 참고: <a href="https://github.com/changeroa/StyleGallery" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">StyleGallery의 Dashboard·List-detail 패턴<span className="sr-only">(새 창)</span></a> · 대시보드의 색상과 탐색 방식에 맞게 적용했습니다.</p>
  </main>;
}
