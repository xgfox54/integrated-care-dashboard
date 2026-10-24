"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRightIcon, ExternalLinkIcon, SearchIcon } from "@/components/ui/jeju-icons";
import { WelfareMcpCopy } from "@/components/welfaremcp-copy";
import { PopulationStatistics } from "@/components/statistics/population-statistics";
import { StatisticsOverview } from "@/components/statistics/statistics-overview";
import { invalidStatisticRange, statisticPointsInRange, usablePoint } from "@/lib/statistics/presentation";
import { StatisticsComparison } from "@/components/statistics/statistics-comparison";
import { IndexStatisticsCatalog } from "@/components/statistics/index-statistics-catalog";
import { KosisStatisticsCatalog } from "@/components/statistics/kosis-statistics-catalog";
import type { StatisticsCatalogItem, StatisticsResult } from "@/lib/statistics/types";
import { statisticsCsv } from "@/lib/statistics/csv";
import { statisticsSourceDate } from "@/lib/statistics/source-date";
import { statisticsRefreshLabel, statisticsRefreshReason } from "@/lib/statistics/refresh-status";
import { STATISTICS_HIGHLIGHTS, statisticsYearChange } from "@/lib/statistics/highlights";
import { filterStatisticsGroups, readStatisticsView, statisticsProvider, writeStatisticsView } from "@/lib/statistics/explorer-state";
import type { StatisticsComparisonChoice, StatisticsFilterGroup, StatisticsProvider, StatisticsViewState } from "@/lib/statistics/explorer-state";

const FOCUS = "outline-none focus-visible:shadow-(--jeju-focus-ring)";
const LINK = "inline-flex items-center gap-1 font-bold text-primary underline underline-offset-4 " + FOCUS;
const CONTROL = "min-h-(--jeju-control-h) rounded-(--jeju-radius) border border-border bg-card px-3 py-2 text-(length:--jeju-text-sm) " + FOCUS;
const STATES = { VERIFIED_SNAPSHOT: "공식표 확인본", LIVE: "공식표 확인 완료", CACHED: "최근 확인한 공식표", SNAPSHOT_FALLBACK: "이전 확인본 제공" };
const VALUE_STATES = { VALUE: "수록값", MISSING: "자료 없음", CONFIDENTIAL: "비공개", PROVISIONAL: "잠정치", ESTIMATE: "추정치" };
export type StatisticsCatalogGroup = StatisticsFilterGroup;
const PAGE_SIZE = 8;
function number(value: number | null): string { return value === null ? "자료 없음" : new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 }).format(value); }
function date(value: string): string { return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(value)); }
function dateTime(value: string): string { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? "확인 시각 미제공" : new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }).format(parsed); }
function periodLabel(value: string): string { return /^\d{4}-\d{2}$/.test(value) ? `${value.slice(0, 4)}년 ${Number(value.slice(5))}월` : /^\d{4}$/.test(value) ? `${value}년` : value; }
function sourceLabel(item: StatisticsCatalogItem): string { return { approved: "보건복지부 승인통계 목록", indicator: "e-나라지표", population: "공식 인구통계", kosis: "KOSIS 복지 통계 목록", portal: "통계기관" }[item.kind]; }
function sourceDateText(result: StatisticsResult): string {
  const source = statisticsSourceDate(result.dataset);
  return source ? `${source.label} ${date(source.date)}` : "원자료 공표일 미확인";
}
function resolveAlias(aliases: Readonly<Record<string, string>>, id: string): string { return Object.hasOwn(aliases, id) ? aliases[id] : id; }
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
  const label = statisticsRefreshLabel(refresh);
  const description = !refresh.enabled ? "현재는 저장된 공식표 확인본을 제공합니다."
    : delayed ? "자동 확인이 지연되어 마지막으로 확인한 자료를 유지합니다. 새 자료가 확인되면 표와 카드에 함께 반영합니다."
    : refresh.status === "checking" ? "자료 갱신을 진행하고 있습니다. 검증이 끝날 때까지 기존 자료를 표시합니다."
    : refresh.continuation_pending ? "중간 확인 내용을 저장했습니다. 다음 확인에서 이어받아 검증한 뒤 반영합니다."
    : refresh.last_success_at ? "공식 원문에 새 자료가 확인되면 표와 카드에 함께 반영합니다."
    : "아직 자동 확인을 마치지 않아 저장된 공식표 확인본을 표시합니다.";
  return <aside aria-label="통계 자동 갱신 상태" className="mt-4 rounded-(--jeju-radius) border border-border bg-(--jeju-surface-inset) p-4 text-(length:--jeju-text-sm)">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold text-(--jeju-text-strong)">자동 갱신 <span className={`ml-2 font-medium ${delayed ? "text-(--jeju-danger)" : "text-(--jeju-secondary-strong)"}`}>{label}</span></p>{refresh.enabled && <span className="text-muted-foreground">{refresh.interval_hours}시간 간격</span>}</div>
    <p className="mt-2 leading-relaxed text-muted-foreground">{description}</p>
    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
      <div><dt className="text-muted-foreground">자료 기준 시점</dt><dd className="mt-1 font-medium text-(--jeju-text-strong)">{periodLabel(result.dataset.periods.at(-1) ?? "미제공")}</dd></div>
      <div><dt className="text-muted-foreground">표시 자료 확인일</dt><dd className="mt-1 font-medium text-(--jeju-text-strong)"><time dateTime={result.checked_at}>{dateTime(result.checked_at)}</time></dd></div>
      <div><dt className="text-muted-foreground">최근 자동 확인 성공</dt><dd className="mt-1 font-medium text-(--jeju-text-strong)">{refresh.last_success_at ? <time dateTime={refresh.last_success_at}>{dateTime(refresh.last_success_at)}</time> : "자동 확인 전 · 공식표 확인본 제공"}</dd></div>
      <div><dt className="text-muted-foreground">다음 확인 예정</dt><dd className="mt-1 font-medium text-(--jeju-text-strong)">{refresh.status === "checking" ? "현재 확인 중" : refresh.enabled && refresh.check_due ? "확인 시각 도래 · 다음 실행에서 확인" : refresh.enabled && refresh.next_check_at ? <time dateTime={refresh.next_check_at}>{dateTime(refresh.next_check_at)}</time> : refresh.enabled ? "다음 접속 시 확인" : "예정 없음"}</dd></div>
    </dl>
    {refresh.last_attempt_at && <p className="mt-3 text-muted-foreground">최근 확인 시도 <time dateTime={refresh.last_attempt_at}>{dateTime(refresh.last_attempt_at)}</time></p>}
    {delayed && <p className="mt-2 text-(--jeju-danger)">{statisticsRefreshReason(refresh.error_code)}</p>}
    {refresh.enabled && <p className="mt-2 text-muted-foreground">자료 기준 시점과 자동 확인일은 다릅니다. 접속이 없으면 다음 접속 때 확인을 이어갑니다.</p>}
  </aside>;
}

