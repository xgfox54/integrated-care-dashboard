"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useSearchParams } from "next/navigation";

import { ZeroResultHelp } from "@/components/search/zero-result-help";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileIcon, RefreshIcon, SearchIcon } from "@/components/ui/jeju-icons";
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
      <NativeSelect id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="w-full">
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
    // 설명 첫머리가 화면 밖(휴대폰에서는 목록 위쪽)이면 그곳으로 옮긴다.
    window.requestAnimationFrame(() => {
      const top = detailRef.current?.getBoundingClientRect().top ?? 0;
      if (top < 0 || top > window.innerHeight) {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        detailRef.current?.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
      }
    });
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
    <main className="mx-auto grid max-w-(--jeju-main-max-wide) gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className={`${hasSelection ? "order-2" : ""} space-y-4 lg:order-none lg:sticky lg:top-4 lg:self-start print:hidden`}>
        <div>
          <div className="flex items-center gap-2">
            <FileIcon className="size-(--jeju-icon-lg) text-primary" />
            <h1 className="text-(length:--jeju-h1-size) leading-(--jeju-leading-tight) font-extrabold text-(--jeju-text-strong)">통합돌봄 WIKI</h1>
          </div>
          <p className="mt-2 text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">
            보건복지부 원자료를 기준으로 작성하고, 사업명이 정확히 일치할 때만 보완 설명을 연결합니다.
          </p>
        </div>

        <div className="grid gap-3" role="search" aria-label="WIKI 사업 검색">
          <div className="grid gap-1.5">
            <Label htmlFor="wiki-search">WIKI 사업 검색</Label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="wiki-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="사업명, 지역, 분야 검색"
                className="pl-9"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-3">
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
              placeholder="전체 기초시·군·구"
              disabled={!options}
              onChange={(value) => changeFilters({ sigungu: value })}
            />
            <SelectField
              id="wiki-category"
              label="사업 분류"
              value={filters.category}
              values={categoryValues}
              placeholder="전체 선택"
              disabled={!options}
              className="col-span-2"
              onChange={(value) => changeFilters({ category: value })}
            />
          </div>
          {keyword || hasFilters ? (
            <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={resetConditions}>
              <RefreshIcon />
              조건 초기화
            </Button>
          ) : null}
        </div>

        <p className="text-(length:--jeju-text-sm) text-muted-foreground" role="status" aria-live="polite">
          {selected && catalogPhase === "loading"
            ? "선택한 사업을 먼저 표시했습니다. 사업 목록을 불러오는 중입니다."
            : catalogPhase === "loading"
              ? keyword || hasFilters ? "검색 결과를 불러오는 중입니다." : "사업 목록을 불러오는 중입니다."
              : catalogPhase === "error"
                ? "사업 목록을 불러오지 못했습니다. 선택한 사업 내용은 계속 확인할 수 있습니다."
                : `${NUMBER_FORMAT.format(catalogTotalCount)}개 WIKI 항목 중 ${NUMBER_FORMAT.format(shownCount)}개 표시${loadingMore ? " · 이어서 불러오는 중" : ""}`}
        </p>

        {noResults ? (
          <div className="rounded-lg border border-dashed border-(--jeju-border-strong) bg-card px-3 py-5 text-center">
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

        <nav
          ref={listRef}
          onScroll={loadIfScrolled}
          aria-label="통합돌봄 WIKI 사업 목록"
          className="max-h-[62vh] space-y-2 overflow-y-auto p-0.5 pr-1"
        >
          {services.map((row) => {
            const active = serviceWikiKey(row) === selectedKey;
            return (
              <a
                key={serviceWikiKey(row)}
                href={wikiHref(row)}
                aria-current={active ? "page" : undefined}
                onClick={(event) => openService(event, row)}
                className={`block rounded-lg border px-3 py-2 text-(length:--jeju-text-sm) no-underline outline-none transition-colors focus-visible:shadow-(--jeju-focus-ring) ${
                  active
                    ? "border-primary bg-(--jeju-primary-tint) text-primary forced-colors:border-[Highlight]"
                    : "border-border bg-card text-(--jeju-text-body) hover:border-primary hover:bg-(--jeju-primary-tint)"
                }`}
              >
                <span className="block leading-snug font-bold">{row.name}</span>
                <span className="mt-1 block text-(length:--jeju-text-xs) text-muted-foreground">
                  {[row.sido, row.sigungu].filter(Boolean).join(" · ") || "전국"}
                </span>
              </a>
            );
          })}
          {hasMore ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={loadingMore}
              onClick={requestMore}
            >
              {loadingMore ? "불러오는 중" : moreFailed ? "목록을 더 불러오지 못했습니다 · 다시 시도" : "더 보기"}
            </Button>
          ) : null}
        </nav>
        <p className="sr-only" aria-live="polite">{announcement}</p>
      </aside>

      <div ref={detailRef} className={`scroll-mt-4 ${hasSelection ? "order-1 lg:order-none" : ""}`}>
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
            <p className="mt-2 text-(length:--jeju-text-sm) text-muted-foreground">잠시 후 다시 시도하거나 왼쪽 검색에서 사업을 찾아보세요.</p>
          </div>
        ) : hasSelection ? (
          <div className="rounded-xl border border-dashed border-(--jeju-border-strong) bg-card p-8 text-center">
            <h2 className="text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)">해당 사업을 현재 데이터에서 찾지 못했습니다.</h2>
            <p className="mt-2 text-(length:--jeju-text-sm) text-muted-foreground">왼쪽 검색에서 같은 사업명을 다시 찾아보세요.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-8">
            <h2 className="text-(length:--jeju-h2-size) font-extrabold text-(--jeju-text-strong)">사업 설명을 선택해 주세요.</h2>
            <p className="mt-2 max-w-2xl text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">
              왼쪽 목록에서 사업을 고르면 보건복지부 통합돌봄 사업안내에 수록된 해당 행으로
              사업명, 사업개요, 사업내용을 작성합니다. 원자료에서 대상이 확인될 때만 신청조건을 표시하며,
              복지로와 복지톡 DB는 사업명이 정확히 일치하는 경우에만 보완 설명으로 연결합니다.
            </p>
            <ol className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                ["기준", "보건복지부", "해당 지자체 사업안내의 사업별 원문"],
                ["보완 1", "복지로", "정확히 같은 사업명의 공식 서비스 설명"],
                ["보완 2", "복지톡 DB", "정확히 같은 사업명의 2026년 사업안내 설명"],
              ].map(([step, title, body]) => (
                <li key={step} className="rounded-lg border border-border bg-(--jeju-surface-inset) p-3 text-(length:--jeju-text-sm)">
                  <span className="font-extrabold text-primary">{step}</span>
                  <strong className="ml-2 text-(--jeju-text-strong)">{title}</strong>
                  <p className="mt-1 text-muted-foreground">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </main>
  );
}
