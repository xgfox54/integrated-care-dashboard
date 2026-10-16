"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRightIcon, ExternalLinkIcon, InfoIcon, SearchIcon } from "@/components/ui/jeju-icons";
import { WelfareMcpCopy } from "@/components/welfaremcp-copy";
import { PopulationStatistics } from "@/components/statistics/population-statistics";
import type { StatisticsCatalogItem, StatisticsPoint, StatisticsResult } from "@/lib/statistics/types";
import { statisticsCsv } from "@/lib/statistics/csv";
import { statisticsSourceDate } from "@/lib/statistics/source-date";

const FOCUS = "outline-none focus-visible:shadow-(--jeju-focus-ring)";
const LINK = "inline-flex items-center gap-1 font-bold text-primary underline underline-offset-4 " + FOCUS;
const CONTROL = "min-h-(--jeju-control-h) rounded-(--jeju-radius) border border-border bg-card px-3 py-2 text-(length:--jeju-text-sm) " + FOCUS;
const STATES = { VERIFIED_SNAPSHOT: "공식표 확인본", LIVE: "공식표 확인 완료", CACHED: "최근 확인한 공식표", SNAPSHOT_FALLBACK: "이전 확인본 제공" };
const VALUE_STATES = { VALUE: "수록값", MISSING: "자료 없음", CONFIDENTIAL: "비공개", PROVISIONAL: "잠정치", ESTIMATE: "추정치" };
export interface StatisticsCatalogGroup { readonly item: StatisticsCatalogItem; readonly sources: readonly StatisticsCatalogItem[] }
const PAGE_SIZE = 8;
function normalized(value: string): string { return value.normalize("NFKC").toLowerCase().replace(/\s/g, ""); }
function number(value: number | null): string { return value === null ? "자료 없음" : new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 }).format(value); }
function date(value: string): string { return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(value)); }
function dateTime(value: string): string { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? "확인 시각 미제공" : new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }).format(parsed); }
function periodLabel(value: string): string { return /^\d{4}-\d{2}$/.test(value) ? `${value.slice(0, 4)}년 ${Number(value.slice(5))}월` : /^\d{4}$/.test(value) ? `${value}년` : value; }
function sourceLabel(item: StatisticsCatalogItem): string { return item.kind === "approved" ? "보건복지부 승인통계 목록" : item.kind === "indicator" ? "e-나라지표" : "공식 인구통계"; }
function sourceDateText(result: StatisticsResult): string {
  const source = statisticsSourceDate(result.dataset);
  return source ? `${source.label} ${date(source.date)}` : "원자료 공표일 미확인";
}
function resolveAlias(aliases: Readonly<Record<string, string>>, id: string): string { return Object.hasOwn(aliases, id) ? aliases[id] : id; }
function filterGroups(groups: readonly StatisticsCatalogGroup[], query: string, category: string): StatisticsCatalogGroup[] {
  const words = query.trim().split(/\s+/).map(normalized).filter(Boolean);
  return groups.filter(group => (!category || group.item.category === category)
    && words.every(word => normalized(group.sources.map(row => row.title + " " + row.description + " " + row.category + (row.data_provider === "index" ? " 지표누리 API" : "")).join(" ")).includes(word)));
}
function resultFreshness(result: StatisticsResult): number {
  return Math.max(0, ...[result.checked_at, result.auto_refresh?.last_attempt_at, result.auto_refresh?.last_success_at].map(value => value ? Date.parse(value) : 0).filter(Number.isFinite));
}
function mergeCurrentResults(previous: Record<string, StatisticsResult>, incoming: readonly StatisticsResult[]): Record<string, StatisticsResult> {
  const next = { ...previous };
  for (const result of incoming) {
    const current = previous[result.dataset.id];
    if (current) {
      if (resultFreshness(result) < resultFreshness(current)) continue;
      const currentPeriod = [...current.dataset.periods].sort().at(-1);
      const nextPeriod = [...result.dataset.periods].sort().at(-1);
      if (currentPeriod && (!nextPeriod || nextPeriod < currentPeriod)) continue;
    }
    next[result.dataset.id] = result;
  }
  return next;
}

