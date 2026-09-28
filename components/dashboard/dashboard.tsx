"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DataStatus } from "@/components/dashboard/data-status";
import { DetailSheet } from "@/components/dashboard/detail-sheet";
import { FilterPanel } from "@/components/dashboard/filter-panel";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { EmptyResults, ResultTable } from "@/components/dashboard/result-table";
import { Button } from "@/components/ui/button";
import {
  dashboardCsvUrl,
  dashboardPagePath,
  dashboardShareUrl,
  readDashboardFilters,
} from "@/lib/dashboard-url";
import { DownloadIcon, RefreshIcon, WarningIcon } from "@/components/ui/jeju-icons";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EMPTY_FILTERS, serviceWikiKey, type FilterState, type ServiceRow } from "@/lib/dataset";
import { csvFileName } from "@/lib/dataset-csv";
import { DEFAULT_SEARCH_PAGE_SIZE } from "@/lib/dataset-summary";
import { getRegionDisplayName } from "@/lib/region-statistics";
import { effectiveSort, parseSearch, type SearchSort } from "@/lib/search-terms";
import { useDataset, useFullDataset } from "@/lib/use-dataset";
import type { ViewRoute } from "@/lib/usage/codes";
import {
  setUsageHandoff,
  startUsageAction,
  usageError,
  usageErrorCode,
  usageFilter,
  usagePage,
  usagePerf,
  usageTab,
  type UsageActionHandle,
} from "@/lib/usage/track";
import { useSearchUsage } from "@/lib/usage/use-search-usage";
import { requestGpsSido, watchVisitorRegion, type VisitorSource } from "@/lib/visitor-location";

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
function DeferredPanel({ label }: { readonly label: string }) {
  return (
    <div
      role="status"
      className="grid justify-items-center gap-3 rounded-xl border border-border bg-card px-4 py-10 text-center text-(length:--jeju-text-sm) text-muted-foreground"
    >
      <Spinner label={label} className="size-(--jeju-icon-lg)" />
      <p>{label}</p>
    </div>
  );
}

