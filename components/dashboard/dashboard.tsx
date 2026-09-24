"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Link2, RefreshCw } from "lucide-react";

import { DataStatus } from "@/components/dashboard/data-status";
import { DetailSheet } from "@/components/dashboard/detail-sheet";
import { FilterPanel } from "@/components/dashboard/filter-panel";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { EmptyResults, ResultTable } from "@/components/dashboard/result-table";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EMPTY_FILTERS, type FilterState, type ServiceRow } from "@/lib/dataset";
import { DEFAULT_SEARCH_PAGE_SIZE } from "@/lib/dataset-summary";
import { getRegionDisplayName } from "@/lib/region-statistics";
import { useDataset, useFullDataset } from "@/lib/use-dataset";
import { watchVisitorRegion, type VisitorSource } from "@/lib/visitor-location";

const NationalMap = lazy(() =>
  import("@/components/dashboard/national-map").then((module) => ({ default: module.NationalMap })),
);
const CategoryChart = lazy(() =>
  import("@/components/dashboard/category-chart").then((module) => ({ default: module.CategoryChart })),
);
const RegionSummaryPanel = lazy(() =>
  import("@/components/dashboard/region-summary-panel").then((module) => ({ default: module.RegionSummaryPanel })),
);
const ComparePanel = lazy(() =>
  import("@/components/dashboard/compare-panel").then((module) => ({ default: module.ComparePanel })),
);

const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");
const URL_KEYS: [keyof FilterState, string][] = [
  ["sido", "sido"],
  ["sigungu", "sigungu"],
  ["category", "category"],
  ["keyword", "q"],
];

function readFiltersFromUrl(): FilterState {
  const params = new URLSearchParams(window.location.search);
  const next: FilterState = { ...EMPTY_FILTERS };
  for (const [field, key] of URL_KEYS) next[field] = params.get(key) ?? "";
  return next;
}

function writeFiltersToUrl(filters: FilterState) {
  const params = new URLSearchParams();
  for (const [field, key] of URL_KEYS) {
    if (filters[field]) params.set(key, filters[field]);
  }
  const query = params.toString();
  window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
}

function DeferredPanel({ label }: { readonly label: string }) {
  return (
    <div
      role="status"
      className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground"
    >
      {label}
    </div>
  );
}

function csvUrl(filters: FilterState): string {
  const params = new URLSearchParams();
  for (const [field, key] of URL_KEYS) {
    if (filters[field]) params.set(key, filters[field]);
  }
  return `/api/dataset/export?${params.toString()}`;
}

