"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { BuildingIcon, CalendarIcon, ExternalLinkIcon, RefreshIcon, SearchIcon } from "@/components/ui/jeju-icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { KoreaVectorMap } from "@/components/dashboard/korea-vector-map";
import { CATEGORY_LABELS, ORG_TYPE_LABELS, PRESS_CATEGORIES } from "@/lib/press/dictionary";
import { REGION_DEFINITIONS, buildRegionStatisticsFromCounts } from "@/lib/region-statistics";
import { usageClick, usageError, usageErrorCode, usageFilter } from "@/lib/usage/track";
import { useSearchUsage } from "@/lib/usage/use-search-usage";
import { PRESS_PERIODS, pressPeriodQuery } from "@/lib/press-period";
import { PressPeriodControls } from "@/components/press/press-period-controls";
import { parseTargetGroup, targetGroupOf } from "@/lib/target-groups";

interface PressItem {
  readonly article_id: string;
  readonly title: string;
  readonly original_url: string;
  readonly published_date: string | null;
  readonly publication_precision: string;
  readonly category_ids: readonly string[];
  readonly issued_by: { readonly organization_id: string; readonly name: string; readonly type?: string };
  readonly publisher_region?: { readonly sido: string; readonly sigungu: string };
}
interface PressPage { readonly items: readonly PressItem[]; readonly total_count: number; readonly page: number; readonly size: number }
interface CoverageSource { readonly organization_id: string; readonly organization_name: string; readonly approval_status: string }
interface Coverage {
  readonly targets: { readonly organizations: number; readonly basis: string };
  readonly coverage: { readonly approved_active_sources: number; readonly normal_organizations_24h: number };
  readonly items: { readonly public_total: number; readonly display_total?: number; readonly related_group_count?: number; readonly discovered_24h: number; readonly latest_published_date: string };
  readonly survey?: { readonly by_category: Readonly<Record<string, number>>; readonly categories: Readonly<Record<string, string>> };
  readonly schedule: { readonly note: string };
  readonly sources: readonly CoverageSource[];
}
interface OrganizationCount { readonly organization_id: string; readonly name: string; readonly organization_type: string; readonly sido: string; readonly count: number }
interface PressRegions {
  readonly by_sido: Readonly<Record<string, number>>;
  readonly by_organization_type?: Readonly<Record<string, number>>;
  readonly by_category?: Readonly<Record<string, number>>;
  readonly by_organization?: readonly OrganizationCount[];
  readonly areas: readonly { readonly sido: string; readonly sigungu: string; readonly count: number }[];
}
interface Filters {
  readonly q: string; readonly category: string; readonly period: string; readonly from: string; readonly to: string;
  readonly organizationId: string; readonly organizationType: string; readonly sido: string; readonly sigungu: string; readonly includeDescendants: boolean;
  readonly page: number; readonly size: number; readonly sort: "newest" | "oldest";
  /** 대상자 묶음 slug(관계성 지도에서 연 목록). 제목에 묶음 낱말 중 하나가 들어간 보도자료. */
  readonly targetGroup: string;
}

const PAGE_SIZES = [10, 20, 50] as const;
const EMPTY: Filters = { q: "", category: "", period: "", from: "", to: "", organizationId: "", organizationType: "", sido: "", sigungu: "", includeDescendants: false, page: 1, size: 20, sort: "newest", targetGroup: "" };
// 주소에 남기는 조건(공유·지도 연결용). 검색어는 남기지 않는다. 대상자 묶음은 새로고침·공유에도 같은 목록이 되도록 남긴다.
const URL_KEYS = [["sido", "sido"], ["sigungu", "sigungu"], ["organizationId", "organization_id"], ["organizationType", "organization_type"], ["category", "category"], ["targetGroup", "target_group"]] as const;
const ORGANIZATIONS_SHOWN = 12;
/** 휴대폰 폭에서는 목록이 결과보다 먼저 길게 나오지 않도록 5곳만 먼저 보인다. */
const ORGANIZATIONS_SHOWN_MOBILE = 5;
/** 분야 색 점: 사이트 포인트 색(파랑·초록·주황)을 분야 순서대로 돌려 쓴다. */
const DOT_COLORS = ["var(--jeju-blue)", "var(--jeju-green)", "var(--jeju-orange)"] as const;
const dotColor = (category: string | undefined) => {
  const index = PRESS_CATEGORIES.findIndex((item) => item.code === category);
  return index < 0 ? "var(--jeju-border-strong, #9aa5b1)" : DOT_COLORS[index % DOT_COLORS.length];
};

