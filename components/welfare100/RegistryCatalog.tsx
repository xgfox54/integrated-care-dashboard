"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { prefersDataSaving } from "@/lib/network-preferences";
import { trackEvent } from "@/lib/welfare100/client-events";
import { loadCatalog, loadFullCatalog, type CatalogEntry } from "@/lib/welfare100/payload";
import { watchVisitorRegion, type VisitorRegion } from "@/lib/visitor-location";
import CompareTray from "./CompareTray";
import styles from "./RegistryCatalog.module.css";

// Adapted from hosungseo/korea100 RegistryCatalog (MIT License).

interface RegistryCatalogProps {
  categoryOrder: string[];
  lifecycleOrder: string[];
  householdOrder: string[];
}

type SortMode = "priority" | "name";
type Scope = "전체" | "주요 제도" | "중앙부처" | "지자체";

const PAGE_SIZE = 30;
const MAX_COMPARE = 3;
const ALL = "전체";
const ALL_TYPES = "전체 제공유형";
const ALL_SIDO = "전체 시도";
const ALL_SIGUNGU = "시도 전체";
const SCOPES: Scope[] = ["전체", "주요 제도", "중앙부처", "지자체"];
const SCOPE_COLORS: Record<Scope, string> = { 전체: "#5d6b63", "주요 제도": "#0f9f72", 중앙부처: "#315a78", 지자체: "#b45309" };

export const TOPIC_COLORS: Record<string, string> = {
  생활지원: "#0f9f72",
  신체건강: "#2563eb",
  정신건강: "#7c3aed",
  주거: "#8a5a2b",
  일자리: "#b45309",
  "문화·여가": "#db2777",
  "안전·위기": "#be123c",
  "임신·출산": "#e11d48",
  보육: "#ea580c",
  교육: "#0891b2",
  "입양·위탁": "#9333ea",
  "보호·돌봄": "#b54b7b",
  서민금융: "#315a78",
  법률: "#4b5563",
  에너지: "#ca8a04",
};