function AutoRefreshStatus({ result }: { result: StatisticsResult }) {
  const refresh = result.auto_refresh;
  if (!refresh) return null;
  const delayed = refresh.status === "retry_wait" || refresh.status === "unavailable";
  const label = !refresh.enabled ? "준비 중" : refresh.status === "checking" ? "확인 중" : delayed ? "다시 확인 예정" : refresh.last_success_at ? "정상" : "첫 확인 대기";
  const description = !refresh.enabled ? "현재는 저장된 공식표 확인본을 제공합니다."
    : delayed ? "자동 확인이 지연되어 마지막으로 확인한 자료를 유지합니다. 새 자료가 확인되면 표와 카드에 함께 반영합니다."
    : refresh.status === "checking" ? "자료 갱신을 진행하고 있습니다. 검증이 끝날 때까지 기존 자료를 표시합니다."
    : refresh.last_success_at ? "공식 원문에 새 자료가 확인되면 표와 카드에 함께 반영합니다."
    : "아직 자동 확인을 마치지 않아 저장된 공식표 확인본을 표시합니다.";
  return <aside aria-label="통계 자동 갱신 상태" className="mt-4 rounded-(--jeju-radius) border border-border bg-(--jeju-surface-inset) p-4 text-(length:--jeju-text-sm)">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold text-(--jeju-text-strong)">자동 갱신 <span className={`ml-2 font-medium ${delayed ? "text-(--jeju-danger)" : "text-(--jeju-secondary-strong)"}`}>{label}</span></p>{refresh.enabled && <span className="text-muted-foreground">{refresh.interval_hours}시간 간격</span>}</div>
    <p className="mt-2 leading-relaxed text-muted-foreground">{description}</p>
    <dl className="mt-3 grid gap-3 sm:grid-cols-2"><div><dt className="text-muted-foreground">마지막 확인</dt><dd className="mt-1 font-medium text-(--jeju-text-strong)">{refresh.last_success_at ? <time dateTime={refresh.last_success_at}>{dateTime(refresh.last_success_at)}</time> : "자동 확인 전"}</dd></div><div><dt className="text-muted-foreground">다음 확인 예정</dt><dd className="mt-1 font-medium text-(--jeju-text-strong)">{refresh.enabled && refresh.next_check_at ? <time dateTime={refresh.next_check_at}>{dateTime(refresh.next_check_at)}</time> : refresh.enabled ? "일정 확인 중" : "예정 없음"}</dd></div></dl>
    {delayed && refresh.last_attempt_at && <p className="mt-3 text-muted-foreground">최근 확인 시도 <time dateTime={refresh.last_attempt_at}>{dateTime(refresh.last_attempt_at)}</time></p>}
  </aside>;
}

function TrendChart({ points, label, unit }: { points: readonly StatisticsPoint[]; label: string; unit: string }) {
  const usable = points.filter(p => p.value !== null);
  if (!usable.length) return <div className="flex min-h-52 items-center justify-center rounded-(--jeju-radius) bg-(--jeju-surface-inset) p-6 text-muted-foreground">선택한 기간에 표시할 수치가 없습니다.</div>;
  const width = 680, left = 92, right = 22, top = 20, bottom = 225;
  const maximum = Math.max(...usable.map(p => p.value!));
  const minimum = Math.min(0, ...usable.map(p => p.value!));
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(Math.abs(minimum), maximum, 1))));
  const ceiling = Math.ceil(Math.max(maximum, 0) / magnitude) * magnitude || magnitude;
  const floor = Math.floor(minimum / magnitude) * magnitude;
  const x = (i: number) => left + (points.length === 1 ? (width - left - right) / 2 : i / (points.length - 1) * (width - left - right));
  const y = (value: number) => bottom - (value - floor) / (ceiling - floor) * (bottom - top);
  const segments: string[][] = []; let segment: string[] = [];
  points.forEach((point, i) => { if (point.value === null) { if (segment.length) segments.push(segment); segment = []; } else segment.push(`${x(i)},${y(point.value)}`); });
  if (segment.length) segments.push(segment);
  return <figure aria-label={`${label} 연도별 변화`}>
    <p className="mb-1 text-right text-(length:--jeju-text-sm) text-muted-foreground">단위: {unit}</p>
    <div className="overflow-x-auto rounded-(--jeju-radius) border border-border bg-card">
      <svg viewBox="0 0 680 265" className="block min-w-[540px] w-full" role="img" aria-label={`${label}. ${points[0]?.period}년부터 ${points.at(-1)?.period}년까지. 아래 표에서 정확한 값을 확인할 수 있습니다.`}>
        {[0, 1, 2, 3, 4].map(i => { const value = floor + (ceiling - floor) * i / 4; return <g key={i}><line x1={left} x2={width-right} y1={y(value)} y2={y(value)} stroke="var(--border)" strokeDasharray={i ? "3 5" : undefined} /><text x={left-12} y={y(value)+4} textAnchor="end" fontSize="12" fill="var(--muted-foreground)">{number(value)}</text></g>; })}
        {floor < 0 && <line x1={left} x2={width-right} y1={y(0)} y2={y(0)} stroke="var(--muted-foreground)" />}
        {segments.map((path, i) => <polyline key={i} points={path.join(" ")} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" />)}
        {points.map((point, i) => <g key={point.period}>
          {point.value !== null && <circle cx={x(i)} cy={y(point.value)} r="4" fill="var(--card)" stroke="var(--primary)" strokeWidth="2"><title>{`${point.period}년: ${number(point.value)} ${unit}${point.status === "PROVISIONAL" ? " (잠정치)" : point.status === "ESTIMATE" ? " (추정치)" : ""}`}</title></circle>}
          {(i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 6) === 0) && <text x={x(i)} y="250" textAnchor="middle" fontSize="12" fill="var(--muted-foreground)">{point.period}</text>}
        </g>)}
      </svg>
    </div>
    <figcaption className="mt-2 text-(length:--jeju-text-sm) text-muted-foreground">연도별 수록값 · 선이 끊긴 구간은 결측이며 0으로 연결하지 않습니다.</figcaption>
  </figure>;
}