function requestPath(filters: Filters): string {
  const params = new URLSearchParams({ size: String(filters.size), page: String(filters.page), group_mode: "verified_groups" });
  if (filters.sort === "oldest") params.set("sort", "oldest");
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.category) params.set("category", filters.category);
  if (filters.organizationId) params.set("organization_id", filters.organizationId);
  if (filters.organizationType) params.set("organization_type", filters.organizationType);
  if (filters.sido) params.set("sido", filters.sido);
  if (filters.sigungu) params.set("sigungu", filters.sigungu);
  if (filters.sigungu && filters.includeDescendants) params.set("include_descendants", "1");
  if (filters.targetGroup) params.set("target_group", filters.targetGroup);
  for (const [key, value] of pressPeriodQuery(filters)) params.set(key, value);
  return `/api/press?${params.toString()}`;
}

function filtersFromLocation(search: string): Filters | null {
  const params = new URLSearchParams(search);
  let found = false;
  let filters: Filters = EMPTY;
  for (const [key, param] of URL_KEYS) {
    const value = (params.get(param) ?? "").trim().slice(0, 100);
    if (!value) continue;
    // 알 수 없는 대상자 묶음은 조건으로 쓰지 않는다(API도 거절한다).
    if (key === "targetGroup" && !parseTargetGroup(value)) continue;
    found = true;
    filters = { ...filters, [key]: value };
  }
  if (params.get("include_descendants") === "1") filters = { ...filters, includeDescendants: true };
  // 관계성 지도 등에서 넘어온 검색어는 받아서 적용하되, 주소에는 다시 쓰지 않는다.
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  if (q) { found = true; filters = { ...filters, q }; }
  return found ? filters : null;
}

/** 발행기관의 상위 지역(예: 덕양구 → 경기도 고양시). 기관명과 겹치는 부분은 빼고, 광역·중앙은 비운다. */
function upperRegion(item: PressItem): string {
  const full = [item.publisher_region?.sido, item.publisher_region?.sigungu].filter(Boolean).join(" ");
  return full.endsWith(item.issued_by.name) ? full.slice(0, -item.issued_by.name.length).trim() : full;
}

function regionAliases(sido: string): readonly string[] {
  return REGION_DEFINITIONS.find((region) => region.aliases.some((alias) => alias === sido))?.aliases ?? [sido];
}

/** 쪽 번호 목록: 처음·끝과 현재 쪽 앞뒤 한 쪽씩, 사이는 줄임표. */
function pageNumbers(current: number, total: number): readonly (number | "gap")[] {
  const wanted = [...new Set([1, current - 1, current, current + 1, total])].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  const result: (number | "gap")[] = [];
  wanted.forEach((page, index) => {
    if (index > 0 && page - wanted[index - 1] > 1) result.push("gap");
    result.push(page);
  });
  return result;
}

async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { cache: "no-store", signal });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as T;
}

const chipClass = (active: boolean) =>
  "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-(length:--jeju-text-sm) font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--jeju-primary) " +
  (active ? "border-transparent bg-(--jeju-primary) text-(--jeju-on-fill) shadow-sm" : "border-border bg-card text-(--jeju-text-body) hover:border-(--jeju-primary) hover:text-(--jeju-primary)");

