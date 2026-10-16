"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useSearchParams } from "next/navigation";

import { SearchOperatorHelp } from "@/components/search/search-operator-help";
import { ZeroResultHelp } from "@/components/search/zero-result-help";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, FileIcon, RefreshIcon, SearchIcon } from "@/components/ui/jeju-icons";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { ServiceDetails } from "@/components/wiki/service-details";
import { useWelfareMatchCount, welfareSearchHref } from "@/lib/cross-search";
import { serviceWikiHref, serviceWikiKey, type ServiceRow } from "@/lib/dataset";
import { matchesSearch, parseSearch, type ParsedSearch } from "@/lib/search-terms";
import {
  EMPTY_WIKI_FILTERS,
  scrolledPast,
  useWikiDataset,
  useWikiFilterOptions,
  type WikiFilters,
} from "@/lib/use-wiki-dataset";
import {
  markUsageInternalNavigation,
  newUsageId,
  setUsageHandoff,
  takeUsageHandoff,
  usageEntityClose,
  usageEntityOpen,
  usagePage,
} from "@/lib/usage/track";
import { useSearchUsage } from "@/lib/usage/use-search-usage";

const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");

function uniqueServices(rows: readonly ServiceRow[]): ServiceRow[] {
  const unique = new Map<string, ServiceRow>();
  for (const row of rows) {
    const key = serviceWikiKey(row);
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()];
}

/** 선택한 사업이 지금 검색어·조건에 맞는지(맞을 때만 목록에 따로 끼워 넣는다). */
function fitsConditions(row: ServiceRow, filters: WikiFilters, parsed: ParsedSearch): boolean {
  return (
    (!filters.sido || row.sido === filters.sido) &&
    (!filters.sigungu || row.sigungu === filters.sigungu) &&
    (!filters.category || row.category === filters.category) &&
    (parsed.terms.length === 0 || matchesSearch(row.searchIndex, parsed))
  );
}

/** 지금 값이 목록에 아직 없으면(메뉴 항목을 받는 중) 그 값도 보이게 넣는다. */
function withCurrent(values: readonly string[], current: string): readonly string[] {
  return current && !values.includes(current) ? [current, ...values] : values;
}