function saveCsv(result: StatisticsResult, seriesId: string, periods: readonly string[]) {
  const csv = statisticsCsv(result, seriesId, periods); if (csv === null) return;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `welfare-statistics-${result.dataset.table_code}.csv`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function StatisticsExplorer({ groups, aliases, snapshots, initialId, initialQuery = "", initialCategory = "", initialPage, initialView = readStatisticsView(new URLSearchParams()) }: { groups: readonly StatisticsCatalogGroup[]; aliases: Readonly<Record<string, string>>; snapshots: readonly StatisticsResult[]; initialId: string; initialQuery?: string; initialCategory?: string; initialPage?: number; initialView?: StatisticsViewState }) {
  const canonicalInitialId = resolveAlias(aliases, initialId);
  const initialDatasetId = groups.find(group => group.item.id === canonicalInitialId)?.item.dataset_id ?? "";
  const [query, setQuery] = useState(initialQuery); const [category, setCategory] = useState(initialCategory);
  const [provider, setProvider] = useState(initialView.provider);
  const [regionalOnly, setRegionalOnly] = useState(initialView.regional);
  const [comparison, setComparison] = useState(initialView.comparison);
  const [shareMessage, setShareMessage] = useState("");
  const [page, setPage] = useState(() => initialPage !== undefined ? Math.max(0, initialPage - 1) : Math.floor(Math.max(0, filterStatisticsGroups(groups, initialQuery, initialCategory, initialView.provider, initialView.regional).findIndex(group => group.item.id === canonicalInitialId)) / PAGE_SIZE));
  const [selectedId, setSelectedId] = useState(canonicalInitialId);
  const [results, setResults] = useState<Record<string, StatisticsResult>>(() => Object.fromEntries(snapshots.map(result => [result.dataset.id, result])));
  const [settled, setSettled] = useState({ key: "", error: "" }); const [retry, setRetry] = useState(0);
  const [seriesChoice, setSeriesChoice] = useState<{ id: string; series: string } | null>(() => initialView.series ? { id: initialDatasetId, series: initialView.series } : null);
  const [fromYear, setFromYear] = useState(initialView.from); const [toYear, setToYear] = useState(initialView.to);
  const [detailNavigation, setDetailNavigation] = useState(0);
  const currentDatasetIds = useMemo(() => new Set(groups.flatMap(group => group.item.dataset_id ? [group.item.dataset_id] : [])), [groups]);
  const categories = useMemo(() => [...new Set(groups.map(group => group.item.category))].sort((a,b) => a.localeCompare(b,"ko")), [groups]);
  const categoryCounts = useMemo(() => {
    const matching = filterStatisticsGroups(groups, query, "", provider, regionalOnly);
    return { total: matching.length, byCategory: new Map(categories.map(value => [value, matching.filter(group => group.item.category === value).length])) };
  }, [groups, query, categories, provider, regionalOnly]);
  const filtered = useMemo(() => filterStatisticsGroups(groups, query, category, provider, regionalOnly), [groups, query, category, provider, regionalOnly]);
  const selectedGroup = filtered.find(group => group.item.id === selectedId) ?? filtered[0] ?? null;
  const item = selectedGroup?.item ?? null;
  const datasetId = item?.dataset_id ?? ""; const result = results[datasetId];
  const requestKey = datasetId + ":" + retry;
  const loading = Boolean(datasetId) && settled.key !== requestKey; const error = settled.key === requestKey ? settled.error : "";
  const series = result?.dataset.series.find(row => row.id === (seriesChoice?.id === datasetId ? seriesChoice.series : result.dataset.highlight_series_id)) ?? result?.dataset.series[0];
  const invalidPeriod = invalidStatisticRange(fromYear, toYear);
  const points = statisticPointsInRange(series?.points ?? [], fromYear, toYear);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); const currentPage = Math.min(page, pageCount - 1);

  function persistView(patch: Partial<StatisticsViewState>, selected?: string) {
    const url = new URL(window.location.href);
    writeStatisticsView(url.searchParams, { provider, regional: regionalOnly, series: seriesChoice?.id === datasetId ? seriesChoice.series : "", from: fromYear, to: toYear, comparison, ...patch });
    if (selected !== undefined) { if (selected) url.searchParams.set("id", selected); else url.searchParams.delete("id"); }
    setShareMessage("");
    window.history.replaceState(null, "", url);
  }
  function changeComparison(choice: StatisticsComparisonChoice) { setComparison(choice); persistView({ comparison: choice }); }
  async function copyAddress() {
    try { await navigator.clipboard.writeText(window.location.href); setShareMessage("조회 조건이 담긴 주소를 복사했습니다."); }
    catch { setShareMessage("주소를 복사하지 못했습니다. 브라우저 주소창에서 주소를 복사해 주세요."); }
  }

  function writeListState(nextQuery: string, nextCategory: string, nextPage: number) {
    const url = new URL(window.location.href);
    for (const [key, value] of [["q", nextQuery.trim()], ["cat", nextCategory], ["page", nextPage > 0 ? String(nextPage + 1) : ""]] as const) if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    window.history.replaceState(null, "", url);
  }
  function select(id: string, nextProvider = provider, nextRegional = regionalOnly, detailSeries = "") {
    const canonicalId = resolveAlias(aliases, id);
    const nextDataset = groups.find(group => group.item.id === canonicalId)?.item.dataset_id ?? "";
    setSelectedId(canonicalId); setSeriesChoice(detailSeries ? { id: nextDataset, series: detailSeries } : null); setFromYear(""); setToYear(""); setComparison(null);
    persistView({ provider: nextProvider, regional: nextRegional, series: detailSeries, from: "", to: "", comparison: null }, canonicalId);
  }
  function selectFromList(id: string) {
    select(id);
    const detail = document.getElementById("statistics-detail-title");
    if (window.innerWidth < 1024 || (detail && detail.getBoundingClientRect().top > window.innerHeight * 0.8)) {
      setDetailNavigation(value => value + 1);
    }
  }
  function updateFilters(nextQuery: string, nextCategory: string, nextProvider: StatisticsProvider = provider, nextRegional = regionalOnly) {
    const firstPage = filterStatisticsGroups(groups, nextQuery, nextCategory, nextProvider, nextRegional).slice(0, PAGE_SIZE);
    setProvider(nextProvider); setRegionalOnly(nextRegional);
    setQuery(nextQuery); setCategory(nextCategory); setPage(0); writeListState(nextQuery, nextCategory, 0);
    select(firstPage.find(group => group.item.id === selectedId)?.item.id ?? firstPage[0]?.item.id ?? "", nextProvider, nextRegional);
  }
  function changePage(nextPage: number) { setPage(nextPage); writeListState(query, category, nextPage); select(filtered[nextPage * PAGE_SIZE]?.item.id ?? ""); }
  function reveal(id: string, detailSeries = "") {
    const canonicalId = resolveAlias(aliases, id);
    const nextPage = Math.floor(Math.max(0, groups.findIndex(group => group.item.id === canonicalId)) / PAGE_SIZE);
    setQuery(""); setCategory(""); setProvider(""); setRegionalOnly(false); setPage(nextPage); writeListState("", "", nextPage); select(canonicalId, "", false, detailSeries);
  }
  function revealDetail(id: string, seriesId?: string) { reveal(id, seriesId); setDetailNavigation(value => value + 1); }
  useEffect(() => {
    if (!detailNavigation) return;
    document.getElementById("statistics-detail-title")?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [detailNavigation]);
  useEffect(() => {
    const onPop = () => {
      const params = new URL(window.location.href).searchParams;
      const view = readStatisticsView(params);
      const canonicalId = resolveAlias(aliases, params.get("id") ?? canonicalInitialId);
      const nextQuery = (params.get("q") ?? "").slice(0, 200);
      const nextCategory = categories.includes(params.get("cat") ?? "") ? params.get("cat") ?? "" : "";
      const matching = filterStatisticsGroups(groups, nextQuery, nextCategory, view.provider, view.regional);
      const index = Math.max(0, matching.findIndex(group => group.item.id === canonicalId));
      const requested = Number(params.get("page"));
      const nextId = matching.find(group => group.item.id === canonicalId)?.item.id ?? matching[0]?.item.id ?? "";
      const nextDataset = groups.find(group => group.item.id === nextId)?.item.dataset_id ?? "";
      setSelectedId(nextId); setPage(Number.isInteger(requested) && requested > 0 ? Math.min(requested, 1000) - 1 : Math.floor(index / PAGE_SIZE));
      setQuery(nextQuery); setCategory(nextCategory); setProvider(view.provider); setRegionalOnly(view.regional);
      setSeriesChoice(view.series ? { id: nextDataset, series: view.series } : null); setFromYear(view.from); setToYear(view.to); setComparison(view.comparison); setShareMessage("");
    };
    window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop);
  }, [groups, aliases, canonicalInitialId, categories]);
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
        const response = await fetch("/api/statistics?view=current&selected_id=" + encodeURIComponent(datasetId), { signal: active.signal, cache: "no-store" });
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
  }, [currentDatasetIds, datasetId]);

  return <div className="space-y-8">
    <section aria-labelledby="statistics-highlights">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 id="statistics-highlights" className="font-extrabold text-(--jeju-text-strong)">주요 통계 한눈에</h2><p className="text-(length:--jeju-text-sm) text-muted-foreground">인구 4종 · 복지·돌봄 대표지표 8종</p></div>
      <p className="mb-4 text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">카드를 누르면 해당 항목의 표와 차트로 이동합니다. 기준 시점·원단위·집계 범위를 함께 확인하세요.</p>
      <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {["population:total", "population:middle-aged", "population:older", "population:children"].map(id => {
          const snapshot = results[id] ?? snapshots.find(row => row.dataset.id === id);
          const selected = snapshot?.dataset.series.find(row => row.id === snapshot.dataset.highlight_series_id);
          const point = selected?.points.at(-1);
          if (!snapshot || !selected || !point) return null;
          return <button type="button" key={id} onClick={() => revealDetail(id)} aria-pressed={item?.dataset_id === id} className={`group min-w-0 rounded-(--jeju-radius-lg) border border-border p-5 text-left transition-colors hover:bg-(--jeju-surface-inset) ${item?.dataset_id === id ? "bg-(--jeju-primary-tint)" : "bg-card"} ${FOCUS}`}>
            <span className="flex flex-wrap items-center justify-between gap-2 text-(length:--jeju-text-sm)"><span className="font-bold text-(--jeju-text-strong)">{snapshot.dataset.title}</span><span className="rounded-full bg-(--jeju-primary-tint) px-2 py-0.5 text-primary">지역별</span></span>
            <span className="mt-2 block text-(length:--jeju-text-sm) text-muted-foreground">{snapshot.dataset.population?.age_label} · 전국 주민등록인구</span>
            <span className="mt-4 flex flex-wrap items-baseline gap-x-2"><strong className="text-[clamp(1.55rem,2.2vw,2rem)] font-extrabold tabular-nums tracking-tight text-(--jeju-text-strong)">{number(point.value)}</strong><span className="text-(length:--jeju-text-sm) text-muted-foreground">{selected.unit}</span></span>
            <span className="mt-3 flex flex-wrap items-center justify-between gap-2 text-(length:--jeju-text-sm)"><span className="rounded bg-(--jeju-surface-inset) px-2 py-0.5 text-muted-foreground">{periodLabel(point.period)}</span><span className="inline-flex items-center gap-1 font-bold text-primary">지역 비교<ArrowRightIcon /></span></span>
          </button>;
        })}
      </div>
      <div className="mb-3 mt-5 flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-bold text-(--jeju-text-strong)">복지·돌봄 대표지표</h3><p className="text-(length:--jeju-text-sm) text-muted-foreground">KOSIS 대표 자료 · 관련 지표누리 통계도 함께 조회</p></div>
      <div aria-label="복지·돌봄 대표지표 카드" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {STATISTICS_HIGHLIGHTS.map(card => {
          const id = card.dataset_id;
          const snapshot = results[id] ?? snapshots.find(row => row.dataset.id === id);
          const selected = snapshot?.dataset.series.find(row => row.id === card.series_id);
          const point = selected?.points.at(-1);
          if (!snapshot || !selected || !point) return null;
          const change = statisticsYearChange(selected);
          return <article key={id} className="flex min-w-0 flex-col rounded-(--jeju-radius-lg) border border-border bg-card">
            <button type="button" onClick={() => revealDetail(id, card.series_id)} aria-pressed={item?.dataset_id === id && series?.id === card.series_id} className={`group flex flex-1 flex-col rounded-(--jeju-radius-lg) p-5 text-left transition-colors hover:bg-(--jeju-surface-inset) ${item?.dataset_id === id && series?.id === card.series_id ? "bg-(--jeju-primary-tint)" : "bg-card"} ${FOCUS}`}>
              <span className="text-(length:--jeju-text-sm) font-bold text-primary">{snapshot.dataset.category} · KOSIS</span>
              <span className="mt-2 block font-bold text-(--jeju-text-strong)">{card.title}</span>
              <span className="mt-2 block min-h-10 text-(length:--jeju-text-sm) leading-5 text-muted-foreground">{card.scope}</span>
              <span className="mt-4 flex flex-wrap items-baseline gap-x-2"><strong className="text-[clamp(1.55rem,2.2vw,2rem)] font-extrabold tabular-nums tracking-tight text-(--jeju-text-strong)">{point.value === null ? VALUE_STATES[point.status] : number(point.value)}</strong><span className="text-(length:--jeju-text-sm) text-muted-foreground">{selected.unit}</span>{point.status !== "VALUE" && point.value !== null && <span className="rounded-full bg-(--jeju-surface-inset) px-2 py-0.5 text-(length:--jeju-text-sm) text-muted-foreground">{VALUE_STATES[point.status]}</span>}</span>
              <span className="mt-3 flex w-full flex-wrap items-center justify-between gap-2 text-(length:--jeju-text-sm)"><span className="rounded bg-(--jeju-surface-inset) px-2 py-0.5 text-muted-foreground">{periodLabel(point.period)}</span><span className="font-bold text-primary">{change ? `전년 대비 ${change.value >= 0 ? "+" : ""}${change.value.toFixed(1)}${change.unit}` : "연도별 표 보기"}</span></span>
              <span className="mt-3 flex w-full flex-wrap items-center justify-between gap-2 text-(length:--jeju-text-sm)"><span className="text-muted-foreground">{snapshot.refresh_error ? "이전 확인본 제공" : `확인 ${date(snapshot.checked_at)}`}</span><span className="inline-flex items-center gap-1 font-bold text-primary">상세 조회<ArrowRightIcon /></span></span>
            </button>
            {card.related && <details className="border-t border-border px-5 text-(length:--jeju-text-sm)"><summary className={`cursor-pointer py-3 leading-5 font-bold text-muted-foreground ${FOCUS}`}>관련 출처·집계 기준</summary><p className="mt-2 leading-relaxed text-muted-foreground">{card.related.note}</p><button type="button" onClick={() => revealDetail(card.related?.dataset_id ?? id)} className={`${CONTROL} my-3 w-full text-left font-bold text-primary`}>지표누리 관련 통계 조회<ArrowRightIcon className="ml-1 inline" /></button></details>}
          </article>;
        })}
      </div>
    </section>

    <KosisStatisticsCatalog groups={groups} selectedId={item?.id ?? ""} onSelect={revealDetail} />
    <IndexStatisticsCatalog groups={groups} selectedId={item?.id ?? ""} onSelect={revealDetail} />
    <section aria-labelledby="statistics-explore" data-jeju-profile="public" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="statistics-explore" className="text-(length:--jeju-h2-size) font-extrabold text-(--jeju-text-strong)">필요한 통계를 찾아보세요</h2><p className="mt-2 text-muted-foreground">모든 통계를 하나의 목록에서 검색합니다. 지역별 인구와 분야별 통계의 수치·원문을 함께 확인하세요.</p></div><button type="button" onClick={copyAddress} className={`${CONTROL} font-bold text-primary`}>조회 주소 복사</button></div>
      {shareMessage && <p role="status" aria-live="polite" className="text-(length:--jeju-text-sm) text-primary">{shareMessage}</p>}
      <div className="space-y-4 rounded-(--jeju-radius-lg) border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-(--jeju-radius) bg-(--jeju-surface-inset) p-4"><p className="text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">지표누리의 복지·보건 지표 {groups.filter(group => group.sources.some(source => source.data_provider === "index")).length}종 · 연도별 차트와 표, CSV 제공</p><button type="button" data-jeju-profile="public" onClick={() => updateFilters("", "", "index", false)} className={`${CONTROL} font-bold text-primary`}>지표누리 자료 보기<ArrowRightIcon className="ml-2 inline" /></button></div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="min-w-0 flex-1"><label htmlFor="statistics-query" className="mb-1.5 block text-(length:--jeju-text-sm) font-bold">통계명 검색</label><div className="relative"><SearchIcon className="pointer-events-none absolute left-3 top-3 text-muted-foreground" /><input id="statistics-query" type="search" maxLength={200} value={query} onChange={event => updateFilters(event.target.value, category)} placeholder="예: 중장년 인구, 아동 인구, 노인복지시설" className={`${CONTROL} w-full pl-10`} /></div></div>{(query || category || provider || regionalOnly) && <button type="button" onClick={() => updateFilters("", "", "", false)} className={`${CONTROL} font-bold text-primary`}>초기화</button>}</div>
        <div className="grid gap-3 sm:grid-cols-2 sm:items-end"><div><label htmlFor="statistics-provider" className="mb-1.5 block text-(length:--jeju-text-sm) font-bold">통계 출처</label><select id="statistics-provider" value={provider} onChange={event => updateFilters(query, category, statisticsProvider(event.target.value))} className={`${CONTROL} w-full`}>{[["", "전체 출처"], ["kosis", "KOSIS 국가통계포털"], ["index", "지표누리 e-나라지표"], ["population", "공식 인구통계"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><label className="flex min-h-(--jeju-control-h) cursor-pointer items-center gap-2 rounded-(--jeju-radius) border border-border px-3 py-2 text-(length:--jeju-text-sm) font-bold"><input id="statistics-regional" type="checkbox" checked={regionalOnly} onChange={event => updateFilters(query, category, provider, event.target.checked)} className={`size-4 shrink-0 accent-(--jeju-primary) ${FOCUS}`} />지역 비교 가능한 통계만</label></div>
        <div className="border-t border-border pt-4"><div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><p id="statistics-category-label" className="text-(length:--jeju-text-sm) font-bold">분야별 묶어보기</p><p className="text-(length:--jeju-text-sm) text-muted-foreground">{query ? "현재 검색어에 해당하는 항목 수입니다." : "분야를 선택하면 해당 통계만 모아봅니다."}</p></div><div role="group" aria-labelledby="statistics-category-label" className="flex flex-wrap gap-2">{[{ value: "", label: "전체", count: categoryCounts.total }, ...categories.map(value => ({ value, label: value, count: categoryCounts.byCategory.get(value) ?? 0 }))].map(option => <button type="button" key={option.value} aria-pressed={category === option.value} aria-label={`${option.label} 통계 ${option.count}개`} onClick={() => updateFilters(query, option.value)} className={`${CONTROL} inline-flex items-center gap-2 font-bold ${category === option.value ? "border-primary bg-(--jeju-primary-tint) text-primary" : "text-(--jeju-text-body) hover:border-primary hover:bg-(--jeju-surface-inset)"}`}><span>{option.label}</span><span className="min-w-5 text-center tabular-nums">{option.count}</span></button>)}</div></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-(length:--jeju-text-sm) text-muted-foreground"><p role="status" aria-live="polite">{filtered.length}개 통계{query || category || provider || regionalOnly ? ` / 전체 ${groups.length}개` : ""}</p><p>수치 조회 가능 항목 우선 · 통계명순</p></div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(15rem,0.7fr)_minmax(0,1.65fr)]">
        <div className="min-w-0">
          {filtered.length ? <ul aria-label="검색된 통계 목록" className="space-y-2">{filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE).map(({ item: row }) => <li key={row.id}><button type="button" onClick={() => selectFromList(row.id)} aria-pressed={row.id === item?.id} className={`w-full rounded-(--jeju-radius-lg) border p-4 text-left ${row.id === item?.id ? "border-primary bg-(--jeju-primary-tint)" : "border-border bg-card hover:border-primary"} ${FOCUS}`}>
            <span className="mb-2 flex flex-wrap items-center gap-2 text-(length:--jeju-text-sm)"><span className="text-muted-foreground">{row.category}</span><span className={`rounded-full px-2 py-0.5 ${row.data_available ? "bg-(--jeju-green-light) text-(--jeju-secondary-strong)" : "bg-(--jeju-surface-inset) text-muted-foreground"}`}>{row.data_available ? "수치 조회" : "원문 안내"}</span></span>
            <span className="block font-bold leading-relaxed text-(--jeju-text-strong)">{row.title}</span>
            {row.publication_schedule && <span className="mt-1 block text-(length:--jeju-text-sm) text-muted-foreground">공표예정 {row.publication_schedule}</span>}
          </button></li>)}</ul> : <div className="rounded-(--jeju-radius-lg) border border-dashed border-border p-6 text-center"><p className="font-bold">검색 결과가 없습니다.</p><p className="mt-2 text-(length:--jeju-text-sm) text-muted-foreground">다른 통계명이나 분야로 다시 찾아보세요.</p><button type="button" onClick={() => updateFilters("", "", "", false)} className={`${LINK} mt-4`}>검색 조건 초기화</button></div>}
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
              {result.dataset.source_review?.warning && <p role="note" className="mt-3 rounded-(--jeju-radius) bg-(--jeju-primary-tint) p-3 text-(length:--jeju-text-sm) leading-relaxed">{result.dataset.source_review.warning}</p>}
              {invalidPeriod && <p role="alert" className="mt-3 text-(length:--jeju-text-sm) text-(--jeju-danger)">시작 시점을 종료 시점보다 앞서게 선택해 주세요. 조회 항목·기간 설정에서 변경합니다.</p>}
              <StatisticsOverview key={`${result.dataset.id}:${series.id}`} result={result} series={series} points={points} />
              {result.warnings.length > 0 && <ul aria-label="자료 이용 안내" className="mt-3 space-y-1 text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">{result.warnings.filter(text => text !== result.dataset.note && !(result.refresh_error && text === "자동 확인이 지연되어 마지막 정상 자료를 유지합니다. 자료 기준 시점과 원문 확인 시각은 다릅니다.")).map(text => <li key={text}>{text}</li>)}</ul>}
              {!result.coverage.complete && <p className="mt-3 text-(length:--jeju-text-sm) text-muted-foreground">일부 범위만 수록된 자료입니다. {result.coverage.gaps.join(" ")}</p>}
              {result.dataset.index_api?.projection && <p className="mt-3 text-(length:--jeju-text-sm) font-bold text-muted-foreground">장래인구 추계를 포함한 자료입니다.</p>}
              {!result.refresh_error && (result.auto_refresh?.status === "retry_wait" || result.auto_refresh?.status === "unavailable") && <p className="mt-3 text-(length:--jeju-text-sm) text-muted-foreground">자동 확인이 지연되어 마지막 확인 자료를 제공합니다.</p>}

              <div className="mt-5 divide-y divide-border border-t border-border">
              <details key={`settings:${result.dataset.id}`} className="py-3"><summary className={`min-h-11 cursor-pointer content-center font-bold text-primary ${FOCUS}`}>조회 항목·기간 설정</summary>
              <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="sm:col-span-2"><label htmlFor="statistics-series" className="mb-1.5 block text-(length:--jeju-text-sm) font-bold">조회 항목</label><select id="statistics-series" value={series.id} onChange={event => { setSeriesChoice({ id: datasetId, series: event.target.value }); persistView({ series: event.target.value }); }} className={`${CONTROL} w-full`}>{result.dataset.series.map(row => <option key={row.id} value={row.id}>{row.label} ({row.unit})</option>)}</select></div>
                <div><label htmlFor="statistics-from" className="mb-1.5 block text-(length:--jeju-text-sm) font-bold">시작 시점</label><select id="statistics-from" value={fromYear} onChange={event => { setFromYear(event.target.value); persistView({ from: event.target.value }); }} className={`${CONTROL} w-full`}><option value="">전체</option>{result.dataset.periods.map(year => <option key={year} value={year}>{periodLabel(year)}</option>)}</select></div>
                <div><label htmlFor="statistics-to" className="mb-1.5 block text-(length:--jeju-text-sm) font-bold">종료 시점</label><select id="statistics-to" value={toYear} onChange={event => { setToYear(event.target.value); persistView({ to: event.target.value }); }} className={`${CONTROL} w-full`}><option value="">전체</option>{result.dataset.periods.map(year => <option key={year} value={year}>{periodLabel(year)}</option>)}</select></div>
              </div>
              </details>
              <details key={`comparison:${result.dataset.id}`} className="py-3"><summary className={`min-h-11 cursor-pointer content-center font-bold text-primary ${FOCUS}`}>지역·기간 비교</summary><StatisticsComparison result={result} choice={comparison} onChange={changeComparison} /></details>
              <details key={`table:${result.dataset.id}`} className="py-3"><summary className={`min-h-11 cursor-pointer content-center font-bold text-primary ${FOCUS}`}>{result.dataset.population ? "지역별 상세 수치·지도·CSV" : "상세 수치표·CSV"}</summary>
              {result.dataset.population ? <PopulationStatistics key={result.dataset.id} result={result} /> : <>
              <button type="button" disabled={!points.length} onClick={() => saveCsv(result, series.id, points.map(p => p.period))} className={`${CONTROL} mt-3 font-bold text-primary disabled:opacity-40`}>현재 표 CSV</button>
              <div className="mt-5 max-w-full overflow-x-auto rounded-(--jeju-radius) border border-border"><table className="w-full text-(length:--jeju-text-sm)"><caption className="sr-only">{series.label} 시점별 수치. 단위 {series.unit}.</caption><thead className="bg-(--jeju-surface-inset) text-(--jeju-text-strong)"><tr><th scope="col" className="px-4 py-3 text-left">시점</th><th scope="col" className="px-4 py-3 text-right">수치 ({series.unit})</th><th scope="col" className="px-4 py-3 text-right">상태</th></tr></thead><tbody className="divide-y divide-border">{[...points].reverse().map(point => <tr key={point.period}><th scope="row" className="whitespace-nowrap px-4 py-2.5 text-left font-medium">{periodLabel(point.period)}</th><td className="px-4 py-2.5 text-right font-bold tabular-nums">{usablePoint(point) ? number(point.value) : VALUE_STATES[point.status]}</td><td className="whitespace-nowrap px-4 py-2.5 text-right text-muted-foreground">{VALUE_STATES[point.status]}</td></tr>)}</tbody></table>{!points.length && <p className="p-5 text-center text-muted-foreground">선택한 기간의 수치가 없습니다.</p>}</div>
              </>}
              </details>
              <details key={`source:${result.dataset.id}`} className="py-3"><summary className={`min-h-11 cursor-pointer content-center font-bold text-primary ${FOCUS}`}>집계 기준·원문 주석</summary>
              <div className="mt-5 border-t border-border pt-4 text-(length:--jeju-text-sm) leading-relaxed"><p className="font-bold text-(--jeju-text-strong)">출처와 해석 기준</p><p className="mt-2 text-muted-foreground">{result.dataset.source_name}</p><p className="mt-1 text-muted-foreground">통계표: {result.dataset.table_title} · 표 코드 {result.dataset.table_code}</p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2"><a href={result.dataset.source_url} target="_blank" rel="noopener noreferrer" className={LINK}>{result.dataset.kosis ? "KOSIS 통계표" + (result.dataset.kosis.tables.length > 1 ? ": " + result.dataset.kosis.tables[0].title : "") : "공식 통계표"}<ExternalLinkIcon /><span className="sr-only">(새 창)</span></a>{result.dataset.kosis ? result.dataset.kosis.tables.slice(1).map(table => <a key={table.tbl_id} href={table.url} target="_blank" rel="noopener noreferrer" className={LINK}>KOSIS 통계표: {table.title}<ExternalLinkIcon /><span className="sr-only">(새 창)</span></a>) : <a href={result.dataset.indicator_url} target="_blank" rel="noopener noreferrer" className={LINK}>지표 해설<ExternalLinkIcon /><span className="sr-only">(새 창)</span></a>}{result.dataset.index_api?.tables?.slice(1).map(table => <a key={table.table_code} href={table.source_url} target="_blank" rel="noopener noreferrer" className={LINK}>{table.table_title}<ExternalLinkIcon /><span className="sr-only">(새 창)</span></a>)}</div><details className="mt-4"><summary className={`cursor-pointer font-bold ${FOCUS}`}>원문 주석과 수록 범위</summary><div className="mt-2 space-y-2 text-muted-foreground"><p>{result.dataset.source_notes}</p>{result.coverage.gaps.map(text => <p key={text}>{text}</p>)}<p>확인일은 원문을 확인한 날짜입니다. 표의 연도가 실제 관측 시점입니다.</p></div></details></div>
              </details>
              {result.auto_refresh && <details key={`refresh:${result.dataset.id}`} className="py-3"><summary className={`min-h-11 cursor-pointer content-center font-bold text-primary ${FOCUS}`}>자동 갱신 기록</summary><AutoRefreshStatus result={result} /></details>}
              </div>
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