function saveCsv(result: StatisticsResult, seriesId: string, periods: readonly string[]) {
  const csv = statisticsCsv(result, seriesId, periods); if (csv === null) return;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `welfare-statistics-${result.dataset.table_code}.csv`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function StatisticsExplorer({ groups, aliases, snapshots, initialId, initialQuery = "", initialCategory = "", initialPage }: { groups: readonly StatisticsCatalogGroup[]; aliases: Readonly<Record<string, string>>; snapshots: readonly StatisticsResult[]; initialId: string; initialQuery?: string; initialCategory?: string; initialPage?: number }) {
  const canonicalInitialId = resolveAlias(aliases, initialId);
  const [query, setQuery] = useState(initialQuery); const [category, setCategory] = useState(initialCategory);
  const [page, setPage] = useState(() => initialPage !== undefined ? Math.max(0, initialPage - 1) : Math.floor(Math.max(0, groups.findIndex(group => group.item.id === canonicalInitialId)) / PAGE_SIZE));
  const [selectedId, setSelectedId] = useState(canonicalInitialId);
  const [results, setResults] = useState<Record<string, StatisticsResult>>(() => Object.fromEntries(snapshots.map(result => [result.dataset.id, result])));
  const [settled, setSettled] = useState({ key: "", error: "" }); const [retry, setRetry] = useState(0);
  const [seriesChoice, setSeriesChoice] = useState<{ id: string; series: string } | null>(null);
  const [fromYear, setFromYear] = useState(""); const [toYear, setToYear] = useState("");
  const currentDatasetIds = useMemo(() => new Set(groups.flatMap(group => group.item.dataset_id ? [group.item.dataset_id] : [])), [groups]);
  const categories = useMemo(() => [...new Set(groups.map(group => group.item.category))].sort((a,b) => a.localeCompare(b,"ko")), [groups]);
  const categoryCounts = useMemo(() => {
    const matching = filterGroups(groups, query, "");
    return { total: matching.length, byCategory: new Map(categories.map(value => [value, matching.filter(group => group.item.category === value).length])) };
  }, [groups, query, categories]);
  const filtered = useMemo(() => filterGroups(groups, query, category), [groups, query, category]);
  const selectedGroup = filtered.find(group => group.item.id === selectedId) ?? filtered[0] ?? null;
  const item = selectedGroup?.item ?? null;
  const datasetId = item?.dataset_id ?? ""; const result = results[datasetId];
  const requestKey = datasetId + ":" + retry;
  const loading = Boolean(datasetId) && settled.key !== requestKey; const error = settled.key === requestKey ? settled.error : "";
  const series = result?.dataset.series.find(row => row.id === (seriesChoice?.id === datasetId ? seriesChoice.series : result.dataset.highlight_series_id)) ?? result?.dataset.series[0];
  const invalidPeriod = Boolean(fromYear && toYear && fromYear > toYear);
  const points = invalidPeriod ? [] : (series?.points ?? []).filter(p => (!fromYear || p.period >= fromYear) && (!toYear || p.period <= toYear));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); const currentPage = Math.min(page, pageCount - 1);

  function writeListState(nextQuery: string, nextCategory: string, nextPage: number) {
    const url = new URL(window.location.href);
    for (const [key, value] of [["q", nextQuery.trim()], ["cat", nextCategory], ["page", nextPage > 0 ? String(nextPage + 1) : ""]] as const) if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    window.history.replaceState(null, "", url);
  }
  function select(id: string) { const canonicalId = resolveAlias(aliases, id); setSelectedId(canonicalId); setSeriesChoice(null); setFromYear(""); setToYear(""); const url = new URL(window.location.href); if (canonicalId) url.searchParams.set("id", canonicalId); else url.searchParams.delete("id"); window.history.replaceState(null, "", url); }
  function updateFilters(nextQuery: string, nextCategory: string) {
    const firstPage = filterGroups(groups, nextQuery, nextCategory).slice(0, PAGE_SIZE);
    setQuery(nextQuery); setCategory(nextCategory); setPage(0); writeListState(nextQuery, nextCategory, 0);
    select(firstPage.find(group => group.item.id === selectedId)?.item.id ?? firstPage[0]?.item.id ?? "");
  }
  function changePage(nextPage: number) { setPage(nextPage); writeListState(query, category, nextPage); select(filtered[nextPage * PAGE_SIZE]?.item.id ?? ""); }
  function reveal(id: string) {
    const canonicalId = resolveAlias(aliases, id);
    const nextPage = Math.floor(Math.max(0, groups.findIndex(group => group.item.id === canonicalId)) / PAGE_SIZE);
    setQuery(""); setCategory(""); setPage(nextPage); writeListState("", "", nextPage); select(canonicalId);
  }
  useEffect(() => {
    const onPop = () => { const id = new URL(window.location.href).searchParams.get("id") ?? canonicalInitialId; const canonicalId = resolveAlias(aliases, id); const index = groups.findIndex(group => group.item.id === canonicalId); const fallbackIndex = Math.max(0, groups.findIndex(group => group.item.id === canonicalInitialId)); const nextIndex = index < 0 ? fallbackIndex : index; setSelectedId(groups[nextIndex]?.item.id ?? ""); setPage(Math.floor(nextIndex / PAGE_SIZE)); setQuery(""); setCategory(""); setSeriesChoice(null); setFromYear(""); setToYear(""); };
    window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop);
  }, [groups, aliases, canonicalInitialId]);
  useEffect(() => {
    if (!datasetId) return;
    const controller = new AbortController(); let disposed = false;
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    const key = datasetId + ":" + retry;
    fetch("/api/statistics?id=" + encodeURIComponent(datasetId), { signal: controller.signal }).then(async response => { const body = await response.json() as StatisticsResult & { ok?: boolean }; if (!response.ok || !body?.ok || body.dataset?.id !== datasetId) throw new Error("통계 확인에 실패했습니다."); return body; }).then(value => { if (!disposed) setResults(previous => mergeCurrentResults(previous, [value])); return ""; }).catch(() => "통계 확인에 연결하지 못했습니다. 아래에는 저장된 공식표 확인본을 표시합니다.").then(message => { window.clearTimeout(timeout); if (!disposed) setSettled({ key, error: message }); });
    return () => { disposed = true; window.clearTimeout(timeout); controller.abort(); };
  }, [datasetId, retry]);
  useEffect(() => {
    let disposed = false;
    let timer: number | null = null;
    let requestTimeout: number | null = null;
    let controller: AbortController | null = null;
    let refreshAfterPending = false;
    const visible = () => document.visibilityState === "visible";
    const clearTimer = () => { if (timer !== null) { window.clearTimeout(timer); timer = null; } };
    const clearRequestTimeout = () => { if (requestTimeout !== null) { window.clearTimeout(requestTimeout); requestTimeout = null; } };
    const schedule = (delay: number) => {
      clearTimer();
      if (!disposed && visible()) timer = window.setTimeout(() => { timer = null; void refresh(); }, delay);
    };
    const refresh = async () => {
      if (disposed || !visible() || controller) return;
      clearTimer();
      const active = new AbortController();
      controller = active;
      requestTimeout = window.setTimeout(() => active.abort(), 20000);
      try {
        const response = await fetch("/api/statistics?view=current", { signal: active.signal, cache: "no-store" });
        const body = await response.json() as { ok?: boolean; results?: StatisticsResult[] };
        if (!response.ok || body?.ok !== true || !Array.isArray(body.results)) return;
        const incoming = body.results.filter(row => row?.dataset && currentDatasetIds.has(row.dataset.id)
          && Array.isArray(row.dataset.periods) && Array.isArray(row.dataset.series));
        if (!disposed && visible() && !active.signal.aborted && incoming.length) setResults(previous => mergeCurrentResults(previous, incoming));
      } catch {
        // Keep the currently displayed verified values when a background read fails.
      } finally {
        clearRequestTimeout();
        controller = null;
        const delay = refreshAfterPending ? 0 : 60000;
        refreshAfterPending = false;
        schedule(delay);
      }
    };
    const onVisibility = () => {
      clearTimer();
      if (visible()) {
        if (controller) refreshAfterPending = true;
        else void refresh();
      } else {
        refreshAfterPending = false;
        clearRequestTimeout();
        controller?.abort();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    schedule(15000);
    return () => {
      disposed = true;
      clearTimer();
      clearRequestTimeout();
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [currentDatasetIds]);

  return <div className="space-y-8">
    <section aria-labelledby="statistics-highlights">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 id="statistics-highlights" className="font-extrabold text-(--jeju-text-strong)">주요 통계 한눈에</h2><p className="text-(length:--jeju-text-sm) text-muted-foreground">카드를 선택해 통계표 조회 · 통계마다 자료 시점이 다릅니다.</p></div>
      <div className="mb-3 grid gap-3 md:grid-cols-3">
        {["population:middle-aged", "population:older", "population:children"].map(id => {
          const snapshot = results[id] ?? snapshots.find(row => row.dataset.id === id);
          const selected = snapshot?.dataset.series.find(row => row.id === snapshot.dataset.highlight_series_id);
          const point = selected?.points.at(-1);
          if (!snapshot || !selected || !point) return null;
          return <button type="button" key={id} onClick={() => reveal(id)} aria-pressed={item?.dataset_id === id} className={`group min-w-0 rounded-(--jeju-radius-lg) border bg-card p-5 text-left transition-colors hover:border-primary ${item?.dataset_id === id ? "border-primary" : "border-border"} ${FOCUS}`}>
            <span className="flex flex-wrap items-center justify-between gap-2 text-(length:--jeju-text-sm)"><span className="font-bold text-(--jeju-text-strong)">{snapshot.dataset.title}</span><span className="rounded-full bg-(--jeju-primary-tint) px-2 py-0.5 text-primary">지역별</span></span>
            <span className="mt-2 block text-(length:--jeju-text-sm) text-muted-foreground">{snapshot.dataset.population?.age_label} · 전국 주민등록인구</span>
            <span className="mt-4 flex flex-wrap items-baseline gap-x-2"><strong className="text-[clamp(1.55rem,2.2vw,2rem)] font-extrabold tabular-nums tracking-tight text-(--jeju-text-strong)">{number(point.value)}</strong><span className="text-(length:--jeju-text-sm) text-muted-foreground">{selected.unit}</span></span>
            <span className="mt-3 flex flex-wrap items-center justify-between gap-2 text-(length:--jeju-text-sm)"><span className="rounded bg-(--jeju-surface-inset) px-2 py-0.5 text-muted-foreground">{periodLabel(point.period)}</span><span className="inline-flex items-center gap-1 font-bold text-primary">지역 비교<ArrowRightIcon /></span></span>
          </button>;
        })}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {["stat:2760", "stat:2766", "stat:3053", "stat:2709"].map(id => {
          const snapshot = results[id] ?? snapshots.find(row => row.dataset.id === id); const selected = snapshot?.dataset.series.find(row => row.id === snapshot.dataset.highlight_series_id); const point = selected?.points.at(-1); const previous = selected?.points.at(-2);
          if (!snapshot || !selected || !point) return null;
          const change = point.value !== null && previous?.value && Number(point.period) === Number(previous.period) + 1 ? (point.value - previous.value) / previous.value * 100 : null;
          return <button type="button" key={id} onClick={() => reveal(id)} aria-pressed={item?.dataset_id === id} className={`group min-w-0 rounded-(--jeju-radius-lg) border bg-card p-5 text-left transition-colors hover:border-primary ${item?.dataset_id === id ? "border-primary" : "border-border"} ${FOCUS}`}>
            <span className="block text-(length:--jeju-text-sm) font-bold text-muted-foreground">{snapshot.dataset.title}</span>
            <span className="mt-4 flex flex-wrap items-baseline gap-x-2"><strong className="text-[clamp(1.55rem,2.2vw,2rem)] font-extrabold tabular-nums tracking-tight text-(--jeju-text-strong)">{number(point.value)}</strong><span className="text-(length:--jeju-text-sm) text-muted-foreground">{selected.unit}</span></span>
            <span className="mt-3 flex flex-wrap items-center justify-between gap-2 text-(length:--jeju-text-sm)"><span className="rounded bg-(--jeju-surface-inset) px-2 py-0.5 text-muted-foreground">{periodLabel(point.period)}</span><span className="font-bold text-primary">{change === null ? "원문 표 보기" : `전년 대비 ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}</span></span>
          </button>;
        })}
      </div>
    </section>

    <section aria-labelledby="statistics-explore" data-jeju-profile="public" className="space-y-4">
      <div><h2 id="statistics-explore" className="text-(length:--jeju-h2-size) font-extrabold text-(--jeju-text-strong)">필요한 통계를 찾아보세요</h2><p className="mt-2 text-muted-foreground">모든 통계를 하나의 목록에서 검색합니다. 지역별 인구와 분야별 통계의 수치·원문을 함께 확인하세요.</p></div>
      <div className="space-y-4 rounded-(--jeju-radius-lg) border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--jeju-radius) bg-(--jeju-surface-inset) p-4"><p className="text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">지표누리의 복지·보건 지표 {groups.filter(group => group.sources.some(source => source.data_provider === "index")).length}종 · 연도별 차트와 표, CSV 제공</p><button type="button" data-jeju-profile="public" onClick={() => updateFilters("지표누리 API", "")} className={`${CONTROL} font-bold text-primary`}>지표누리 자료 보기<ArrowRightIcon className="ml-2 inline" /></button></div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="min-w-0 flex-1"><label htmlFor="statistics-query" className="mb-1.5 block text-(length:--jeju-text-sm) font-bold">통계명 검색</label><div className="relative"><SearchIcon className="pointer-events-none absolute left-3 top-3 text-muted-foreground" /><input id="statistics-query" type="search" maxLength={200} value={query} onChange={event => updateFilters(event.target.value, category)} placeholder="예: 중장년 인구, 아동 인구, 노인복지시설" className={`${CONTROL} w-full pl-10`} /></div></div>{(query || category) && <button type="button" onClick={() => updateFilters("", "")} className={`${CONTROL} font-bold text-primary`}>초기화</button>}</div>
        <div className="border-t border-border pt-4"><div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><p id="statistics-category-label" className="text-(length:--jeju-text-sm) font-bold">분야별 묶어보기</p><p className="text-(length:--jeju-text-sm) text-muted-foreground">{query ? "현재 검색어에 해당하는 항목 수입니다." : "분야를 선택하면 해당 통계만 모아봅니다."}</p></div><div role="group" aria-labelledby="statistics-category-label" className="flex flex-wrap gap-2">{[{ value: "", label: "전체", count: categoryCounts.total }, ...categories.map(value => ({ value, label: value, count: categoryCounts.byCategory.get(value) ?? 0 }))].map(option => <button type="button" key={option.value} aria-pressed={category === option.value} aria-label={`${option.label} 통계 ${option.count}개`} onClick={() => updateFilters(query, option.value)} className={`${CONTROL} inline-flex items-center gap-2 font-bold ${category === option.value ? "border-primary bg-(--jeju-primary-tint) text-primary" : "text-(--jeju-text-body) hover:border-primary hover:bg-(--jeju-surface-inset)"}`}><span>{option.label}</span><span className="min-w-5 text-center tabular-nums">{option.count}</span></button>)}</div></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-(length:--jeju-text-sm) text-muted-foreground"><p role="status" aria-live="polite">{filtered.length}개 통계{query || category ? ` / 전체 ${groups.length}개` : ""}</p><p>수치 조회 가능 항목 우선 · 통계명순</p></div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(15rem,0.7fr)_minmax(0,1.65fr)]">
        <div className="min-w-0">
          {filtered.length ? <ul aria-label="검색된 통계 목록" className="space-y-2">{filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE).map(({ item: row }) => <li key={row.id}><button type="button" onClick={() => select(row.id)} aria-pressed={row.id === item?.id} className={`w-full rounded-(--jeju-radius-lg) border p-4 text-left ${row.id === item?.id ? "border-primary bg-(--jeju-primary-tint)" : "border-border bg-card hover:border-primary"} ${FOCUS}`}>
            <span className="mb-2 flex flex-wrap items-center gap-2 text-(length:--jeju-text-sm)"><span className="text-muted-foreground">{row.category}</span><span className={`rounded-full px-2 py-0.5 ${row.data_available ? "bg-(--jeju-green-light) text-(--jeju-secondary-strong)" : "bg-(--jeju-surface-inset) text-muted-foreground"}`}>{row.data_available ? "수치 조회" : "원문 안내"}</span></span>
            <span className="block font-bold leading-relaxed text-(--jeju-text-strong)">{row.title}</span>
            {row.publication_schedule && <span className="mt-1 block text-(length:--jeju-text-sm) text-muted-foreground">공표예정 {row.publication_schedule}</span>}
          </button></li>)}</ul> : <div className="rounded-(--jeju-radius-lg) border border-dashed border-border p-6 text-center"><p className="font-bold">검색 결과가 없습니다.</p><p className="mt-2 text-(length:--jeju-text-sm) text-muted-foreground">다른 통계명이나 분야로 다시 찾아보세요.</p><button type="button" onClick={() => updateFilters("", "")} className={`${LINK} mt-4`}>검색 조건 초기화</button></div>}
          {pageCount > 1 && <nav aria-label="통계 목록 페이지" className="mt-4 flex items-center justify-between gap-2"><button type="button" disabled={currentPage === 0} onClick={() => changePage(currentPage-1)} className={`${CONTROL} disabled:opacity-40`}>이전</button><span className="text-(length:--jeju-text-sm)">{currentPage + 1} / {pageCount}</span><button type="button" disabled={currentPage === pageCount - 1} onClick={() => changePage(currentPage+1)} className={`${CONTROL} disabled:opacity-40`}>다음</button></nav>}
        </div>
        <section aria-labelledby="statistics-detail-title" className="min-w-0 rounded-(--jeju-radius-lg) border border-border bg-card p-5 sm:p-6">
          {!item ? <div className="flex min-h-64 items-center justify-center text-muted-foreground">통계 목록에서 항목을 선택하세요.</div> : <>
            <p className="text-(length:--jeju-text-sm) font-bold text-primary">{item.category} · {item.data_available ? "수치 조회" : "원문 안내"}</p>
            {item.data_provider === "index" && <p className="mt-2 text-(length:--jeju-text-sm) font-bold text-primary">지표누리 Open API</p>}
            <h3 id="statistics-detail-title" className="mt-2 text-(length:--jeju-h2-size) font-extrabold leading-snug text-(--jeju-text-strong)">{item.title}</h3>
            <p className="mt-2 text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">{result?.dataset.description ?? item.description}</p>
            {result && series ? <>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-y border-border py-3 text-(length:--jeju-text-sm)"><span className="font-bold text-(--jeju-secondary-strong)">{STATES[result.state]}</span><span className="text-muted-foreground">{sourceDateText(result)} · {result.dataset.population ? "지역별 주민등록인구" : result.dataset.kosis ? "KOSIS 공개 통계표" : "전국 집계"}</span></div>
              <div className="mt-3 text-(length:--jeju-text-sm) leading-relaxed" role="status" aria-live="polite">
                {loading ? <p className="text-muted-foreground">{result.dataset.population ? "저장된 인구통계 확인본을 불러오고 있습니다." : result.dataset.kosis ? "KOSIS 통계표 확인본을 불러오고 있습니다." : "공식 표를 확인하고 있습니다. 현재는 저장된 확인본을 표시합니다."}</p> : null}
                {error ? <p className="text-(--jeju-danger)">{error} <button type="button" onClick={() => setRetry(value => value+1)} className={LINK}>다시 확인</button></p> : null}
                {result.refresh_error && <p className="rounded-(--jeju-radius) bg-(--jeju-surface-inset) p-3 text-muted-foreground">현재 자동 확인이 지연되어 이전 확인본을 제공합니다. 최신 공표 내용은 원문에서 확인해 주세요.</p>}
              </div>
              <AutoRefreshStatus result={result} />
              {result.dataset.index_api && <p className="mt-3 text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">{result.revision.startsWith("index-api:") ? "등록한 인증키로 확인한 지표누리 자료" : "지표누리 공식표 확인본 · 등록한 인증키로 자동 갱신"}{result.dataset.index_api.projection && " · 장래인구 추계 포함"}</p>}
              {result.dataset.population ? <div className="mt-5"><PopulationStatistics key={result.dataset.id} result={result} /></div> : <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="sm:col-span-2"><label htmlFor="statistics-series" className="mb-1.5 block text-(length:--jeju-text-sm) font-bold">조회 항목</label><select id="statistics-series" value={series.id} onChange={event => setSeriesChoice({ id: datasetId, series: event.target.value })} className={`${CONTROL} w-full`}>{result.dataset.series.map(row => <option key={row.id} value={row.id}>{row.label} ({row.unit})</option>)}</select></div>
                <div><label htmlFor="statistics-from" className="mb-1.5 block text-(length:--jeju-text-sm) font-bold">시작연도</label><select id="statistics-from" value={fromYear} onChange={event => setFromYear(event.target.value)} className={`${CONTROL} w-full`}><option value="">전체</option>{result.dataset.periods.map(year => <option key={year}>{year}</option>)}</select></div>
                <div><label htmlFor="statistics-to" className="mb-1.5 block text-(length:--jeju-text-sm) font-bold">종료연도</label><select id="statistics-to" value={toYear} onChange={event => setToYear(event.target.value)} className={`${CONTROL} w-full`}><option value="">전체</option>{result.dataset.periods.map(year => <option key={year}>{year}</option>)}</select></div>
              </div>
              {invalidPeriod && <p role="alert" className="mt-3 text-(length:--jeju-text-sm) text-(--jeju-danger)">시작연도를 종료연도보다 앞선 시점으로 선택해 주세요.</p>}
              <div className="mt-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold">{series.label}</h4><button type="button" disabled={!points.length} onClick={() => saveCsv(result, series.id, points.map(p => p.period))} className={`${CONTROL} font-bold text-primary disabled:opacity-40`}>현재 표 CSV</button></div><TrendChart points={points} label={series.label} unit={series.unit} /></div>
              <div className="mt-5 max-w-full overflow-x-auto rounded-(--jeju-radius) border border-border"><table className="w-full text-(length:--jeju-text-sm)"><caption className="sr-only">{series.label} 연도별 수치. 단위 {series.unit}.</caption><thead className="bg-(--jeju-surface-inset) text-(--jeju-text-strong)"><tr><th scope="col" className="px-4 py-3 text-left">연도</th><th scope="col" className="px-4 py-3 text-right">수치 ({series.unit})</th><th scope="col" className="px-4 py-3 text-right">상태</th></tr></thead><tbody className="divide-y divide-border">{[...points].reverse().map(point => <tr key={point.period}><th scope="row" className="whitespace-nowrap px-4 py-2.5 text-left font-medium">{point.period}년</th><td className="px-4 py-2.5 text-right font-bold tabular-nums">{point.value === null ? point.raw || "—" : number(point.value)}</td><td className="whitespace-nowrap px-4 py-2.5 text-right text-muted-foreground">{VALUE_STATES[point.status]}</td></tr>)}</tbody></table>{!points.length && <p className="p-5 text-center text-muted-foreground">선택한 기간의 수치가 없습니다.</p>}</div>
              <aside className="mt-4 flex gap-2 rounded-(--jeju-radius) bg-(--jeju-primary-tint) p-4 text-(length:--jeju-text-sm) leading-relaxed"><InfoIcon className="mt-0.5 shrink-0 text-primary" /><p>{result.dataset.note}</p></aside>
              <div className="mt-5 border-t border-border pt-4 text-(length:--jeju-text-sm) leading-relaxed"><p className="font-bold text-(--jeju-text-strong)">출처와 해석 기준</p><p className="mt-2 text-muted-foreground">{result.dataset.source_name}</p><p className="mt-1 text-muted-foreground">통계표: {result.dataset.table_title} · 표 코드 {result.dataset.table_code}</p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2"><a href={result.dataset.source_url} target="_blank" rel="noopener noreferrer" className={LINK}>{result.dataset.kosis ? "KOSIS 통계표" + (result.dataset.kosis.tables.length > 1 ? ": " + result.dataset.kosis.tables[0].title : "") : "공식 통계표"}<ExternalLinkIcon /><span className="sr-only">(새 창)</span></a>{result.dataset.kosis ? result.dataset.kosis.tables.slice(1).map(table => <a key={table.tbl_id} href={table.url} target="_blank" rel="noopener noreferrer" className={LINK}>KOSIS 통계표: {table.title}<ExternalLinkIcon /><span className="sr-only">(새 창)</span></a>) : <a href={result.dataset.indicator_url} target="_blank" rel="noopener noreferrer" className={LINK}>지표 해설<ExternalLinkIcon /><span className="sr-only">(새 창)</span></a>}{result.dataset.index_api?.tables?.slice(1).map(table => <a key={table.table_code} href={table.source_url} target="_blank" rel="noopener noreferrer" className={LINK}>{table.table_title}<ExternalLinkIcon /><span className="sr-only">(새 창)</span></a>)}</div><details className="mt-4"><summary className={`cursor-pointer font-bold ${FOCUS}`}>원문 주석과 수록 범위</summary><div className="mt-2 space-y-2 text-muted-foreground"><p>{result.dataset.source_notes}</p>{result.coverage.gaps.map(text => <p key={text}>{text}</p>)}<p>확인일은 원문을 확인한 날짜입니다. 표의 연도가 실제 관측 시점입니다.</p></div></details></div>
              </>}
            </> : item.data_available ? <div role="status" className="mt-6 rounded-(--jeju-radius) bg-(--jeju-surface-inset) p-5 text-(length:--jeju-text-sm) leading-relaxed">{error ? <p className="text-(--jeju-danger)">통계 수치를 불러오지 못했습니다. <button type="button" onClick={() => setRetry(value => value+1)} className={LINK}>다시 확인</button></p> : <p className="text-muted-foreground">통계 수치를 불러오고 있습니다.</p>}</div> : <div className="mt-6 space-y-4">
              <div className="rounded-(--jeju-radius) bg-(--jeju-surface-inset) p-5"><h4 className="font-bold">공식 원문에서 확인할 수 있습니다</h4><p className="mt-2 text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">이 항목은 통계명과 공식 출처를 제공합니다. 아직 수치가 수록되지 않았으며, 통계값이 0이라는 뜻은 아닙니다.</p></div>
              <a href={item.source_url} target="_blank" rel="noopener noreferrer" className={LINK}>공식 출처 열기<ExternalLinkIcon /><span className="sr-only">(새 창)</span></a><p className="text-(length:--jeju-text-sm) text-muted-foreground">목록 확인 {date(item.checked_at)}</p>
            </div>}
            {selectedGroup && <details className="mt-6 border-t border-border pt-4 text-(length:--jeju-text-sm)"><summary className={`cursor-pointer font-bold text-(--jeju-text-strong) ${FOCUS}`}>목록 출처·작성 정보{selectedGroup.sources.length > 1 ? ` (${selectedGroup.sources.length}개 목록)` : ""}</summary><div className="mt-3 space-y-4">{selectedGroup.sources.map(source => <div key={source.id} className="rounded-(--jeju-radius) bg-(--jeju-surface-inset) p-4"><a href={source.source_url} target="_blank" rel="noopener noreferrer" className={LINK}>{sourceLabel(source)}<ExternalLinkIcon /><span className="sr-only">(새 창)</span></a><p className="mt-2 font-bold text-(--jeju-text-strong)">{source.title}</p>{(source.department || source.method || source.publication_schedule) && <dl className="mt-3 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 leading-relaxed">{source.department && <><dt className="text-muted-foreground">소관부서</dt><dd>{source.department}</dd></>}{source.method && <><dt className="text-muted-foreground">작성방법</dt><dd>{source.method}</dd></>}{source.publication_schedule && <><dt className="text-muted-foreground">공표예정</dt><dd>{source.publication_schedule}<span className="mt-1 block text-muted-foreground">공표예정일은 관측 시점이 아닙니다. 실제 공표 여부와 자료 기준연도는 원문에서 확인하세요.</span></dd></>}</dl>}<p className="mt-3 text-muted-foreground">목록 확인 {date(source.checked_at)}</p></div>)}</div></details>}
          </>}
        </section>
      </div>
    </section>

    <aside className="grid gap-5 rounded-(--jeju-radius-lg) border border-(--jeju-shell-border) bg-(--jeju-primary-tint) p-5 sm:p-6 lg:grid-cols-[1fr_1.2fr] lg:items-center">
      <div><p className="text-(length:--jeju-text-sm) font-bold text-primary">복지정보MCP 연결</p><h2 className="mt-2 text-(length:--jeju-h2-size) font-extrabold">통계도 대화로 찾아보세요</h2><p className="mt-2 text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">같은 통계표를 AI 대화에서 조회합니다. 숫자뿐 아니라 연도·단위·출처와 수록 범위를 함께 요청하세요.</p><a href="/welfaremcp" className={`${LINK} mt-4`}>MCP 설치 방법<ArrowRightIcon /></a></div>
      <div className="rounded-(--jeju-radius) border border-border bg-card p-4"><p className="mb-4 leading-relaxed">복지통계에서 국민기초생활보장 수급자 수의 2021~2025년 추이를 보여줘. 단위, 잠정치 여부, 원문과 확인일을 함께 알려줘.</p><WelfareMcpCopy value="복지통계에서 국민기초생활보장 수급자 수의 2021~2025년 추이를 보여줘. 단위, 잠정치 여부, 원문과 확인일을 함께 알려줘." label="통계 질문 복사" /></div>
    </aside>
  </div>;
}