const LIFECYCLE_COLORS = ["#e11d48", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#2563eb", "#7c3aed"];
const HOUSEHOLD_COLORS = ["#0f9f72", "#2563eb", "#b54b7b", "#ea580c", "#9333ea", "#4b5563"];

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

function matches(entry: CatalogEntry, filters: Filters, tokens: string[], skip?: FacetKey): boolean {
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
  return tokens.every((token) => entry.searchText.includes(token));
}

function countFacet(entries: CatalogEntry[], filters: Filters, tokens: string[], skip: FacetKey, keyOf: (entry: CatalogEntry) => string[]) {
  const counts = new Map<string, number>();
  let total = 0;
  for (const entry of entries) {
    if (!matches(entry, filters, tokens, skip)) continue;
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
    loadCatalog()
      .then((catalog) => {
        if (!alive) return;
        // 전체 색인이 먼저 도착했으면 그대로 둔다.
        setEntries((current) => current ?? catalog.entries);
        setAsOf(catalog.asOf);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : "복지제도 목록을 불러오지 못했습니다.");
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

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
  const [sort, setSort] = useState<SortMode>(() => (searchParams.get("sort") === "name" ? "name" : "priority"));
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
    // 모바일은 위치 동의 후 GPS, 동의하지 않거나 실패하면 접속 IP로 지역을 확인한다.
    return watchVisitorRegion((update) => {
      if (update.status === "resolved" && update.region) setVisitorRegion(update.region);
    });
  }, [searchParams]);

  function update(patch: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setVisibleCount(PAGE_SIZE);
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
    updateUrlParam(url, "sort", sort === "priority" ? "" : sort);
    updateUrlParam(url, "compare", selectedSlugs.join(","));
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [filters, selectedSlugs, sort]);

  const list = useMemo(() => entries ?? [], [entries]);
  const bySlug = useMemo(() => new Map(list.map((entry) => [entry.slug, entry])), [list]);
  const tokens = useMemo(() => filters.query.trim().toLocaleLowerCase("ko").split(/\s+/).filter(Boolean), [filters.query]);

  const regions = useMemo(() => {
    const sidoCounts = new Map<string, number>();
    const sigunguBySido = new Map<string, Map<string, number>>();
    for (const entry of list) {
      if (entry.org !== "지자체" || !entry.sido) continue;
      sidoCounts.set(entry.sido, (sidoCounts.get(entry.sido) ?? 0) + 1);
      if (entry.sigungu) {
        const map = sigunguBySido.get(entry.sido) ?? new Map<string, number>();
        map.set(entry.sigungu, (map.get(entry.sigungu) ?? 0) + 1);
        sigunguBySido.set(entry.sido, map);
      }
    }
    const byName = (a: [string, number], b: [string, number]) => a[0].localeCompare(b[0], "ko");
    return {
      sidos: [...sidoCounts].sort(byName),
      sigungus: (sido: string) => [...(sigunguBySido.get(sido) ?? new Map<string, number>())].sort(byName),
    };
  }, [list]);
  const provisions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of list) for (const value of entry.provision) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([value]) => value);
  }, [list]);

  const facets = useMemo(
    () => ({
      scope: countFacet(list, filters, tokens, "scope", (entry) => [entry.org, ...(entry.curated ? ["주요 제도"] : [])]),
      category: countFacet(list, filters, tokens, "category", (entry) => entry.topics),
      lifecycle: countFacet(list, filters, tokens, "lifecycle", (entry) => entry.lifecycle),
      household: countFacet(list, filters, tokens, "household", (entry) => entry.household),
    }),
    [filters, list, tokens],
  );

  const filtered = useMemo(
    () =>
      list
        .filter((entry) => matches(entry, filters, tokens))
        .sort((left, right) => {
          if (sort === "name") return left.name.localeCompare(right.name, "ko");
          if (filters.sido !== ALL_SIDO && left.org !== right.org) return left.org === "지자체" ? -1 : 1;
          return left.priority - right.priority;
        }),
    [filters, list, sort, tokens],
  );

  const visible = filtered.slice(0, visibleCount);
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
    <section id="institutions" className={styles.registry}>
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
              const color = category === ALL ? "#0b1410" : TOPIC_COLORS[category] ?? "#5d6b63";
              return (
                <button
                  key={category}
                  type="button"
                  className={styles.railItem}
                  aria-pressed={active}
                  style={{ "--category-color": color } as CSSProperties}
                  onClick={() => update({ category })}
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
                onClick={() => update({ scope })}
              />
            ))}
          </fieldset>

          <div className={styles.regionFilter}>
            <span>지역 (지자체 서비스)</span>
            <select
              aria-label="시도 선택"
              value={filters.sido}
              onChange={(event) => update({ sido: event.target.value, sigungu: ALL_SIGUNGU })}
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
              onChange={(event) => update({ sigungu: event.target.value })}
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
              <button type="button" className={styles.visitorRegion} onClick={() => update({ sido: visitorSido, sigungu: ALL_SIGUNGU })}>
                {visitorRegion?.source === "gps" ? "내 위치(GPS)" : "접속 지역"} {visitorSido} 서비스 보기
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
                color={value === ALL ? "#5d6b63" : LIFECYCLE_COLORS[(index - 1) % LIFECYCLE_COLORS.length]}
                onClick={() => update({ lifecycle: value })}
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
                color={value === ALL ? "#5d6b63" : HOUSEHOLD_COLORS[(index - 1) % HOUSEHOLD_COLORS.length]}
                onClick={() => update({ household: value })}
              />
            ))}
          </fieldset>

          <label className={styles.typeFilter}>
            <span>제공유형</span>
            <select value={filters.provision} onChange={(event) => update({ provision: event.target.value })}>
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
              <button type="button" aria-pressed={sort === "priority"} onClick={() => setSort("priority")}>
                기본순
              </button>
              <button type="button" aria-pressed={sort === "name"} onClick={() => setSort("name")}>
                가나다
              </button>
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

      <CompareTray selected={selected} onRemove={(slug) => toggleCompare(slug)} />
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
}: {
  entry: CatalogEntry;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const categoryColor = TOPIC_COLORS[entry.category] ?? "#5d6b63";
  return (
    <tr style={{ "--category-color": categoryColor } as CSSProperties}>
      <td className={styles.numberCell}>{entry.priority.toString().padStart(2, "0")}</td>
      <td className={styles.nameCell}>
        <a href={"/welfare100/" + entry.slug}>
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
}: {
  entry: CatalogEntry;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const tone = entry.curated ? "verified" : entry.sourceCount > 0 ? "linked" : "review";
  return (
    <article>
      <span className={styles.mobileNumber}>{entry.priority.toString().padStart(2, "0")}</span>
      <a href={"/welfare100/" + entry.slug}>
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