function SelectField({
  id,
  label,
  value,
  values,
  placeholder,
  disabled,
  className,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly values: readonly string[];
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly className?: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className={"grid min-w-0 gap-1.5 " + (className ?? "")}>
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="w-full [&_select]:h-(--jeju-control-h-lg)">
        <NativeSelectOption value="">{placeholder}</NativeSelectOption>
        {values.map((option) => (
          <NativeSelectOption key={option} value={option}>
            {option}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

export function WikiBrowser() {
  const searchParams = useSearchParams();
  // 검색어와 조건은 주소(?q=&sido=&sigungu=&category=)에 남겨, 사업을 열었다가 돌아와도 같은 목록을 보여 준다.
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [filters, setFilters] = useState<WikiFilters>(() => ({
    sido: searchParams.get("sido") ?? "",
    sigungu: searchParams.get("sigungu") ?? "",
    category: searchParams.get("category") ?? "",
  }));
  // 목록에서 사업을 고르면 새로고침 없이 오른쪽 설명만 바꾸고 주소를 더한다(목록과 스크롤 위치 유지, 뒤로 가기 지원).
  const [selectedKey, setSelectedKey] = useState(() => searchParams.get("service") ?? "");
  // 주소에 사업만 있으면(대시보드에서 연 경우) 그 사업의 지역을 조건으로 채운 뒤 목록을 받는다.
  const [conditionsReady, setConditionsReady] = useState(
    () => !selectedKey || Boolean(query.trim() || filters.sido || filters.sigungu || filters.category),
  );
  const {
    selected,
    selectedPhase,
    selectionResolved,
    catalogRows,
    catalogTotalCount,
    catalogPhase,
    catalogNameMatch,
    catalogSearchHelp,
    hasMore,
    loadingMore,
    moreFailed,
    requestMore,
    showSelected,
  } = useWikiDataset(selectedKey, query, filters, conditionsReady);
  if (!conditionsReady && selectionResolved) {
    setConditionsReady(true);
    if (selected) setFilters({ sido: selected.sido, sigungu: selected.sigungu, category: "" });
  }
  const options = useWikiFilterOptions();
  const keyword = query.trim();
  const hasFilters = Boolean(filters.sido || filters.sigungu || filters.category);

  useEffect(() => {
    const url = new URL(window.location.href);
    const put = (name: string, value: string) => {
      if (value) url.searchParams.set(name, value);
      else url.searchParams.delete(name);
    };
    put("q", keyword);
    put("sido", filters.sido);
    put("sigungu", filters.sigungu);
    put("category", filters.category);
    const next = url.pathname + url.search + url.hash;
    if (next !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.replaceState(window.history.state, "", next);
    }
  }, [filters.category, filters.sido, filters.sigungu, keyword]);

  // 뒤로·앞으로 가기: 주소에 적힌 사업과 검색 조건으로 되돌린다.
  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      setSelectedKey(params.get("service") ?? "");
      setQuery(params.get("q") ?? "");
      setFilters({
        sido: params.get("sido") ?? "",
        sigungu: params.get("sigungu") ?? "",
        category: params.get("category") ?? "",
      });
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  // 이용통계: 화면 조회, WIKI 검색 1회, 선택한 사업 상세 열람 1회.
  useEffect(() => {
    usagePage("wiki", "wiki");
  }, []);
  const { confirm: confirmSearch } = useSearchUsage({
    scope: "care_wiki",
    keyword: query,
    conditions: "",
    settled: catalogPhase !== "loading",
    failed: catalogPhase === "error",
    count: catalogTotalCount,
    match: catalogNameMatch,
  });
  const selectedWikiKey = selected ? serviceWikiKey(selected) : "";
  // 사업을 바꿀 때마다 열람 1회로 센다.
  const viewId = useMemo(() => (selectedWikiKey ? newUsageId() : ""), [selectedWikiKey]);
  useEffect(() => {
    if (!selectedWikiKey || !viewId) return;
    const { route, search } = takeUsageHandoff("care_program", [selectedWikiKey, selectedKey]);
    usageEntityOpen(viewId, "care_program", selectedWikiKey, route, search);
    return () => usageEntityClose(viewId);
  }, [selectedKey, selectedWikiKey, viewId]);

  const parsed = useMemo(() => parseSearch(query), [query]);
  // 서버가 같은 규칙으로 찾아 관련도순으로 보내 준다. 선택한 사업은 목록에 있으면 제자리에 두고,
  // 없으면(아직 받지 않은 뒤쪽 사업) 지금 조건에 맞을 때만 맨 위에 끼워 넣는다.
  const services = useMemo(() => {
    const rows = uniqueServices(catalogRows);
    if (!selected || !fitsConditions(selected, filters, parsed)) return rows;
    const key = serviceWikiKey(selected);
    return rows.some((row) => serviceWikiKey(row) === key) ? rows : [selected, ...rows];
  }, [catalogRows, filters, parsed, selected]);

  // 목록 상자를 80% 이상 내리면 다음 묶음을 받는다. 짧아서 내릴 것이 없으면 바로 받는다.
  const listRef = useRef<HTMLElement>(null);
  const loadIfScrolled = useCallback(() => {
    const box = listRef.current;
    if (box && hasMore && !loadingMore && !moreFailed && scrolledPast(box)) requestMore();
  }, [hasMore, loadingMore, moreFailed, requestMore]);
  useEffect(() => {
    loadIfScrolled();
  }, [loadIfScrolled, services.length]);

  const noResults = catalogPhase === "ready" && catalogTotalCount === 0 && Boolean(keyword || hasFilters);
  const welfareCount = useWelfareMatchCount(keyword, noResults && Boolean(keyword));
  const listParams = new URLSearchParams();
  if (keyword) listParams.set("q", keyword);
  if (filters.sido) listParams.set("sido", filters.sido);
  if (filters.sigungu) listParams.set("sigungu", filters.sigungu);
  if (filters.category) listParams.set("category", filters.category);
  const listSuffix = listParams.toString();
  const wikiHref = (row: ServiceRow) => serviceWikiHref(row) + (listSuffix ? "&" + listSuffix : "");
  const hasSelection = Boolean(selectedKey);
  const shownCount = Math.min(services.length, catalogTotalCount);

  const detailRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const openService = (event: MouseEvent<HTMLAnchorElement>, row: ServiceRow) => {
    const key = serviceWikiKey(row);
    setUsageHandoff("care_program", key, keyword ? "search" : "list", keyword ? confirmSearch() : undefined);
    // 새 탭·새 창으로 여는 클릭은 브라우저에 맡긴다.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      markUsageInternalNavigation("wiki");
      return;
    }
    event.preventDefault();
    if (key !== selectedKey) {
      window.history.pushState(window.history.state, "", wikiHref(row));
      showSelected(key, row);
      setSelectedKey(key);
      setAnnouncement(row.name + " 설명을 표시했습니다.");
    }
    // 설명 첫머리가 화면 밖이면 그곳으로 옮긴다. 목록으로 돌아가는 버튼으로 선택 위치를 다시 찾을 수 있다.
    window.requestAnimationFrame(() => {
      const top = detailRef.current?.getBoundingClientRect().top ?? 0;
      if (top < 0 || top > window.innerHeight) {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        detailRef.current?.focus({ preventScroll: true });
        detailRef.current?.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
      }
    });
  };

  const returnToResults = () => {
    const target = listRef.current?.querySelector<HTMLAnchorElement>('a[aria-current="page"]') ?? listRef.current;
    if (!target) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  };

  const sidoValues = withCurrent(options?.sidoList ?? [], filters.sido);
  const sigunguValues = withCurrent(
    filters.sido
      ? options?.sigunguBySido[filters.sido] ?? []
      : [...new Set(Object.values(options?.sigunguBySido ?? {}).flat())].sort((left, right) => left.localeCompare(right, "ko")),
    filters.sigungu,
  );
  const categoryValues = withCurrent(options?.categories ?? [], filters.category);
  const changeFilters = (next: Partial<WikiFilters>) => setFilters((current) => ({ ...current, ...next }));
  const resetConditions = () => {
    setQuery("");
    setFilters(EMPTY_WIKI_FILTERS);
  };

  return (
    <main className="mx-auto max-w-(--jeju-main-max-wide) space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="mb-2 text-(length:--jeju-text-sm) font-bold text-(--jeju-secondary-strong)">지역과 분야로 찾는 돌봄 안내</p>
          <h1 className="text-(length:--jeju-h1-size) leading-(--jeju-leading-tight) font-extrabold tracking-tight text-(--jeju-text-strong) sm:text-(length:--jeju-text-3xl)">통합돌봄 WIKI</h1>
          <p className="mt-3 text-(length:--jeju-text-base) leading-relaxed text-muted-foreground">
            우리 지역의 통합돌봄 사업을 찾고, 지원 내용과 신청 정보를 살펴보세요.
          </p>
        </div>
        <span className="inline-flex w-fit shrink-0 items-center gap-2 rounded-(--jeju-radius-pill) border border-border bg-card px-3 py-2 text-(length:--jeju-text-xs) font-medium text-(--jeju-text-body)">
          <FileIcon className="text-primary" />
          보건복지부 원자료 기준
        </span>
      </header>

      <section className="rounded-(--jeju-radius-lg) border border-border bg-card p-4 sm:p-5 print:hidden" role="search" aria-label="WIKI 사업 검색">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,2fr)] lg:gap-6">
          <div className="grid min-w-0 content-start gap-1.5">
            <div className="flex items-center gap-1">
              <Label htmlFor="wiki-search">WIKI 사업 검색</Label>
              <SearchOperatorHelp />
            </div>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="wiki-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="사업명, 지역, 분야 검색"
                className="h-(--jeju-control-h-lg) bg-(--jeju-surface-inset) pl-9"
              />
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3">
            <SelectField
              id="wiki-sido"
              label="광역시·도"
              value={filters.sido}
              values={sidoValues}
              placeholder="전체 광역시·도"
              disabled={!options}
              onChange={(value) => changeFilters({ sido: value, sigungu: "" })}
            />
            <SelectField
              id="wiki-sigungu"
              label="기초시·군·구"
              value={filters.sigungu}
              values={sigunguValues}
              placeholder={filters.sido ? "전체 기초시·군·구" : "광역시·도를 먼저 고르세요"}
              disabled={!options || !filters.sido}
              onChange={(value) => changeFilters({ sigungu: value })}
            />
            <SelectField
              id="wiki-category"
              label="사업 분류"
              value={filters.category}
              values={categoryValues}
              placeholder="전체 선택"
              disabled={!options}
              className="col-span-2 sm:col-span-1"
              onChange={(value) => changeFilters({ category: value })}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-3">
          <p className="min-w-0 text-(length:--jeju-text-xs) leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {keyword || hasFilters ? (
              <><span className="font-bold text-(--jeju-text-body)">현재 검색 조건</span><span className="mx-2" aria-hidden="true">/</span>{[keyword ? `“${keyword}”` : "", filters.sido, filters.sigungu, filters.category].filter(Boolean).join(" · ")}</>
            ) : "사업명으로 검색하거나 지역·분야를 선택해 목록을 좁혀보세요."}
          </p>
          {keyword || hasFilters ? (
            <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={resetConditions}>
              <RefreshIcon />
              조건 초기화
            </Button>
          ) : null}
        </div>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[352px_minmax(0,1fr)] print:block">
        <aside className="min-w-0 rounded-(--jeju-radius-lg) border border-border bg-card lg:sticky lg:top-4 print:hidden" aria-labelledby="wiki-results-heading">
          <div className="border-b border-border px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="wiki-results-heading" className="text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)">사업 목록</h2>
              {catalogPhase === "ready" ? <span className="rounded-(--jeju-radius-pill) bg-(--jeju-primary-tint) px-2.5 py-1 text-(length:--jeju-text-xs) font-bold tabular-nums text-primary">{NUMBER_FORMAT.format(catalogTotalCount)}개</span> : null}
            </div>
            <p className="mt-2 text-(length:--jeju-text-xs) leading-relaxed text-muted-foreground" role="status" aria-live="polite">
              {selected && catalogPhase === "loading"
                ? "선택한 사업을 먼저 표시했습니다. 사업 목록을 불러오는 중입니다."
                : catalogPhase === "loading"
                  ? keyword || hasFilters ? "검색 결과를 불러오는 중입니다." : "사업 목록을 불러오는 중입니다."
                  : catalogPhase === "error"
                    ? "사업 목록을 불러오지 못했습니다. 선택한 사업 내용은 계속 확인할 수 있습니다."
                    : `${NUMBER_FORMAT.format(shownCount)}개 표시${loadingMore ? " · 이어서 불러오는 중" : " · 사업을 선택해 설명을 확인하세요"}`}
            </p>
          </div>

          <nav
            ref={listRef}
            onScroll={loadIfScrolled}
            tabIndex={0}
            aria-label="통합돌봄 WIKI 사업 목록"
            className="scrollbar-thin min-h-0 max-h-80 overflow-y-auto overscroll-y-contain p-2 outline-none focus-visible:shadow-(--jeju-focus-ring) lg:max-h-[calc(100dvh-12rem)]"
          >
            {noResults ? (
              <div className="rounded-lg bg-(--jeju-surface-inset) px-3 py-6 text-center">
                <p className="font-extrabold text-(--jeju-text-strong)">{keyword ? "검색 결과가 없습니다." : "조건에 맞는 사업이 없습니다."}</p>
                {hasFilters ? (
                  <p className="mt-1 text-(length:--jeju-text-sm) text-muted-foreground">광역시·도, 기초시·군·구, 사업 분류 선택을 넓혀 보세요.</p>
                ) : null}
                {keyword ? (
                  <ZeroResultHelp
                    help={catalogSearchHelp}
                    onSearch={setQuery}
                    crossLinks={[{ label: "복지제도100에서", href: welfareSearchHref(keyword), count: welfareCount }]}
                    className="mt-3"
                  />
                ) : null}
              </div>
            ) : null}

            {catalogPhase === "loading" && services.length === 0 ? (
              <div className="space-y-2 p-1" aria-hidden="true">
                {[0, 1, 2].map((item) => <div key={item} className="space-y-3 rounded-lg bg-(--jeju-surface-inset) p-4 motion-safe:animate-pulse"><div className="h-3 w-3/4 rounded bg-border" /><div className="h-2.5 w-1/2 rounded bg-border" /></div>)}
              </div>
            ) : null}
            <ul className="space-y-1">
              {services.map((row) => {
                const active = serviceWikiKey(row) === selectedKey;
                return (
                  <li key={serviceWikiKey(row)}>
                    <a
                      href={wikiHref(row)}
                      aria-current={active ? "page" : undefined}
                      aria-controls="wiki-detail"
                      onClick={(event) => openService(event, row)}
                      className={`block min-w-0 rounded-lg border-l-2 px-3 py-3 text-(length:--jeju-text-base) no-underline outline-none transition-colors focus-visible:shadow-(--jeju-focus-ring) ${
                        active
                          ? "border-primary bg-(--jeju-primary-tint) text-primary forced-colors:border-[Highlight]"
                          : "border-transparent text-(--jeju-text-body) hover:border-(--jeju-border-strong) hover:bg-(--jeju-surface-inset)"
                      }`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0 leading-relaxed font-bold [overflow-wrap:anywhere]">{row.name}</span>
                        {active ? <CheckIcon className="mt-1 size-4" /> : <ChevronRightIcon className="mt-1 size-4 text-(--jeju-text-faint)" />}
                      </span>
                      <span className="mt-1.5 block text-(length:--jeju-text-xs) leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                        {[row.sido, row.sigungu].filter(Boolean).join(" · ") || "전국"}
                      </span>
                      <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-(length:--jeju-text-xs)">
                        {row.category ? <span className={`max-w-full rounded px-1.5 py-0.5 leading-relaxed [overflow-wrap:anywhere] ${active ? "bg-card text-primary" : "bg-(--jeju-control-bg) text-muted-foreground"}`}>{row.category}</span> : null}
                        {active ? <span className="font-bold">선택한 사업</span> : null}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
            {hasMore ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 h-auto min-h-(--jeju-control-h-sm) w-full whitespace-normal py-2"
                disabled={loadingMore}
                onClick={requestMore}
              >
                {loadingMore ? "불러오는 중" : moreFailed ? "목록을 더 불러오지 못했습니다 · 다시 시도" : "더 보기"}
              </Button>
            ) : null}
          </nav>
          <p className="sr-only" aria-live="polite">{announcement}</p>
        </aside>

        <div ref={detailRef} id="wiki-detail" role="region" aria-label="통합돌봄 사업 설명" tabIndex={-1} className="min-w-0 scroll-mt-4 rounded-(--jeju-radius-lg) outline-none focus-visible:shadow-(--jeju-focus-ring)">
          {hasSelection ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
              <p className="text-(length:--jeju-text-sm) font-bold text-muted-foreground">선택한 사업 안내</p>
              <Button type="button" variant="ghost" size="sm" onClick={returnToResults}><ChevronLeftIcon />목록으로 돌아가기</Button>
            </div>
          ) : null}
          {selected ? (
            <ServiceDetails key={serviceWikiKey(selected)} row={selected} />
          ) : hasSelection && !selectionResolved ? (
            <div className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-border bg-card p-8 text-(length:--jeju-text-sm) text-muted-foreground" role="status">
              <Spinner label="선택한 사업 내용을 불러오는 중입니다." />
              선택한 사업 내용을 불러오는 중입니다.
            </div>
          ) : hasSelection && selectedPhase === "error" ? (
            <div role="alert" className="rounded-xl border border-border bg-card p-8 text-center">
              <h2 className="text-(length:--jeju-h3-size) font-extrabold text-destructive">선택한 사업을 불러오지 못했습니다.</h2>
              <p className="mt-2 text-(length:--jeju-text-sm) text-muted-foreground">잠시 후 다시 시도하거나 상단 검색에서 사업을 찾아보세요.</p>
            </div>
          ) : hasSelection ? (
            <div className="rounded-xl border border-dashed border-(--jeju-border-strong) bg-card p-8 text-center">
              <h2 className="text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)">해당 사업을 현재 데이터에서 찾지 못했습니다.</h2>
              <p className="mt-2 text-(length:--jeju-text-sm) text-muted-foreground">상단 검색에서 같은 사업명을 다시 찾아보세요.</p>
            </div>
          ) : (
            <div className="rounded-(--jeju-radius-lg) border border-border bg-card p-5 sm:p-8">
              <span className="mb-5 flex size-12 items-center justify-center rounded-(--jeju-radius-lg) bg-(--jeju-primary-tint) text-primary" aria-hidden="true"><FileIcon className="size-6" /></span>
              <h2 className="max-w-2xl text-(length:--jeju-text-2xl) leading-snug font-extrabold tracking-tight text-(--jeju-text-strong)">어떤 통합돌봄 사업을 찾고 계신가요?</h2>
              <p className="mt-3 max-w-2xl text-(length:--jeju-text-base) leading-7 text-muted-foreground">
                목록에서 사업을 선택해 주세요. 확인된 지원 내용과 신청 정보, 공식 출처를 함께 보여드립니다.
              </p>
              <ol className="mt-7 grid gap-5 border-y border-border py-6 sm:grid-cols-3">
                {[
                  ["01", "지역 선택", "광역시·도와 기초시·군·구로 우리 지역의 사업을 찾으세요."],
                  ["02", "사업 찾아보기", "사업명이나 분야로 검색하고 목록에서 관심 사업을 선택하세요."],
                  ["03", "내용과 근거 확인", "사업 개요와 지원 내용을 읽고 연결된 원문도 확인하세요."],
                ].map(([step, title, body]) => (
                  <li key={step} className="min-w-0">
                    <span className="text-(length:--jeju-text-xs) font-extrabold tabular-nums text-(--jeju-secondary-strong)">{step}</span>
                    <h3 className="mt-2 text-(length:--jeju-text-base) font-bold text-(--jeju-text-strong)">{title}</h3>
                    <p className="mt-2 text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">{body}</p>
                  </li>
                ))}
              </ol>
              <details className="mt-5 text-(length:--jeju-text-sm)">
                <summary className="cursor-pointer rounded py-1 font-bold text-(--jeju-text-body) outline-none focus-visible:shadow-(--jeju-focus-ring)">자료·출처 확인 기준</summary>
                <p className="mt-3 leading-relaxed text-muted-foreground">보건복지부 원자료를 기준으로 작성하고, 원자료에서 대상이 확인될 때만 신청조건을 표시합니다. 보완 설명은 사업명이 정확히 일치하는 경우에만 연결합니다.</p>
                <ul className="mt-4 grid gap-3 sm:grid-cols-3">
                  {[
                    ["기준", "보건복지부", "해당 지자체 사업안내의 사업별 원문"],
                    ["보완 1", "복지로", "정확히 같은 사업명의 공식 서비스 설명"],
                    ["보완 2", "복지톡 DB", "정확히 같은 사업명의 사업안내 설명 · 기준연도는 개별 출처 확인"],
                  ].map(([step, title, body]) => (
                    <li key={step} className="min-w-0 rounded-lg bg-(--jeju-surface-inset) p-3 text-(length:--jeju-text-sm)">
                      <span className="font-extrabold text-primary">{step}</span>
                      <strong className="ml-2 text-(--jeju-text-strong)">{title}</strong>
                      <p className="mt-1 leading-relaxed text-muted-foreground">{body}</p>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
