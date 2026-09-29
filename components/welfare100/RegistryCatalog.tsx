"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { SearchOperatorHelp } from "@/components/search/search-operator-help";
import { ZeroResultHelp } from "@/components/search/zero-result-help";
import { careSearchHref, useCareMatchCount } from "@/lib/cross-search";
import { prefersDataSaving } from "@/lib/network-preferences";
import {
  correctionFrom,
  matchesSearch,
  namesForSuggestion,
  parseSearch,
  rebuildQuery,
  relevanceScore,
  termMatches,
  type ParsedSearch,
  type SearchHelp,
} from "@/lib/search-terms";
import { trackEvent } from "@/lib/welfare100/client-events";
import { loadCatalog, loadFullCatalog, type CatalogEntry } from "@/lib/welfare100/payload";
import { catalogRegions } from "@/lib/welfare100/regions";
import { normalizeName, type FilterKind } from "@/lib/usage/codes";
import { markUsageInternalNavigation, setUsageHandoff, usageError, usageErrorCode, usageFilter, usagePage, usagePerf } from "@/lib/usage/track";
import { useSearchUsage } from "@/lib/usage/use-search-usage";
import { watchVisitorRegion, type VisitorRegion } from "@/lib/visitor-location";
import CompareTray from "./CompareTray";
import styles from "./RegistryCatalog.module.css";

// Adapted from hosungseo/korea100 RegistryCatalog (MIT License).

interface RegistryCatalogProps {
  categoryOrder: string[];
  lifecycleOrder: string[];
  householdOrder: string[];
}

/** auto: 검색어가 있으면 관련도순, 없으면 기본순 */
type SortMode = "auto" | "priority" | "name";
type Scope = "전체" | "주요 제도" | "중앙부처" | "지자체";

const PAGE_SIZE = 30;
const MAX_COMPARE = 3;
const ALL = "전체";
const ALL_TYPES = "전체 제공유형";
const ALL_SIDO = "전체 시도";
const ALL_SIGUNGU = "시도 전체";
const SCOPES: Scope[] = ["전체", "주요 제도", "중앙부처", "지자체"];
const SCOPE_COLORS: Record<Scope, string> = { 전체: "var(--jeju-text-muted)", "주요 제도": "var(--jeju-primary)", 중앙부처: "var(--jeju-blue-deep)", 지자체: "var(--jeju-warning)" };

export const TOPIC_COLORS: Record<string, string> = {
  생활지원: "var(--jeju-primary)",
  신체건강: "var(--jeju-blue-dark)",
  정신건강: "var(--jeju-blue-deep)",
  주거: "var(--jeju-orange-deep)",
  일자리: "var(--jeju-warning)",
  "문화·여가": "var(--jeju-danger)",
  "안전·위기": "var(--jeju-danger)",
  "임신·출산": "var(--jeju-danger)",
  보육: "var(--jeju-orange-dark)",
  교육: "var(--jeju-blue-dark)",
  "입양·위탁": "var(--jeju-blue-deep)",
  "보호·돌봄": "var(--jeju-orange-deep)",
  서민금융: "var(--jeju-blue-deep)",
  법률: "var(--jeju-text-muted)",
  에너지: "var(--jeju-orange-deep)",
};

const LIFECYCLE_COLORS = ["var(--jeju-danger)", "var(--jeju-orange-dark)", "var(--jeju-orange-deep)", "var(--jeju-green-dark)", "var(--jeju-blue-dark)", "var(--jeju-blue-dark)", "var(--jeju-blue-deep)"];
const HOUSEHOLD_COLORS = ["var(--jeju-primary)", "var(--jeju-blue-dark)", "var(--jeju-orange-deep)", "var(--jeju-orange-dark)", "var(--jeju-blue-deep)", "var(--jeju-text-muted)"];

interface Filters {
  query: string;
  scope: Scope;
  sido: string;
  sigungu: string;
  category: string;
  lifecycle: string;
  household: string;
  provision: string;
}