export function PressBrowser() {
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [regionDraft, setRegionDraft] = useState({ sido: "", sigungu: "", includeDescendants: false });
  const [result, setResult] = useState<{ readonly path: string; readonly page: PressPage | null }>({ path: "", page: null });
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [regions, setRegions] = useState<PressRegions | null>(null);
  const [showAllOrganizations, setShowAllOrganizations] = useState(false);

  // 주소의 지역·기관 조건(지도·공유 링크)은 첫 그리기 뒤에 적용한다(대시보드와 같은 방식).
  useEffect(() => {
    const initial = filtersFromLocation(window.location.search);
    const frame = window.requestAnimationFrame(() => {
      if (!initial) return;
      setApplied(initial);
      if (initial.q) setQuery(initial.q);
      setRegionDraft({ sido: initial.sido, sigungu: initial.sigungu, includeDescendants: initial.includeDescendants });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    for (const [key, param] of URL_KEYS) if (applied[key]) params.set(param, applied[key]);
    if (applied.sigungu && applied.includeDescendants) params.set("include_descendants", "1");
    const search = params.toString();
    window.history.replaceState(window.history.state, "", search ? `?${search}` : window.location.pathname);
  }, [applied]);

  useEffect(() => {
    const controller = new AbortController();
    getJson<PressRegions>("/api/press/regions", controller.signal).then(setRegions).catch(() => undefined);
    getJson<Coverage>("/api/press/status?view=public", controller.signal).then(setCoverage).catch(() => undefined);
    return () => controller.abort();
  }, []);
  const path = requestPath(applied);

  useEffect(() => {
    const controller = new AbortController();
    getJson<PressPage>(path, controller.signal)
      .then((page) => setResult({ path, page }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({ path, page: null });
        usageError("press_list", usageErrorCode(error));
      });
    return () => controller.abort();
  }, [path]);

  const loading = result.path !== path;
  const page = loading ? null : result.page;
  const totalPages = page ? Math.max(1, Math.ceil(page.total_count / applied.size)) : 1;
  const firstShown = page && page.total_count ? (applied.page - 1) * applied.size + 1 : 0;
  const lastShown = page ? Math.min(page.total_count, applied.page * applied.size) : 0;
  /** 조건을 바꾸면 1쪽부터(쪽 이동만 쪽 번호를 유지). */
  const apply = (next: Partial<Filters>) => {
    // 이용자가 고른 분야·기관 유형·지역만 이용통계로 센다(주소로 들어온 첫 조건은 세지 않는다).
    if (next.category) usageFilter("news_category", next.category);
    if (next.organizationType) usageFilter("news_org_type", next.organizationType);
    if (next.sido) usageFilter("news_region", next.sido);
    setApplied((current) => ({ ...current, ...next, page: next.page ?? 1 }));
  };
  useSearchUsage({
    scope: "press_news",
    keyword: applied.q,
    conditions: [applied.category, applied.organizationType, applied.organizationId, applied.sido, applied.sigungu, applied.period, applied.from, applied.to].join("|"),
    settled: !loading,
    failed: !loading && result.page === null,
    count: page?.total_count ?? 0,
    match: null,
  });
  const toggle = (key: "category" | "organizationId" | "organizationType", value: string) => apply({ [key]: applied[key] === value ? "" : value });

  const regionStatistics = buildRegionStatisticsFromCounts(regions?.by_sido ?? {});
  const regionMaximum = Math.max(0, ...regionStatistics.map((region) => region.count));
  const draftAliases = regionDraft.sido ? regionAliases(regionDraft.sido) : [];
  const sigunguCounts = new Map<string, number>();
  for (const area of regions?.areas ?? []) {
    if (!draftAliases.includes(area.sido)) continue;
    sigunguCounts.set(area.sigungu, (sigunguCounts.get(area.sigungu) ?? 0) + area.count);
    const parent = area.sigungu.split(" ")[0];
    if (parent !== area.sigungu && !sigunguCounts.has(parent)) sigunguCounts.set(parent, 0);
  }
  if (regionDraft.sigungu && !sigunguCounts.has(regionDraft.sigungu)) sigunguCounts.set(regionDraft.sigungu, 0);
  const sigungus = [...sigunguCounts.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko"));
  const selectSidoFromMap = (sido: string) => {
    const next = { sido: applied.sido === sido ? "" : sido, sigungu: "", includeDescendants: false };
    setRegionDraft(next);
    apply(next);
  };

  // 발행기관: 보도자료가 많은 순. 기관 유형·시·도를 고르면 그 안의 기관만.
  const appliedAliases = applied.sido ? regionAliases(applied.sido) : [];
  const organizations = (regions?.by_organization ?? []).filter((organization) =>
    (!applied.organizationType || organization.organization_type === applied.organizationType) && (!applied.sido || appliedAliases.includes(organization.sido)));
  const shownOrganizations = showAllOrganizations ? organizations : organizations.slice(0, ORGANIZATIONS_SHOWN);
  const organizationName = (id: string) => regions?.by_organization?.find((organization) => organization.organization_id === id)?.name ?? coverage?.sources.find((source) => source.organization_id === id)?.organization_name ?? id;

  const activeFilters: { readonly label: string; readonly clear: Partial<Filters> }[] = [
    ...(applied.q ? [{ label: "검색어: " + applied.q, clear: { q: "" } }] : []),
    ...(applied.targetGroup && targetGroupOf(applied.targetGroup) ? [{ label: "대상자: " + targetGroupOf(applied.targetGroup)?.label + "(제목에 「" + targetGroupOf(applied.targetGroup)?.keywords.join("」「") + "」 중 하나)", clear: { targetGroup: "" } }] : []),
    ...(applied.organizationType ? [{ label: "기관 유형: " + (ORG_TYPE_LABELS[applied.organizationType] ?? applied.organizationType), clear: { organizationType: "" } }] : []),
    ...(applied.organizationId ? [{ label: "발행기관: " + organizationName(applied.organizationId), clear: { organizationId: "" } }] : []),
    ...(applied.sido ? [{ label: "지역: " + [applied.sido, applied.sigungu].filter(Boolean).join(" ") + (applied.includeDescendants ? "(하위 포함)" : ""), clear: { sido: "", sigungu: "", includeDescendants: false } }] : []),
    ...(applied.period ? [{ label: "기간: " + (PRESS_PERIODS.find((period) => period.value === applied.period)?.label ?? applied.period), clear: { period: "", from: "", to: "" } }] : []),
  ];
  const resetAll = () => { setQuery(""); setRegionDraft({ sido: "", sigungu: "", includeDescendants: false }); setApplied({ ...EMPTY, size: applied.size, sort: applied.sort }); };

  const pager = (position: "top" | "bottom") => page && page.total_count > applied.size ? (
    <nav className="flex flex-wrap items-center gap-1" aria-label={position === "top" ? "쪽 이동(위)" : "쪽 이동(아래)"}>
      <Button size="sm" variant="outline" disabled={applied.page <= 1} onClick={() => apply({ page: applied.page - 1 })}>‹ 이전</Button>
      {pageNumbers(applied.page, totalPages).map((entry, index) => entry === "gap"
        ? <span key={"gap" + index} className="px-1 text-muted-foreground" aria-hidden="true">…</span>
        : <Button key={entry} size="sm" variant={entry === applied.page ? "default" : "outline"} aria-current={entry === applied.page ? "page" : undefined} onClick={() => apply({ page: entry })} className="min-w-9 tabular-nums">{entry}</Button>)}
      <Button size="sm" variant="outline" disabled={applied.page >= totalPages} onClick={() => apply({ page: applied.page + 1 })}>다음 ›</Button>
    </nav>
  ) : null;

  return (
    <main className="mx-auto grid max-w-(--jeju-main-max-wide) gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="space-y-5 lg:self-start" aria-label="보도자료 조건">
        <div>
          <h1 className="text-(length:--jeju-h2-size) leading-(--jeju-leading-tight) font-extrabold text-(--jeju-text-strong)">전국 복지뉴스 아카이빙</h1>
          <p className="mt-1.5 text-(length:--jeju-text-sm) leading-relaxed text-muted-foreground">공식 보도자료로 발표된 복지 소식의 제목·발행기관·게시일과 원문 링크입니다. 본문은 저장하지 않으니 자세한 내용은 원문에서 확인하세요.</p>
        </div>

        <div className="rounded-2xl border border-(--jeju-green-light-strong) bg-(--jeju-secondary-tint) px-5 py-4">
          <p className="flex items-baseline gap-2">
            <span className="text-[2rem] leading-none font-black tabular-nums text-[#009f74]">{coverage ? (coverage.items.display_total ?? coverage.items.public_total).toLocaleString("ko-KR") : "…"}</span>
            <span className="text-(length:--jeju-text-sm) font-bold text-(--jeju-green-dark)">공개 보도자료 (누적)</span>
          </p>
          {coverage ? (
            <p className="mt-2 text-(length:--jeju-text-xs) text-(--jeju-text-body)">
              <span className="whitespace-nowrap">최근 24시간 새로 <b className="text-(--jeju-text-strong)">{coverage.items.discovered_24h.toLocaleString("ko-KR")}건</b></span> · <span className="whitespace-nowrap">최근 게시 <b className="text-(--jeju-text-strong) tabular-nums">{coverage.items.latest_published_date || "없음"}</b></span>
            </p>
          ) : null}
        </div>

        <form role="search" aria-label="보도자료 제목 검색" className="relative" onSubmit={(event) => { event.preventDefault(); apply({ q: query.trim() }); }}>
          <Label htmlFor="press-q" className="sr-only">제목 검색</Label>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input id="press-q" type="search" className="h-11 rounded-full pr-16 pl-10" placeholder="제목 검색 (예: 통합돌봄)" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} />
          <Button type="submit" size="sm" className="absolute inset-y-0 right-1.5 my-auto rounded-full active:translate-y-0!">검색</Button>
        </form>

        <section aria-labelledby="press-org-type-heading">
          <h2 id="press-org-type-heading" className="mb-2 text-(length:--jeju-text-sm) font-extrabold text-(--jeju-text-strong)">기관 유형</h2>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={chipClass(!applied.organizationType)} aria-pressed={!applied.organizationType} onClick={() => apply({ organizationType: "" })}>전체</button>
            {Object.entries(ORG_TYPE_LABELS).filter(([code]) => (regions?.by_organization_type?.[code] ?? 0) > 0 || applied.organizationType === code).map(([code, label]) => (
              <button key={code} type="button" className={chipClass(applied.organizationType === code)} aria-pressed={applied.organizationType === code} onClick={() => toggle("organizationType", code)}>
                {label}<span className="text-(length:--jeju-text-xs) opacity-75 tabular-nums">{regions?.by_organization_type?.[code]?.toLocaleString("ko-KR")}</span>
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="press-org-heading">
          <h2 id="press-org-heading" className="mb-2 text-(length:--jeju-text-sm) font-extrabold text-(--jeju-text-strong)">발행기관 <span className="font-normal text-muted-foreground">(보도자료 많은 순)</span></h2>
          {regions === null ? <p className="text-(length:--jeju-text-sm) text-muted-foreground">불러오는 중입니다.</p> : null}
          <ul className="grid gap-1">
            {shownOrganizations.map((organization, index) => {
              const active = applied.organizationId === organization.organization_id;
              return (
                <li key={organization.organization_id} className={!showAllOrganizations && index >= ORGANIZATIONS_SHOWN_MOBILE ? "max-lg:hidden" : undefined}>
                  <button type="button" aria-pressed={active} onClick={() => toggle("organizationId", organization.organization_id)}
                    className={"flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-(length:--jeju-text-sm) transition-colors " + (active ? "bg-(--jeju-primary-tint) font-bold text-(--jeju-primary-active)" : "text-(--jeju-text-body) hover:bg-muted")}>
                    <span className="min-w-0 truncate">{organization.name}{organization.sido && organization.organization_type !== "METROPOLITAN" ? <span className="ml-1 text-(length:--jeju-text-xs) text-muted-foreground">{organization.sido.replace(/특별자치도|특별자치시|광역시|특별시|통합특별시|도$/, "")}</span> : null}</span>
                    <span className="shrink-0 rounded-full bg-(--jeju-primary-tint) px-2 py-0.5 text-(length:--jeju-text-xs) font-bold tabular-nums text-(--jeju-primary)">{organization.count.toLocaleString("ko-KR")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {organizations.length > ORGANIZATIONS_SHOWN_MOBILE ? (
            <button type="button" className={(organizations.length > ORGANIZATIONS_SHOWN ? "" : "lg:hidden ") + "mt-1.5 w-full rounded-lg border border-dashed border-border py-2 text-(length:--jeju-text-sm) font-semibold text-(--jeju-text-body) hover:bg-muted"} aria-expanded={showAllOrganizations} onClick={() => setShowAllOrganizations(!showAllOrganizations)}>
              {showAllOrganizations ? "접기 ▲" : `기관 더 보기 (전체 ${organizations.length.toLocaleString("ko-KR")}곳) ▼`}
            </button>
          ) : null}
        </section>

        <details className="rounded-xl border border-border bg-card" open={Boolean(applied.sido)}>
          <summary className="cursor-pointer px-4 py-3 text-(length:--jeju-text-sm) font-extrabold text-(--jeju-text-strong)">지역으로 찾기</summary>
          <div className="grid gap-3 px-3 pb-3">
            <KoreaVectorMap
              fixedLayout
              statistics={regionStatistics}
              maximum={regionMaximum}
              selectedSido={applied.sido}
              disabled={regions === null}
              onSelect={selectSidoFromMap}
              measureLabel="보도자료 수"
              title="광역단위 공식 보도자료 지도"
              description="시·도를 고르면 그 지역 발행기관(본청·시군구)의 보도자료만 목록에 남습니다. 다시 누르면 선택이 풀립니다."
            />
            <div className="grid gap-1.5">
              <Label htmlFor="press-sido">시·도</Label>
              <NativeSelect id="press-sido" className="w-full" value={regionDraft.sido} onChange={(event) => setRegionDraft({ sido: event.target.value, sigungu: "", includeDescendants: false })}>
                <NativeSelectOption value="">전체</NativeSelectOption>
                {regionStatistics.map((region) => <NativeSelectOption key={region.id} value={region.dataValue}>{region.fullName} ({region.count})</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="press-sigungu">시·군·구</Label>
              <NativeSelect id="press-sigungu" className="w-full" value={regionDraft.sigungu} disabled={!regionDraft.sido} onChange={(event) => setRegionDraft({ ...regionDraft, sigungu: event.target.value })}>
                <NativeSelectOption value="">{regionDraft.sido ? "시·도 전체" : "시·도 먼저"}</NativeSelectOption>
                {sigungus.map(([name, count]) => <NativeSelectOption key={name} value={name}>{name} ({count})</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <label className="flex items-start gap-2 text-(length:--jeju-text-sm)">
              <input type="checkbox" className="mt-1 size-4 accent-(--jeju-primary)" checked={regionDraft.includeDescendants} disabled={!regionDraft.sigungu} onChange={(event) => setRegionDraft({ ...regionDraft, includeDescendants: event.target.checked })} />
              <span>하위 일반구·행정시 발행자료 포함 <span className="text-muted-foreground">(예: 고양시 → 덕양구)</span></span>
            </label>
            <p className="text-(length:--jeju-text-xs) text-muted-foreground">본문을 저장하지 않아 보도자료가 다루는 지역이 아니라 발행한 기관의 관할로 찾습니다.</p>
            <Button type="button" variant="outline" onClick={() => apply(regionDraft)}>이 지역으로 보기</Button>
          </div>
        </details>

        <details className="rounded-xl border border-border bg-card">
          <summary className="cursor-pointer px-4 py-3 text-(length:--jeju-text-sm) font-extrabold text-(--jeju-text-strong)">수집 현황</summary>
          <div className="px-1 pb-1"><CoveragePanel coverage={coverage} /></div>
        </details>
      </aside>

      <section aria-labelledby="press-results-heading" className="min-w-0">
        <h2 id="press-results-heading" className="sr-only">공식 보도자료 목록</h2>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&>button]:shrink-0" role="group" aria-label="분야">
          <button type="button" className={chipClass(!applied.category)} aria-pressed={!applied.category} onClick={() => apply({ category: "" })}>전체</button>
          {PRESS_CATEGORIES.map((category) => (
            <button key={category.code} type="button" className={chipClass(applied.category === category.code)} aria-pressed={applied.category === category.code} onClick={() => toggle("category", category.code)}>
              <span className="size-2 rounded-full" style={{ backgroundColor: applied.category === category.code ? "currentColor" : dotColor(category.code) }} aria-hidden="true" />
              {category.label}
              {regions?.by_category?.[category.code] ? <span className="text-(length:--jeju-text-xs) opacity-75 tabular-nums">{regions.by_category[category.code].toLocaleString("ko-KR")}</span> : null}
            </button>
          ))}
        </div>

        {activeFilters.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="적용한 조건">
            {activeFilters.map((filter) => (
              <button key={filter.label} type="button" onClick={() => { if ("q" in filter.clear) setQuery(""); if ("sido" in filter.clear) setRegionDraft({ sido: "", sigungu: "", includeDescendants: false }); apply(filter.clear); }}
                className="inline-flex items-center gap-1 rounded-full bg-(--jeju-primary-tint) px-3 py-1 text-(length:--jeju-text-xs) font-semibold text-(--jeju-primary-active) hover:bg-(--jeju-blue-light-strong)" aria-label={filter.label + " 조건 지우기"}>
                {filter.label}<span aria-hidden="true">×</span>
              </button>
            ))}
            <button type="button" onClick={resetAll} className="inline-flex items-center gap-1 px-2 text-(length:--jeju-text-xs) font-semibold text-muted-foreground hover:text-(--jeju-text-strong)"><RefreshIcon className="size-3.5" />모두 지우기</button>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-(length:--jeju-text-sm)">
            <Label htmlFor="press-size" className="text-muted-foreground">페이지당</Label>
            <NativeSelect id="press-size" size="sm" value={String(applied.size)} onChange={(event) => apply({ size: Number(event.target.value) })}>
              {PAGE_SIZES.map((size) => <NativeSelectOption key={size} value={String(size)}>{size}</NativeSelectOption>)}
            </NativeSelect>
            <span className="text-muted-foreground">개</span>
          </div>
          <p className="text-(length:--jeju-text-sm) text-(--jeju-text-body)" role="status">
            {page ? <>전체 <b className="text-(--jeju-text-strong) tabular-nums">{page.total_count.toLocaleString("ko-KR")}</b>건 중 <span className="tabular-nums">{firstShown.toLocaleString("ko-KR")}–{lastShown.toLocaleString("ko-KR")}</span></> : "불러오는 중"}
          </p>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-(length:--jeju-text-sm)">
            <PressPeriodControls selection={applied} onChange={apply} />
            <Label htmlFor="press-sort" className="text-muted-foreground">정렬</Label>
            <NativeSelect id="press-sort" size="sm" value={applied.sort} onChange={(event) => apply({ sort: event.target.value === "oldest" ? "oldest" : "newest" })}>
              <NativeSelectOption value="newest">최신순</NativeSelectOption>
              <NativeSelectOption value="oldest">오래된순</NativeSelectOption>
            </NativeSelect>
          </div>
        </div>
        {page && page.total_count > applied.size ? <div className="mt-3 flex justify-center">{pager("top")}</div> : null}

        {loading ? <p className="mt-4 flex items-center gap-2 text-(length:--jeju-text-sm) text-muted-foreground"><Spinner label="목록을 불러오는 중" />목록을 불러오는 중입니다.</p> : null}
        {!loading && !page ? <p role="alert" className="mt-4 text-(length:--jeju-text-sm) text-(--jeju-danger)">목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.</p> : null}
        {page && page.items.length === 0 ? <EmptyMessage coverage={coverage} /> : null}
        {page && page.items.length > 0 ? (
          <ul className="mt-3 grid gap-2.5">
            {page.items.map((item) => (
              <li key={item.article_id} className="rounded-2xl border border-border bg-card px-5 py-4 transition-shadow hover:border-(--jeju-blue-light-strong) hover:shadow-md">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-(length:--jeju-text-xs) text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><BuildingIcon className="size-3.5" />
                    <button type="button" className="font-semibold text-(--jeju-text-body) hover:text-(--jeju-primary) hover:underline" onClick={() => apply({ organizationId: item.issued_by.organization_id })} aria-label={item.issued_by.name + " 보도자료만 보기"}>{item.issued_by.name}</button>
                    {item.issued_by.type ? <span>· {ORG_TYPE_LABELS[item.issued_by.type] ?? item.issued_by.type}</span> : null}
                    {upperRegion(item) ? <span>· {upperRegion(item)}</span> : null}
                  </span>
                  <span className="inline-flex items-center gap-1 tabular-nums"><CalendarIcon className="size-3.5" />{item.published_date ?? "게시일 미확인"}</span>
                  {item.category_ids.length ? (
                    <span className="inline-flex flex-wrap gap-1">
                      {item.category_ids.map((id) => <span key={id} className="rounded-full bg-(--jeju-control-bg) px-2 py-0.5 font-semibold text-(--jeju-text-body)">{CATEGORY_LABELS[id] ?? id}</span>)}
                    </span>
                  ) : null}
                </p>
                <a href={item.original_url} target="_blank" rel="noopener noreferrer" onClick={() => usageClick("news_original")} className="mt-1.5 flex items-start gap-2 text-(length:--jeju-text-md) leading-snug font-bold text-(--jeju-text-strong) underline-offset-4 hover:text-primary hover:underline">
                  <span className="mt-[0.45em] size-2 shrink-0 rounded-full" style={{ backgroundColor: dotColor(item.category_ids[0]) }} aria-hidden="true" />
                  <span>{item.title}</span>
                  <ExternalLinkIcon className="mt-1 shrink-0 text-muted-foreground" />
                  <span className="sr-only">(새 창)</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {page && page.total_count > applied.size ? <div className="mt-4 flex justify-center">{pager("bottom")}</div> : null}
      </section>
    </main>
  );
}

function EmptyMessage({ coverage }: { readonly coverage: Coverage | null }) {
  const noSource = coverage !== null && coverage.coverage.approved_active_sources === 0;
  return (
    <p className="mt-4 rounded-xl border border-dashed border-border bg-(--jeju-surface-inset) p-4 text-(length:--jeju-text-sm) text-muted-foreground">
      {noSource ? "공개 승인된 보도자료 수집처가 아직 없습니다. 관리자가 수집처를 승인하면 이곳에 표시됩니다." : "조건에 맞는 보도자료가 없습니다. 조건을 바꾸어 다시 찾아 주세요."}
    </p>
  );
}

function CoveragePanel({ coverage }: { readonly coverage: Coverage | null }) {
  if (!coverage) return null;
  return (
    <section aria-labelledby="press-coverage-heading" className="rounded-xl border border-border bg-card p-4 text-(length:--jeju-text-sm)">
      <h2 id="press-coverage-heading" className="font-extrabold text-(--jeju-text-strong)">수집 현황</h2>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">대상 기관(시드)</dt><dd className="font-bold">{coverage.targets.organizations.toLocaleString("ko-KR")}곳</dd>
        <dt className="text-muted-foreground">최근 24시간 정상 수집 기관</dt><dd className="font-bold">{coverage.coverage.normal_organizations_24h}곳</dd>
        <dt className="text-muted-foreground">공개 중인 보도자료(중복 제외)</dt><dd className="font-bold">{(coverage.items.display_total ?? coverage.items.public_total).toLocaleString("ko-KR")}건</dd>
        <dt className="text-muted-foreground">최근 24시간 새로 발견</dt><dd className="font-bold">{coverage.items.discovered_24h}건</dd>
        <dt className="text-muted-foreground">가장 최근 게시일</dt><dd className="font-bold">{coverage.items.latest_published_date || "없음"}</dd>
      </dl>
      {coverage.survey && Object.keys(coverage.survey.by_category).length ? (
        <>
          <h3 className="mt-3 font-bold text-(--jeju-text-strong)">기관별 게시판 조사</h3>
          <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
            {Object.entries(coverage.survey.categories).filter(([key]) => coverage.survey?.by_category[key]).map(([key, label]) => (
              <div key={key} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="font-bold">{coverage.survey?.by_category[key]}곳</dd></div>
            ))}
          </dl>
          <p className="mt-1 text-(length:--jeju-text-xs) text-muted-foreground">게시판을 확인한 기관 수이며 수집 성공률이 아닙니다. 확인된 게시판도 운영자가 이용조건을 승인해야 수집합니다.</p>
        </>
      ) : null}
      <p className="mt-3 text-(length:--jeju-text-xs) leading-relaxed text-muted-foreground">
        운영자가 이용조건을 확인해 승인한 기관의 보도자료만 보여 줍니다(현재 {coverage.sources.filter((source) => source.approval_status === "POLICY_APPROVED").length}곳). 시·도와 시·군·구 기관은 공식 게시판 주소·robots.txt·이용조건을 확인하는 대로 추가합니다. {coverage.schedule.note}
      </p>
    </section>
  );
}