export function Dashboard() {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_SEARCH_PAGE_SIZE);
  const [activeTab, setActiveTab] = useState("search");
  const [selected, setSelected] = useState<ServiceRow | null>(null);
  const [selectedUsage, setSelectedUsage] = useState<{ route: ViewRoute; search?: string }>({ route: "list" });
  const [notice, setNotice] = useState("");
  const [regionReady, setRegionReady] = useState(false);
  const [visitorSido, setVisitorSido] = useState<string | null>(null);
  const [autoSido, setAutoSido] = useState("");
  const [locationSource, setLocationSource] = useState<VisitorSource | null>(null);
  const [gpsPending, setGpsPending] = useState(false);
  const [gpsNotice, setGpsNotice] = useState("");
  const dataStatusRef = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);
  const { summary, search, meta, summaryPhase, searchPhase, reload, prefetch } = useDataset(
    filters,
    page,
    pageSize,
    { searchEnabled: regionReady, preferredSido: visitorSido },
  );
  const compareDataset = useFullDataset(activeTab === "compare");
  const compareOp = useRef<{ handle: UsageActionHandle; started: number; loaded: boolean } | null>(null);

  // 이용통계: 화면 조회와 검색 1회. 검색어 원문은 보내지 않는다.
  useEffect(() => {
    usagePage("dashboard", "dashboard_search");
  }, []);
  const { confirm: confirmSearch } = useSearchUsage({
    scope: "care_dashboard",
    keyword: filters.keyword,
    conditions: [filters.sido, filters.sigungu, filters.category].join("|"),
    settled: regionReady && searchPhase !== "loading",
    failed: searchPhase === "error",
    count: search.totalCount,
    match: search.nameMatch ?? null,
  });
  const openRoute = useCallback((): { route: ViewRoute; search?: string } => {
    if (!filters.keyword.trim()) return { route: "list" };
    const searchId = confirmSearch();
    return searchId ? { route: "search", search: searchId } : { route: "search" };
  }, [confirmSearch, filters.keyword]);
  const selectRow = useCallback(
    (row: ServiceRow) => {
      setSelectedUsage(openRoute());
      setSelected(row);
    },
    [openRoute],
  );
  const openWiki = useCallback(
    (row: ServiceRow) => {
      const { route, search: searchId } = openRoute();
      setUsageHandoff("care_program", serviceWikiKey(row), route, searchId);
    },
    [openRoute],
  );

  // 주소의 지역 조건을 우선하고, 없을 때만 Edge가 제공한 접속 지역을 적용한다.
  // 기기 GPS는 아래의 명시적 버튼을 누르기 전에는 요청하지 않는다.
  useEffect(() => {
    const fromUrl = readDashboardFilters(window.location.search);
    const hasRegion = Boolean(fromUrl.sido || fromUrl.sigungu);
    const apply = (next: FilterState) => {
      setFilters(next);
      hydrated.current = true;
      setRegionReady(true);
      if (process.env.NODE_ENV !== "production") performance.mark("dashboard-shell-mounted");
    };
    const frame = hasRegion ? window.requestAnimationFrame(() => apply(fromUrl)) : 0;
    const stop = watchVisitorRegion((update) => {
      if (!("region" in update)) return;
      const sido = update.region?.sido ?? null;
      setLocationSource(update.region?.source ?? null);
      setVisitorSido(sido);
      if (hasRegion) return;
      setAutoSido(sido ?? "");
      apply({ ...fromUrl, sido: sido ?? "" });
    });
    return () => {
      stop();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (hydrated.current) {
      window.history.replaceState(null, "", dashboardPagePath(window.location.pathname, filters));
    }
  }, [filters]);

  const updateFilters = useCallback((next: Partial<FilterState>) => {
    setFilters((current) => ({ ...current, ...next }));
    setPage(1);
  }, []);

  // 이용자가 직접 고른 조회 대상 지역·분류만 센다(접속 위치로 자동 선택한 지역은 세지 않는다).
  const changeFilters = useCallback(
    (next: Partial<FilterState>) => {
      if (next.sigungu) {
        const owners = next.sido || filters.sido
          ? [next.sido || filters.sido]
          : Object.entries(summary.sigunguBySido).filter(([, names]) => names.includes(next.sigungu ?? "")).map(([sido]) => sido);
        if (owners.length === 1) usageFilter("care_region", owners[0] + "|" + next.sigungu);
      } else if (next.sido) {
        usageFilter("care_region", next.sido);
      }
      if (next.category) usageFilter("care_category", next.category);
      // 검색어에 지역어가 있으면 접속 위치로 자동으로 고른 광역 조건은 빼고 전국에서 찾는다(예: 서울 방문진료).
      if (
        next.keyword !== undefined &&
        next.sido === undefined &&
        autoSido &&
        filters.sido === autoSido &&
        !filters.sigungu &&
        parseSearch(next.keyword).hasRegion
      ) {
        setNotice(`검색어에 지역이 있어 접속 위치로 고른 ${getRegionDisplayName(autoSido)} 조건을 빼고 전국에서 찾습니다.`);
        updateFilters({ ...next, sido: "" });
        return;
      }
      updateFilters(next);
    },
    [autoSido, filters.sido, filters.sigungu, summary.sigunguBySido, updateFilters],
  );

  const resetFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }, []);

  const useCurrentLocation = useCallback(() => {
    setGpsPending(true);
    setGpsNotice("");
    void requestGpsSido().then(
      (sido) => {
        setGpsPending(false);
        if (!sido) {
          setGpsNotice("현재 위치를 확인하지 못했습니다. 지역을 직접 선택해 주세요.");
          return;
        }
        setFilters((current) => ({ ...current, sido, sigungu: "" }));
        setPage(1);
        setVisitorSido(sido);
        setAutoSido(sido);
        setLocationSource("gps");
      },
      () => {
        setGpsPending(false);
        setGpsNotice("현재 위치를 확인하지 못했습니다. 지역을 직접 선택해 주세요.");
      },
    );
  }, []);

  const selectTopRegion = useCallback(
    (sido: string) => {
      usageFilter("care_region", sido);
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
  const regionFiltered = Boolean(filters.sido || filters.sigungu);
  const searchRegion = regionFiltered
    ? {
        label: [getRegionDisplayName(filters.sido), filters.sigungu].filter(Boolean).join(" "),
        auto: Boolean(autoSido) && filters.sido === autoSido && !filters.sigungu,
      }
    : null;
  const clearRegion = useCallback(() => updateFilters({ sido: "", sigungu: "" }), [updateFilters]);
  const hasKeyword = parseSearch(filters.keyword).terms.length > 0;
  const sort: SearchSort = effectiveSort(filters.sort, filters.keyword);
  const changeSort = useCallback(
    (next: SearchSort) => updateFilters({ sort: next === effectiveSort("", filters.keyword) ? "" : next }),
    [filters.keyword, updateFilters],
  );
  // 지역 조건을 뺀 전국 결과 수(지도 수치와 같은 조건).
  const nationwideCount = useMemo(
    () => Object.values(search.regionCounts).reduce((sum, count) => sum + count, 0),
    [search.regionCounts],
  );
  const showNationwide = hasKeyword && regionFiltered && searchPhase === "ready" && nationwideCount > search.totalCount;
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

  const downloadCsv = useCallback(async () => {
    if (search.totalCount === 0) {
      setNotice("내려받을 검색 결과가 없습니다.");
      return;
    }
    // 서버가 파일을 다 만든 뒤 내려받기를 시작한다. 실패하면 깨진 파일 대신 안내를 보여 준다.
    const op = startUsageAction("care_csv");
    const started = performance.now();
    setNotice("검색 결과 CSV 파일을 만들고 있습니다.");
    try {
      const response = await fetch(dashboardCsvUrl(filters));
      if (!response.ok) throw new Error(`CSV 응답 오류: ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = csvFileName(filters, new Date());
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      const elapsed = performance.now() - started;
      op.success(elapsed);
      usagePerf("csv", elapsed);
      setNotice(`검색 결과 ${NUMBER_FORMAT.format(search.totalCount)}건의 CSV 파일 내려받기를 시작했습니다.`);
    } catch (error) {
      op.failure(usageErrorCode(error), performance.now() - started);
      setNotice("CSV 파일을 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    }
  }, [filters, search.totalCount]);

  const shareConditions = useCallback(async () => {
    const url = dashboardShareUrl(window.location.origin, window.location.pathname, filters);
    const op = startUsageAction("care_share");
    try {
      await navigator.clipboard.writeText(url);
      op.success();
      setNotice("검색어를 제외한 검색조건 주소를 복사했습니다.");
    } catch {
      op.failure("unsupported");
      window.prompt("검색어를 제외한 아래 주소를 복사하세요.", url);
    }
  }, [filters]);

  const changeTab = useCallback((value: string) => {
    setActiveTab(value);
    usageTab(value === "compare" ? "dashboard_compare" : "dashboard_search");
    compareOp.current?.handle.cancel();
    compareOp.current = value === "compare" ? { handle: startUsageAction("care_compare"), started: performance.now(), loaded: false } : null;
  }, []);

  // 지자체 비교: 비교 화면이 실제로 표시되면 성공, 자료를 받지 못하면 실패, 표시 전에 탭을 떠나면 취소.
  useEffect(() => {
    const op = compareOp.current;
    if (!op || activeTab !== "compare") return;
    if (compareDataset.phase === "loading") {
      op.loaded = true;
      return;
    }
    const elapsed = performance.now() - op.started;
    if (compareDataset.phase === "ready") {
      op.handle.success(elapsed);
      if (op.loaded) usagePerf("compare_data", elapsed);
    } else {
      op.handle.failure("unknown", elapsed);
    }
    compareOp.current = null;
  }, [activeTab, compareDataset.phase]);

  useEffect(() => {
    if (summaryPhase === "error") usageError("care_summary", "unknown");
  }, [summaryPhase]);
  const listFailed = searchPhase === "error" && !filters.keyword.trim();
  useEffect(() => {
    if (listFailed) usageError("care_list", "unknown");
  }, [listFailed]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const summaryLoading = summaryPhase === "loading";
  const searchLoading = searchPhase === "loading";
  const printConditions = [
    filters.sigungu || getRegionDisplayName(filters.sido) || "전국",
    filters.category ? `분야 ${filters.category}` : "",
    filters.keyword ? `검색어 “${filters.keyword}”` : "",
  ].filter(Boolean).join(" · ");

  return (
    <main className="mx-auto max-w-(--jeju-main-max-wide) space-y-4 px-4 py-5 sm:px-6">
      <p className="hidden border-b border-(--jeju-border-strong) pb-2 text-(length:--jeju-text-sm) text-(--jeju-text-body) print:block">
        전국 통합돌봄 사업 총괄 대시보드 · 조건: {printConditions}
      </p>
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
            autoSido && filters.sido === autoSido && !filters.sigungu
              ? `${locationSource === "gps" ? "현재 위치(GPS)" : "접속 지역 정보"}에 따라 ${getRegionDisplayName(autoSido)} 자료를 먼저 보여 드립니다.`
              : ""
          }
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={useCurrentLocation} disabled={gpsPending}>
            {gpsPending ? "현재 위치 확인 중" : "현재 위치로 보기"}
          </Button>
          <p className="text-sm text-muted-foreground">
            현재 위치는 버튼을 누를 때만 기기에서 광역시·도로 변환하며 서버에 전송하지 않습니다.
          </p>
        </div>
        {gpsNotice ? (
          <p
            role="status"
            className="mt-2 rounded-lg border border-(--jeju-blue-light-strong) bg-(--jeju-primary-tint) px-3 py-2 text-(length:--jeju-text-sm) font-bold text-(--jeju-text-body) print:hidden"
          >
            {gpsNotice}
          </p>
        ) : null}
      </div>
      <KpiCards summary={kpis} />
      <FilterPanel
        summary={summary}
        filters={filters}
        disabled={summaryLoading}
        region={searchRegion}
        onChange={changeFilters}
        onClearRegion={clearRegion}
        onReset={resetFilters}
      />

      <Tabs value={activeTab} onValueChange={changeTab}>
        <TabsList className="print:hidden">
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
              <h2 className="text-(length:--jeju-h2-size) font-extrabold text-(--jeju-text-strong)">
                검색 결과 {NUMBER_FORMAT.format(search.totalCount)}건
              </h2>
              <div className="flex flex-wrap gap-2 print:hidden">
                <Button type="button" variant="outline" size="sm" onClick={downloadCsv}>
                  <DownloadIcon />
                  검색결과 CSV 다운로드
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={shareConditions}>
                  검색어 제외 조건 공유
                </Button>
              </div>
            </div>

            {showNationwide ? (
              <p className="flex flex-wrap items-center gap-2 rounded-lg border border-(--jeju-blue-light-strong) bg-(--jeju-primary-tint) px-3 py-2 text-(length:--jeju-text-sm) text-(--jeju-text-body) print:hidden">
                <span>
                  <strong className="text-(--jeju-text-strong)">{searchRegion?.label}</strong>에서 {NUMBER_FORMAT.format(search.totalCount)}건 ·
                  전국 {NUMBER_FORMAT.format(nationwideCount)}건
                  {searchRegion?.auto ? " (접속 위치로 고른 지역만 보는 중)" : ""}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={clearRegion}>
                  전국 결과 보기
                </Button>
              </p>
            ) : null}

            {notice ? (
              <p
                role="status"
                className="rounded-lg border border-(--jeju-blue-light-strong) bg-(--jeju-primary-tint) px-3 py-2 text-(length:--jeju-text-sm) font-bold text-(--jeju-text-body) print:hidden"
              >
                {notice}
              </p>
            ) : null}

            {searchLoading ? (
              <DeferredPanel label="조건에 맞는 사업을 순차적으로 불러오고 있습니다." />
            ) : searchPhase === "error" ? (
              <div role="alert" className="grid justify-items-center gap-3 rounded-xl border border-border bg-card px-4 py-8 text-center">
                <WarningIcon className="size-(--jeju-icon-lg) text-destructive" />
                <p className="text-(length:--jeju-h3-size) font-extrabold text-destructive">검색 자료를 불러오지 못했습니다.</p>
                <p className="text-(length:--jeju-text-sm) text-muted-foreground">잠시 뒤 다시 확인해 주세요. 문제가 계속되면 아래 오류 제보 주소로 알려 주세요.</p>
                <Button type="button" variant="outline" size="sm" onClick={reload}>
                  <RefreshIcon />
                  다시 확인
                </Button>
              </div>
            ) : search.rows.length === 0 ? (
              <EmptyResults
                keyword={filters.keyword}
                hasKeyword={Boolean(filters.keyword)}
                hasRegion={Boolean(filters.sido || filters.sigungu)}
                help={search.searchHelp}
                nationwideCount={regionFiltered ? nationwideCount : null}
                onSearch={(query) => changeFilters({ keyword: query })}
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
                sort={sort}
                hasKeyword={hasKeyword}
                onPageChange={setPage}
                onPageSizeChange={(next) => {
                  setPageSize(next);
                  setPage(1);
                }}
                onSortChange={changeSort}
                onSelect={selectRow}
                onWikiOpen={openWiki}
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
        usage={selectedUsage}
        sourceLabel={meta.sourceLabel}
        dataAsOf={meta.dataAsOf}
        onClose={() => setSelected(null)}
      />
    </main>
  );
}