type FacetKey = "scope" | "region" | "category" | "lifecycle" | "household" | "provision";
const NO_SEARCH: ParsedSearch = parseSearch("");

function matches(entry: CatalogEntry, filters: Filters, parsed: ParsedSearch, skip?: FacetKey): boolean {
  if (skip !== "scope") {
    if (filters.scope === "주요 제도" && !entry.curated) return false;
    if (filters.scope === "중앙부처" && entry.org !== "중앙부처") return false;
    if (filters.scope === "지자체" && entry.org !== "지자체") return false;
  }
  if (skip !== "region" && filters.sido !== ALL_SIDO && entry.org === "지자체") {
    if (entry.sido !== filters.sido) return false;
    if (filters.sigungu !== ALL_SIGUNGU && entry.sigungu && entry.sigungu !== filters.sigungu) return false;
  }
  if (skip !== "category" && filters.category !== ALL && !entry.topics.includes(filters.category)) return false;
  if (skip !== "lifecycle" && filters.lifecycle !== ALL && !entry.lifecycle.includes(filters.lifecycle)) return false;
  if (skip !== "household" && filters.household !== ALL && !entry.household.includes(filters.household)) return false;
  if (skip !== "provision" && filters.provision !== ALL_TYPES && !entry.provision.includes(filters.provision)) return false;
  // 중앙부처 제도는 전국 공통이라 검색어의 지역어를 따지지 않는다(지역 필터와 같은 뜻).
  return matchesSearch(entry.searchText, parsed, { ignoreRegion: entry.org === "중앙부처" });
}