export function Dashboard() {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_SEARCH_PAGE_SIZE);
  const [activeTab, setActiveTab] = useState("search");
  const [selected, setSelected] = useState<ServiceRow | null>(null);
  const [notice, setNotice] = useState("");
  const [regionReady, setRegionReady] = useState(false);
  const [visitorSido, setVisitorSido] = useState<string | null>(null);
  const [autoSido, setAutoSido] = useState("");
  const [locationSource, setLocationSource] = useState<VisitorSource | "asking" | null>(null);
  const autoSidoRef = useRef("");
  const dataStatusRef = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);
  const { summary, search, meta, summaryPhase, searchPhase, reload, prefetch } = useDataset(
    filters,
    page,
    pageSize,
    { searchEnabled: regionReady, preferredSido: visitorSido },
  );
  const compareDataset = useFullDataset(activeTab === "compare");

  // Start with the region in the address; otherwise with the visitor's 광역시·도
  // (mobile: GPS after location consent, falling back to the IP address).
  useEffect(() => {
    const fromUrl = readFiltersFromUrl();
    const hasRegion = Boolean(fromUrl.sido || fromUrl.sigungu);
    const apply = (next: FilterState) => {
      setFilters(next);
      hydrated.current = true;
      setRegionReady(true);
      if (process.env.NODE_ENV !== "production") performance.mark("dashboard-shell-mounted");
    };
    const frame = hasRegion ? window.requestAnimationFrame(() => apply(fromUrl)) : 0;
    let applied = false;
    const stop = watchVisitorRegion((update) => {
      if (update.status === "asking") {
        setLocationSource("asking");
        return;
      }
      const sido = update.region?.sido ?? null;
      setLocationSource(update.region?.source ?? null);
      setVisitorSido(sido);
      if (hasRegion) return;
      if (!applied) {
        applied = true;
        autoSidoRef.current = sido ?? "";
        setAutoSido(sido ?? "");
        apply({ ...fromUrl, sido: sido ?? "" });
        return;
      }
      // GPS arrived after the IP fallback: switch only if the visitor kept the automatic region.
      if (!sido || sido === autoSidoRef.current) return;
      const previous = autoSidoRef.current;
      autoSidoRef.current = sido;
      setAutoSido(sido);
      setFilters((current) =>
        current.sido === previous && !current.sigungu ? { ...current, sido } : current,
      );
      setPage(1);
    });
    return () => {
      stop();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (hydrated.current) writeFiltersToUrl(filters);
  }, [filters]);

  const updateFilters = useCallback((next: Partial<FilterState>) => {
    setFilters((current) => ({ ...current, ...next }));
    setPage(1);
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }, []);

  const selectTopRegion = useCallback(
    (sido: string) => {
      updateFilters({ sido, sigungu: "" });
      window.requestAnimationFrame(() => {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        dataStatusRef.current?.scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          block: "start",
        });
      });
    },
    [updateFilters],
  );

  const regionName = filters.sigungu || getRegionDisplayName(filters.sido);
  const categoryCounts = useMemo(
    () => Object.entries(search.categoryCounts).sort((left, right) => right[1] - left[1]),
    [search.categoryCounts],
  );
  const mapCounts = searchPhase === "ready" ? search.regionCounts : summary.regionCounts;
  const kpis = {
    total: summary.totalCount,
    sidoCount: summary.sidoCount,
    sigunguCount: summary.sigunguCount,
    categoryCount: summary.categoryCount,
    filtered: search.totalCount,
  };

  const downloadCsv = useCallback(() => {
    if (search.totalCount === 0) {
      setNotice("내려받을 검색 결과가 없습니다.");
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = csvUrl(filters);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setNotice(`검색 결과 ${NUMBER_FORMAT.format(search.totalCount)}건의 CSV 생성을 시작했습니다.`);
  }, [filters, search.totalCount]);

  const shareConditions = useCallback(async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setNotice("현재 검색조건 주소를 복사했습니다.");
    } catch {
      window.prompt("아래 주소를 복사하세요.", url);
    }
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const summaryLoading = summaryPhase === "loading";
  const searchLoading = searchPhase === "loading";

  return (
    <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
      <Suspense fallback={<DeferredPanel label="지역 현황 지도를 준비하고 있습니다." />}>
        <NationalMap
          regionCounts={mapCounts}
          selectedSido={filters.sido}
          disabled={summaryLoading}
          onSelect={selectTopRegion}
        />
      </Suspense>

      <div ref={dataStatusRef}>
        <DataStatus
          meta={meta}
          phase={summaryPhase}
          rowCount={summary.totalCount}
          prefetch={prefetch}
          regionNote={
            locationSource === "asking" && !regionReady
              ? "내 지역 자료를 먼저 보여 드리려고 위치 사용 동의를 요청했습니다. 동의하지 않으면 접속 IP로 지역을 확인합니다."
              : autoSido && filters.sido === autoSido && !filters.sigungu
                ? `${locationSource === "gps" ? "내 위치(GPS)" : "접속 위치"}에 따라 ${getRegionDisplayName(autoSido)} 자료를 먼저 보여 드립니다.`
                : ""
          }
        />
      </div>
      <KpiCards summary={kpis} />
      <FilterPanel
        summary={summary}
        filters={filters}
        disabled={summaryLoading}
        onChange={updateFilters}
        onReset={resetFilters}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="search">검색 결과</TabsTrigger>
          <TabsTrigger value="compare">지자체 비교</TabsTrigger>
        </TabsList>

        <TabsContent value="search" className="space-y-4">
          <Suspense fallback={<DeferredPanel label="분야별 분포를 준비하고 있습니다." />}>
            <CategoryChart counts={categoryCounts} regionName={regionName} />
            <RegionSummaryPanel
              summary={search.regionSummary}
              totalRowCount={summary.totalCount}
              regionName={regionName}
            />
          </Suspense>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">
                검색 결과 {NUMBER_FORMAT.format(search.totalCount)}건
              </h2>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={downloadCsv}>
                  <Download aria-hidden="true" />
                  검색결과 CSV 다운로드
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={shareConditions}>
                  <Link2 aria-hidden="true" />
                  현재 조건 공유
                </Button>
              </div>
            </div>

            {notice ? (
              <p role="status" className="rounded-md bg-secondary px-3 py-2 text-sm">{notice}</p>
            ) : null}

            {searchLoading ? (
              <DeferredPanel label="조건에 맞는 사업을 순차적으로 불러오고 있습니다." />
            ) : searchPhase === "error" ? (
              <div className="rounded-lg border border-destructive/30 bg-card px-4 py-8 text-center">
                <p className="text-sm text-destructive">검색 자료를 불러오지 못했습니다.</p>
                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={reload}>
                  <RefreshCw aria-hidden="true" />
                  다시 확인
                </Button>
              </div>
            ) : search.rows.length === 0 ? (
              <EmptyResults
                hasKeyword={Boolean(filters.keyword)}
                hasRegion={Boolean(filters.sido || filters.sigungu)}
                onClearKeyword={() => updateFilters({ keyword: "" })}
                onClearRegion={() => updateFilters({ sido: "", sigungu: "" })}
                onReset={resetFilters}
              />
            ) : (
              <ResultTable
                rows={search.rows}
                page={search.page}
                pageCount={search.pageCount}
                totalCount={search.totalCount}
                pageSize={search.pageSize}
                onPageChange={setPage}
                onPageSizeChange={(next) => {
                  setPageSize(next);
                  setPage(1);
                }}
                onSelect={setSelected}
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="compare">
          <Suspense fallback={<DeferredPanel label="지자체 비교 화면을 준비하고 있습니다." />}>
            {compareDataset.phase === "loading" ? (
              <DeferredPanel label="비교할 전국 데이터를 불러오고 있습니다." />
            ) : compareDataset.phase === "error" ? (
              <DeferredPanel label="비교 데이터를 불러오지 못했습니다." />
            ) : (
              <ComparePanel rows={compareDataset.rows} />
            )}
          </Suspense>
        </TabsContent>
      </Tabs>

      <DetailSheet
        row={selected}
        sourceLabel={meta.sourceLabel}
        dataAsOf={meta.dataAsOf}
        onClose={() => setSelected(null)}
      />
    </main>
  );
}