function countFacet(entries: CatalogEntry[], filters: Filters, parsed: ParsedSearch, skip: FacetKey, keyOf: (entry: CatalogEntry) => string[]) {
  const counts = new Map<string, number>();
  let total = 0;
  for (const entry of entries) {
    if (!matches(entry, filters, parsed, skip)) continue;
    total++;
    for (const key of keyOf(entry)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { counts, total };
}

export default function RegistryCatalog({ categoryOrder, lifecycleOrder, householdOrder }: RegistryCatalogProps) {
  const searchParams = useSearchParams();
  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [detailed, setDetailed] = useState(false);
  const [asOf, setAsOf] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    const started = performance.now();
    loadCatalog()
      .then((catalog) => {
        if (!alive) return;
        // 전체 색인이 먼저 도착했으면 그대로 둔다.
        setEntries((current) => current ?? catalog.entries);
        setAsOf(catalog.asOf);
        setError(null);
        usagePerf("welfare_catalog", performance.now() - started);
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : "복지제도 목록을 불러오지 못했습니다.");
        usageError("welfare_catalog", usageErrorCode(reason));
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  useEffect(() => {
    usagePage("welfare_list", "welfare100");
  }, []);

  const param = (key: string, fallback: string) => searchParams.get(key) || fallback;
  const [filters, setFilters] = useState<Filters>(() => {
    // 예전 주소의 '심층 분석'은 새 이름 '주요 제도'로 잇는다.
    const scope = searchParams.get("scope") === "심층 분석" ? "주요 제도" : searchParams.get("scope");
    return {
      query: searchParams.get("q") ?? "",
      scope: SCOPES.includes(scope as Scope) ? (scope as Scope) : "전체",
      sido: param("sido", ALL_SIDO),
      sigungu: param("sigungu", ALL_SIGUNGU),
      category: categoryOrder.includes(searchParams.get("category") ?? "") ? (searchParams.get("category") as string) : ALL,
      lifecycle: lifecycleOrder.includes(searchParams.get("life") ?? "") ? (searchParams.get("life") as string) : ALL,
      household: householdOrder.includes(searchParams.get("household") ?? "") ? (searchParams.get("household") as string) : ALL,
      provision: param("type", ALL_TYPES),
    };
  });
  const [sort, setSort] = useState<SortMode>(() => {
    const value = searchParams.get("sort");
    return value === "name" || value === "priority" ? value : "auto";
  });
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedSlugs, setSelectedSlugs] = useState(() =>
    (searchParams.get("compare") ?? "").split(",").filter(Boolean).slice(0, MAX_COMPARE),
  );
  const [visitorRegion, setVisitorRegion] = useState<VisitorRegion | null>(null);
  const visitorSido = visitorRegion?.sido ?? null;

  // 목록은 가벼운 색인으로 먼저 그리고, 담당·법령까지 담은 전체 색인은 이어서 받는다.
  // 데이터 절약 모드에서는 검색하거나 비교를 시작할 때만 받는다.
  const needsDetails = filters.query.trim() !== "" || selectedSlugs.length > 0;
  const listReady = entries !== null;
  useEffect(() => {
    if (!listReady || detailed) return;
    if (!needsDetails && prefersDataSaving()) return;
    let alive = true;
    const start = () => {
      loadFullCatalog()
        .then((catalog) => {
          if (!alive) return;
          setEntries(catalog.entries);
          setDetailed(true);
        })
        .catch(() => undefined);
    };
    if (needsDetails || typeof window.requestIdleCallback !== "function") {
      const timer = window.setTimeout(start, needsDetails ? 0 : 300);
      return () => {
        alive = false;
        window.clearTimeout(timer);
      };
    }
    const idle = window.requestIdleCallback(start, { timeout: 2000 });
    return () => {
      alive = false;
      window.cancelIdleCallback(idle);
    };
  }, [detailed, listReady, needsDetails]);

  useEffect(() => {
    if (searchParams.get("sido")) return;
    return watchVisitorRegion((update) => {
      if (update.status === "resolved" && update.region) setVisitorRegion(update.region);
    });
  }, [searchParams]);

  function update(patch: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setVisibleCount(PAGE_SIZE);
  }

  /** 이용자가 직접 고른 분류·조회 대상 지역을 세고 적용한다('전체'로 되돌리기는 세지 않는다). */
  function choose(patch: Partial<Filters>) {
    const track = (filter: FilterKind, value: string | undefined, all: string) => {
      if (value !== undefined && value !== all) usageFilter(filter, value);
    };
    track("welfare_topic", patch.category, ALL);
    track("welfare_scope", patch.scope, "전체");
    track("welfare_lifecycle", patch.lifecycle, ALL);
    track("welfare_household", patch.household, ALL);
    track("welfare_provision", patch.provision, ALL_TYPES);
    if (patch.sigungu !== undefined && patch.sigungu !== ALL_SIGUNGU) {
      usageFilter("welfare_region", (patch.sido ?? filters.sido) + "|" + patch.sigungu);
    } else {
      track("welfare_region", patch.sido, ALL_SIDO);
    }
    update(patch);
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    updateUrlParam(url, "q", filters.query.trim());
    updateUrlParam(url, "scope", filters.scope === "전체" ? "" : filters.scope);
    updateUrlParam(url, "sido", filters.sido === ALL_SIDO ? "" : filters.sido);
    updateUrlParam(url, "sigungu", filters.sigungu === ALL_SIGUNGU ? "" : filters.sigungu);
    updateUrlParam(url, "category", filters.category === ALL ? "" : filters.category);
    updateUrlParam(url, "life", filters.lifecycle === ALL ? "" : filters.lifecycle);
    updateUrlParam(url, "household", filters.household === ALL ? "" : filters.household);
    updateUrlParam(url, "type", filters.provision === ALL_TYPES ? "" : filters.provision);
    updateUrlParam(url, "sort", sort === "auto" ? "" : sort);
    updateUrlParam(url, "compare", selectedSlugs.join(","));
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [filters, selectedSlugs, sort]);

  const list = useMemo(() => entries ?? [], [entries]);
  const bySlug = useMemo(() => new Map(list.map((entry) => [entry.slug, entry])), [list]);
  const parsed = useMemo(() => parseSearch(filters.query), [filters.query]);
  const hasQuery = parsed.terms.length > 0;
  const sortMode = sort === "auto" ? (hasQuery ? "relevance" : "priority") : sort;

  const regions = useMemo(() => catalogRegions(list), [list]);
  const provisions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of list) for (const value of entry.provision) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([value]) => value);
  }, [list]);

  const facets = useMemo(
    () => ({
      scope: countFacet(list, filters, parsed, "scope", (entry) => [entry.org, ...(entry.curated ? ["주요 제도"] : [])]),
      category: countFacet(list, filters, parsed, "category", (entry) => entry.topics),
      lifecycle: countFacet(list, filters, parsed, "lifecycle", (entry) => entry.lifecycle),
      household: countFacet(list, filters, parsed, "household", (entry) => entry.household),
    }),
    [filters, list, parsed],
  );

  const filtered = useMemo(() => {
    const found = list.filter((entry) => matches(entry, filters, parsed));
    const localFirst = filters.sido !== ALL_SIDO || parsed.hasRegion;
    const byPriority = (left: CatalogEntry, right: CatalogEntry) => {
      if (localFirst && left.org !== right.org) return left.org === "지자체" ? -1 : 1;
      return left.priority - right.priority;
    };
    if (sortMode === "name") return found.sort((left, right) => left.name.localeCompare(right.name, "ko"));
    if (sortMode === "priority") return found.sort(byPriority);
    // 관련도순: 제도명 일치 > 분야 일치 > 그 밖의 일치. 같으면 기본순.
    const scores = new Map(found.map((entry) => [entry.slug, relevanceScore({ name: entry.name, category: [entry.category, ...entry.topics].join(" ") }, parsed)]));
    return found.sort((left, right) => (scores.get(right.slug) ?? 0) - (scores.get(left.slug) ?? 0) || byPriority(left, right));
  }, [filters, list, parsed, sortMode]);

  const visible = filtered.slice(0, visibleCount);

  // 0건일 때 도움말: 전체 대장에 없는 단어는 오타로 보고 고칠 말을, 두 단어 이상이면 하나씩 뺀 결과 수를 알려 준다.
  const noResults = entries !== null && hasQuery && filtered.length === 0;
  const zeroHelp = useMemo<SearchHelp | undefined>(() => {
    if (!noResults) return undefined;
    const countOf = (query: string) => list.filter((entry) => matches(entry, filters, parseSearch(query))).length;
    const withoutTerm =
      parsed.terms.length >= 2
        ? parsed.terms.map((term, index) => {
            const query = rebuildQuery(parsed, index);
            return { term: term.text, query, count: countOf(query) };
          })
        : undefined;
    let suggestion: { query: string; count: number } | undefined;
    const unknown = parsed.terms
      .map((term, index) => ({ term, index }))
      .filter(({ term }) => !term.region && term.plain && !list.some((entry) => termMatches(entry.searchText, term)));
    if (unknown.length > 0) {
      const names = namesForSuggestion(list.map((entry) => entry.name));
      const words = parsed.terms.map((term) => term.text);
      let changed = false;
      for (const { term, index } of unknown) {
        const fix = correctionFrom(term.key, names);
        if (fix) {
          words[index] = fix;
          changed = true;
        }
      }
      if (changed) {
        const query = words.join(" ");
        const count = countOf(query);
        if (count > 0) suggestion = { query, count };
      }
    }
    return suggestion || withoutTerm ? { ...(suggestion ? { suggestion } : {}), ...(withoutTerm ? { withoutTerm } : {}) } : undefined;
  }, [filters, list, noResults, parsed]);
  const careCount = useCareMatchCount(filters.query, noResults);

  // 이용통계: 검색어가 현재 조건 안의 제도명 하나와 정확히 같을 때만 그 제도를 '검색 대상'으로 본다.
  const nameMatch = useMemo(() => {
    const target = normalizeName(filters.query);
    if (!target || entries === null) return null;
    const scoped = list.filter((entry) => normalizeName(entry.name) === target && matches(entry, { ...filters, query: "" }, NO_SEARCH));
    if (scoped.length === 1) return { status: "matched" as const, key: scoped[0].slug };
    return { status: scoped.length === 0 ? ("unmatched" as const) : ("ambiguous" as const) };
  }, [entries, filters, list]);
  const { confirm: confirmSearch } = useSearchUsage({
    scope: "welfare_catalog",
    keyword: filters.query,
    conditions: [filters.scope, filters.sido, filters.sigungu, filters.category, filters.lifecycle, filters.household, filters.provision].join("|"),
    settled: entries !== null,
    failed: false,
    count: filtered.length,
    match: nameMatch,
  });
  const openDetail = (slug: string, route: "list" | "compare") => {
    const searching = route === "list" && filters.query.trim() !== "";
    setUsageHandoff("welfare_policy", slug, searching ? "search" : route, searching ? confirmSearch() : undefined);
    markUsageInternalNavigation("welfare100");
  };
  const selected = selectedSlugs.map((slug) => bySlug.get(slug)).filter((entry): entry is CatalogEntry => Boolean(entry));
  const stats = useMemo(
    () => ({
      central: list.filter((entry) => entry.org === "중앙부처").length,
      local: list.filter((entry) => entry.org === "지자체").length,
      talk: list.filter((entry) => entry.sourceCount > 0).length,
    }),
    [list],
  );
  const regionLabel = filters.sido === ALL_SIDO ? "" : filters.sigungu === ALL_SIGUNGU ? filters.sido : filters.sigungu;
  const filterTitle = [
    filters.scope === "전체" ? "" : filters.scope,
    regionLabel,
    filters.category === ALL ? "" : filters.category,
    filters.lifecycle === ALL ? "" : filters.lifecycle,
    filters.household === ALL ? "" : filters.household,
  ]
    .filter(Boolean)
    .join(" · ");

  function toggleCompare(slug: string) {
    setSelectedSlugs((current) => {
      if (current.includes(slug)) return current.filter((item) => item !== slug);
      if (current.length >= MAX_COMPARE) return current;
      trackEvent("comparison_add", { slug, selected_count: current.length + 1 });
      return [...current, slug];
    });
  }

  return (
    <section id="institutions" className={styles.registry} aria-labelledby="registry-title">
      {/* 화면 제목(h1). 화면에는 검색·통계 띠가 제목 역할을 하므로 보조기술에만 읽힌다. */}
      <h1 id="registry-title" className="sr-only">
        복지제도100 · 복지제도 대장
      </h1>
      <div className={styles.statBand}>
        <div className={styles.searchBox}>
          <label htmlFor="registry-search">검색</label>
          <input
            id="registry-search"
            type="search"
            value={filters.query}
            placeholder="제도명 · 개요 · 담당기관 · 지역 · 법령"
            onChange={(event) => update({ query: event.target.value })}
          />
          <div className="shrink-0 px-1">
            <SearchOperatorHelp align="end" />
          </div>
          {filters.query ? (
            <button type="button" aria-label="검색어 지우기" title="검색어 지우기" onClick={() => update({ query: "" })}>
              ×
            </button>
          ) : (
            <span>{entries ? "전체 색인 " + list.length.toLocaleString("ko-KR") + "건" : "색인 불러오는 중"}</span>
          )}
        </div>
        <div className={styles.stats} aria-label="복지제도 대장 통계">
          <RegistryStat value={list.length} label="복지제도" />
          <RegistryStat value={stats.central} label="중앙부처" />
          <RegistryStat value={stats.local} label="지자체" />
          <RegistryStat value={stats.talk} label="복지톡 DB 원문 연결" accent />
        </div>
      </div>

      <div className={styles.body}>
        <aside className={styles.rail} aria-label="복지제도 필터">
          <div className={styles.railHeading}>분야 · 복지로 관심주제</div>
          <div className={styles.railGroups}>
            {[ALL, ...categoryOrder].map((category) => {
              const active = filters.category === category;
              const color = category === ALL ? "var(--jeju-text-strong)" : TOPIC_COLORS[category] ?? "var(--jeju-text-muted)";
              return (
                <button
                  key={category}
                  type="button"
                  className={styles.railItem}
                  aria-pressed={active}
                  style={{ "--category-color": color } as CSSProperties}
                  onClick={() => choose({ category })}
                >
                  <span>
                    <i aria-hidden="true" />
                    {category}
                  </span>
                  <strong>{(category === ALL ? facets.category.total : facets.category.counts.get(category) ?? 0).toLocaleString("ko-KR")}</strong>
                </button>
              );
            })}
          </div>

          <fieldset className={styles.verificationFilter}>
            <legend>구분</legend>
            {SCOPES.map((scope) => (
              <FilterRadio
                key={scope}
                label={scope === "주요 제도" ? "주요 제도 100" : scope}
                count={scope === "전체" ? facets.scope.total : facets.scope.counts.get(scope) ?? 0}
                active={filters.scope === scope}
                color={SCOPE_COLORS[scope]}
                onClick={() => choose({ scope })}
              />
            ))}
          </fieldset>

          <div className={styles.regionFilter}>
            <span>지역 (지자체 서비스)</span>
            <select
              aria-label="시도 선택"
              value={filters.sido}
              onChange={(event) => choose({ sido: event.target.value, sigungu: ALL_SIGUNGU })}
            >
              <option value={ALL_SIDO}>{ALL_SIDO}</option>
              {regions.sidos.map(([sido, count]) => (
                <option key={sido} value={sido}>
                  {sido} ({count})
                </option>
              ))}
            </select>
            <select
              aria-label="시군구 선택"
              value={filters.sigungu}
              disabled={filters.sido === ALL_SIDO}
              onChange={(event) => choose({ sigungu: event.target.value })}
            >
              <option value={ALL_SIGUNGU}>{ALL_SIGUNGU}</option>
              {filters.sido !== ALL_SIDO &&
                regions.sigungus(filters.sido).map(([sigungu, count]) => (
                  <option key={sigungu} value={sigungu}>
                    {sigungu} ({count})
                  </option>
                ))}
            </select>
            {filters.sido !== ALL_SIDO && <small>중앙부처 서비스는 전국 공통이라 함께 보입니다.</small>}
            {filters.sido === ALL_SIDO && visitorSido && regions.sidos.some(([sido]) => sido === visitorSido) && (
              <button type="button" className={styles.visitorRegion} onClick={() => choose({ sido: visitorSido, sigungu: ALL_SIGUNGU })}>
                접속 지역 {visitorSido} 서비스 보기
              </button>
            )}
          </div>

          <fieldset className={styles.verificationFilter}>
            <legend>생애주기</legend>
            {[ALL, ...lifecycleOrder].map((value, index) => (
              <FilterRadio
                key={value}
                label={value}
                count={value === ALL ? facets.lifecycle.total : facets.lifecycle.counts.get(value) ?? 0}
                active={filters.lifecycle === value}
                color={value === ALL ? "var(--jeju-text-muted)" : LIFECYCLE_COLORS[(index - 1) % LIFECYCLE_COLORS.length]}
                onClick={() => choose({ lifecycle: value })}
              />
            ))}
          </fieldset>

          <fieldset className={styles.verificationFilter}>
            <legend>가구상황</legend>
            {[ALL, ...householdOrder].map((value, index) => (
              <FilterRadio
                key={value}
                label={value}
                count={value === ALL ? facets.household.total : facets.household.counts.get(value) ?? 0}
                active={filters.household === value}
                color={value === ALL ? "var(--jeju-text-muted)" : HOUSEHOLD_COLORS[(index - 1) % HOUSEHOLD_COLORS.length]}
                onClick={() => choose({ household: value })}
              />
            ))}
          </fieldset>

          <label className={styles.typeFilter}>
            <span>제공유형</span>
            <select value={filters.provision} onChange={(event) => choose({ provision: event.target.value })}>
              <option>{ALL_TYPES}</option>
              {provisions.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </aside>

        <div className={styles.tablePane}>
          <div className={styles.tableToolbar}>
            <p aria-live="polite">
              <strong>{filterTitle || "복지제도 대장"}</strong>
              <span> · {entries ? filtered.length.toLocaleString("ko-KR") + "개 결과" : "불러오는 중"}</span>
            </p>
            <div className={styles.sortControl} role="group" aria-label="정렬 방식">
              {(hasQuery
                ? ([["auto", "관련도순"], ["priority", "기본순"], ["name", "가나다"]] as const)
                : ([["auto", "기본순"], ["name", "가나다"]] as const)
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={sort === value || (!hasQuery && value === "auto" && sort === "priority")}
                  onClick={() => setSort(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <div className={styles.empty}>
              <strong>{error}</strong>
              <button type="button" className={styles.retryButton} onClick={() => setAttempt((value) => value + 1)}>
                다시 불러오기
              </button>
            </div>
          ) : !entries ? (
            <div className={styles.empty} role="status">
              <strong>복지제도 대장을 불러오는 중입니다.</strong>
              <span>복지로 중앙부처·지자체 서비스와 복지톡 DB 연결 정보를 받는 중입니다.</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className={styles.empty}>
              <strong>검색 결과가 없습니다.</strong>
              <span>검색어를 줄이거나 다른 분야·지역을 선택해 보세요.</span>
              {hasQuery ? (
                <ZeroResultHelp
                  help={zeroHelp}
                  onSearch={(query) => update({ query })}
                  crossLinks={[{ label: "통합돌봄 사업에서", href: careSearchHref(filters.query), count: careCount }]}
                />
              ) : null}
            </div>
          ) : (
            <>
              <div className={styles.tableScroll}>
                <table className={styles.registryTable}>
                  <thead>
                    <tr>
                      <th scope="col">NO</th>
                      <th scope="col">제도</th>
                      <th scope="col">구분 · 지역</th>
                      <th scope="col">제공유형</th>
                      <th scope="col">분야</th>
                      <th scope="col">근거 원문</th>
                      <th scope="col">노드</th>
                      <th scope="col">비교</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((entry) => (
                      <RegistryRow
                        key={entry.slug}
                        entry={entry}
                        selected={selectedSlugs.includes(entry.slug)}
                        disabled={selectedSlugs.length >= MAX_COMPARE && !selectedSlugs.includes(entry.slug)}
                        onToggle={() => toggleCompare(entry.slug)}
                        onOpen={() => openDetail(entry.slug, "list")}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.mobileList}>
                {visible.map((entry) => (
                  <MobileRegistryRow
                    key={entry.slug}
                    entry={entry}
                    selected={selectedSlugs.includes(entry.slug)}
                    disabled={selectedSlugs.length >= MAX_COMPARE && !selectedSlugs.includes(entry.slug)}
                    onToggle={() => toggleCompare(entry.slug)}
                    onOpen={() => openDetail(entry.slug, "list")}
                  />
                ))}
              </div>
            </>
          )}

          {entries && visible.length < filtered.length && (
            <button type="button" className={styles.loadMore} onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
              제도 더 보기
              <span>
                {visible.length.toLocaleString("ko-KR")}/{filtered.length.toLocaleString("ko-KR")}
              </span>
            </button>
          )}
          {entries && (
            <p className={styles.sourceNote}>
              출처: 복지로 복지서비스(중앙부처 {stats.central.toLocaleString("ko-KR")}건·지자체 {stats.local.toLocaleString("ko-KR")}건, {asOf} 수집) ·
              복지톡 DB 사업안내 매뉴얼. &lsquo;주요 제도 100&rsquo;은 복지톡 DB 원문으로 병목·개선점까지 정리한 제도입니다.
            </p>
          )}
        </div>
      </div>

      <CompareTray selected={selected} onRemove={(slug) => toggleCompare(slug)} onOpenDetail={(slug) => openDetail(slug, "compare")} />
    </section>
  );
}

function RegistryStat({ value, label, accent = false }: { value: number; label: string; accent?: boolean }) {
  return (
    <div data-accent={accent ? "true" : undefined}>
      <strong>{value.toLocaleString("ko-KR")}</strong>
      <span>{label}</span>
    </div>
  );
}

function FilterRadio({
  label,
  count,
  active,
  color,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  color: string;
  onClick: () => void;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}>
      <i style={{ background: color }} aria-hidden="true" />
      <span>{label}</span>
      <strong>{count.toLocaleString("ko-KR")}</strong>
    </button>
  );
}

export function regionText(entry: Pick<CatalogEntry, "org" | "sido" | "sigungu">): string {
  if (entry.org === "중앙부처") return "중앙부처";
  const sido = entry.sido.replace(/(특별자치도|특별자치시|통합특별시|광역시|특별시)$/, "").replace(/^(충청|전라|경상)(남|북)도$/, (_, a: string, b: string) => a[0] + b);
  return [sido || "지자체", entry.sigungu].filter(Boolean).join(" ");
}

function SourceLabel({ entry }: { entry: CatalogEntry }) {
  if (entry.curated) {
    return (
      <span className={styles.verificationLabel} data-tone="verified">
        <i aria-hidden="true" />
        주요 제도
      </span>
    );
  }
  if (entry.sourceCount > 0) {
    return (
      <span className={styles.verificationLabel} data-tone="linked">
        <i aria-hidden="true" />
        복지톡 DB {entry.sourceCount}
      </span>
    );
  }
  return (
    <span className={styles.verificationLabel} data-tone="review">
      <i aria-hidden="true" />
      복지로 원문
    </span>
  );
}

function RegistryRow({
  entry,
  selected,
  disabled,
  onToggle,
  onOpen,
}: {
  entry: CatalogEntry;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const categoryColor = TOPIC_COLORS[entry.category] ?? "var(--jeju-text-muted)";
  return (
    <tr style={{ "--category-color": categoryColor } as CSSProperties}>
      <td className={styles.numberCell}>{entry.priority.toString().padStart(2, "0")}</td>
      <td className={styles.nameCell}>
        <a href={"/welfare100/" + entry.slug} onClick={onOpen}>
          <strong>{entry.name}</strong>
          <span>{entry.oneLiner}</span>
        </a>
      </td>
      <td className={styles.orgCell} data-org={entry.org}>
        {regionText(entry)}
      </td>
      <td>{entry.provision.join("·")}</td>
      <td>
        <span className={styles.categoryBadge}>{entry.category}</span>
      </td>
      <td>
        <SourceLabel entry={entry} />
      </td>
      <td className={styles.nodeCell}>{entry.processNodeCount}</td>
      <td className={styles.compareCell}>
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onChange={onToggle}
          aria-label={entry.name + " 비교 " + (selected ? "제외" : "추가")}
          title={disabled ? "최대 3개까지 비교할 수 있습니다" : undefined}
        />
      </td>
    </tr>
  );
}

function MobileRegistryRow({
  entry,
  selected,
  disabled,
  onToggle,
  onOpen,
}: {
  entry: CatalogEntry;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const tone = entry.curated ? "verified" : entry.sourceCount > 0 ? "linked" : "review";
  return (
    <article>
      <span className={styles.mobileNumber}>{entry.priority.toString().padStart(2, "0")}</span>
      <a href={"/welfare100/" + entry.slug} onClick={onOpen}>
        <span className={styles.mobileTitleLine}>
          <strong>{entry.name}</strong>
          <i data-tone={tone} aria-label={entry.curated ? "주요 제도" : entry.sourceCount > 0 ? "복지톡 DB 원문 연결" : "복지로 원문"} />
        </span>
        <span className={styles.mobileDescription}>{entry.oneLiner}</span>
        <span className={styles.mobileMeta}>
          {regionText(entry)} · {entry.category} · {entry.provision.join("·")} · 노드 {entry.processNodeCount}
        </span>
      </a>
      <input
        type="checkbox"
        checked={selected}
        disabled={disabled}
        onChange={onToggle}
        aria-label={entry.name + " 비교 " + (selected ? "제외" : "추가")}
      />
    </article>
  );
}

function updateUrlParam(url: URL, key: string, value: string) {
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
}
