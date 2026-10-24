"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { KoreaVectorMap } from "@/components/dashboard/korea-vector-map";
import { RegionSelector } from "@/components/dashboard/region-selector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshIcon, SearchIcon } from "@/components/ui/jeju-icons";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { buildRegionStatisticsFromCounts, REGION_DEFINITIONS, type RegionId } from "@/lib/region-statistics";
import { usageClick, usageError, usageErrorCode, usageFilter } from "@/lib/usage/track";
import { useSearchUsage } from "@/lib/usage/use-search-usage";
import { parseTargetGroup, targetGroupOf } from "@/lib/target-groups";
import { budgetPartOf, type BudgetPart } from "@/lib/fiscal/parts";
import { prefersDataSaving } from "@/lib/network-preferences";
import { scheduleBudgetPrefetch } from "./budget-prefetch";

// 예산서 상세내역(BudgetDocumentsPanel)은 2026-10-09 운영자 요청으로 화면에서 숨김. 반입 자료·API·컴포넌트는 보관한다.
import { budgetDepartmentLabel, budgetDepartmentName, formatBudgetLocalTitle } from "./budget-departments";
import { formatJoEok } from "./budget-format";
import { budgetFiltersPath, budgetNationalPath, budgetResultPath, EMPTY_BUDGET_FILTERS, type BudgetFilters } from "./budget-paths";

import { budgetDepartmentValue, selectBudgetDepartment, type BudgetDepartment } from "./budget-selection";
import { BudgetSourceNote } from "./budget-source-note";

export { formatJoEok };

interface BudgetItem {
  readonly fiscal_project_id: string;
  readonly name: string;
  readonly fiscal_entity: { readonly name: string; readonly region_name: string };
  readonly department_code: string;
  readonly fiscal_year: string;
  readonly reference_date: string;
  readonly account: { readonly code: string; readonly name: string };
  readonly source_project_code: string;
  /** 통합돌봄 분류 근거(통합돌봄 WIKI 사업명 일치 또는 세부사업명 「통합돌봄」 포함). */
  readonly integrated_care?: { readonly basis: string; readonly wiki_service_name: string | null } | null;
  readonly classification: { readonly field_name: string; readonly part_name: string };
  readonly current_budget_krw: string | null;
  readonly public_expenditure_krw: string | null;
  readonly unspent_difference_krw: string | null;
  readonly execution_rate_pct: string | null;
  readonly execution_rate_null_reason: string | null;
}
interface BudgetSummary {
  readonly matching_rows: number;
  readonly included_rows: number;
  readonly excluded_rows: number;
  readonly fiscal_entities: number;
  readonly current_budget_krw: string | null;
  readonly public_expenditure_krw: string | null;
  readonly unspent_difference_krw: string | null;
  readonly execution_rate_pct: string | null;
}
interface RegionBudget {
  readonly code: string;
  readonly name: string;
  readonly projects: number;
  readonly fiscal_entities: number;
  readonly current_budget_krw: string | null;
  readonly public_expenditure_krw: string | null;
  readonly execution_rate_pct: string | null;
}
interface BudgetData {
  readonly mode: string;
  readonly modes: readonly { readonly id: string; readonly label: string; readonly available: boolean }[];
  readonly notes: readonly string[];
  readonly snapshot: null | {
    readonly scope_label: string;
    readonly classification_basis: string;
    readonly fiscal_year: string;
    readonly requested_reference_date: string;
    readonly effective_reference_date: string | null;
    readonly reference_date_note: string;
    readonly access_tier: string;
    readonly expected_count: number;
    readonly complete: boolean;
  };
  readonly unavailable: null | { readonly code: string; readonly message: string };
  readonly requested_reference_date: string | null;
  readonly fallback_used: boolean;
  readonly summary: BudgetSummary | null;
  readonly regions_summary?: readonly RegionBudget[];
  readonly snapshot_set?: readonly { readonly scope_label: string; readonly requested_reference_date: string; readonly complete: boolean; readonly expected_count: number }[];
  readonly items: readonly BudgetItem[];
  readonly total: number;
  readonly size: number;
}
interface FilterOptions {
  readonly regions: readonly { readonly code: string; readonly name: string }[];
  readonly entities?: readonly { readonly id: string; readonly name: string; readonly region_code: string; readonly kind: "local_government" | "admin_unit"; readonly project_count: number; readonly parent_entity_id?: string | null }[];
  readonly known_local_governments?: number;
  readonly published_local_governments?: number;
  readonly departments: readonly BudgetDepartment[];
  readonly accounts: readonly { readonly code: string; readonly name: string }[];
  /** 고른 지역·기관·부서에 사업이 있는 세부 예산분야(지방재정365 부문)만. */
  readonly parts?: readonly (BudgetPart & { readonly project_count: number })[];
}
type Filters = BudgetFilters;
const EMPTY = EMPTY_BUDGET_FILTERS;
// 통합돌봄은 예산서에 없는 분류를 세부사업명으로 만든 것이라 정확하지 않아 화면에서 고르지 않는다(2026-10-06 운영자 지시).
const HIDDEN_MODES: ReadonlySet<string> = new Set(["department", "integrated_care"]);

/**
 * 받은 응답을 이 화면에 머무는 동안 기억한다(모드 전환·쪽 이동·미리 받기). 서버는 매번 공개 상태를 확인하므로
 * 승인 해제가 늦게 보이지 않도록 5분만 다시 쓴다. 같은 주소를 동시에 부르면 요청 하나를 함께 기다린다.
 */
const RESPONSE_TTL_MS = 5 * 60_000;
const RESPONSE_LIMIT = 60;
interface ResponseEntry { readonly at: number; readonly promise: Promise<unknown>; value?: unknown }
const responses = new Map<string, ResponseEntry>();

function loadJson<T>(path: string): Promise<T> {
  const hit = responses.get(path);
  if (hit && Date.now() - hit.at < RESPONSE_TTL_MS) return hit.promise as Promise<T>;
  const entry: { at: number; promise: Promise<unknown>; value?: unknown } = { at: Date.now(), promise: Promise.resolve() };
  entry.promise = fetch(path, { mode: "cors", credentials: "same-origin" }).then(async (response) => {
    if (!response.ok) throw new Error(String(response.status));
    const value: unknown = await response.json();
    entry.value = value;
    return value;
  });
  entry.promise.catch(() => { if (responses.get(path) === entry) responses.delete(path); });
  responses.delete(path);
  responses.set(path, entry);
  for (const key of responses.keys()) {
    if (responses.size <= RESPONSE_LIMIT) break;
    responses.delete(key);
  }
  return entry.promise as Promise<T>;
}

function readyValue<T>(path: string): T | undefined {
  const hit = responses.get(path);
  return hit && Date.now() - hit.at < RESPONSE_TTL_MS ? (hit.value as T | undefined) : undefined;
}

/** 주소의 응답. 이미 받아 둔 응답이면 기다림 없이 바로 쓰고, 새 응답이 올 때까지 직전 응답(last)을 남겨 화면이 비지 않게 한다. */
function useBudgetJson<T>(path: string): { readonly data: T | null; readonly loading: boolean; readonly last: T | null } {
  const [result, setResult] = useState<{ readonly path: string; readonly data: T | null }>({ path: "", data: null });
  useEffect(() => {
    let live = true;
    loadJson<T>(path).then((data) => { if (live) setResult({ path, data }); }, (error: unknown) => {
      if (!live) return;
      setResult({ path, data: null });
      usageError("budget_list", usageErrorCode(error));
    });
    return () => { live = false; };
  }, [path]);
  const ready = result.path === path ? undefined : readyValue<T>(path);
  const current = result.path === path ? result.data : ready ?? null;
  const loading = result.path !== path && ready === undefined;
  return { data: loading ? null : current, loading, last: loading ? result.data : current };
}
/** 전국 지방자치단체 수(광역 17·기초 226). */
const LOCAL_GOVERNMENTS = 243;
type Unit = "won" | "million";
const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");
/** 상위 5개 지역의 색 순서: 대시보드 지도와 같은 파랑·초록·주황·파랑·초록. */
const RANK_SERIES = [1, 2, 3, 1, 2] as const;

/** 10진 문자열 금액에 자릿수 쉼표. 백만원 표시는 화면용 반올림(원 단위 자료는 그대로)이다. */
export function formatAmount(value: string | null, unit: Unit): string {
  if (value === null) return "확인 불가";
  let digits = value;
  if (unit === "million") {
    const amount = BigInt(value);
    const negative = amount < BigInt(0);
    const absolute = negative ? -amount : amount;
    const rounded = (absolute + BigInt(500_000)) / BigInt(1_000_000);
    digits = (negative ? "-" : "") + rounded.toString();
  }
  const negative = digits.startsWith("-");
  const body = (negative ? digits.slice(1) : digits).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (negative ? "-" : "") + body + (unit === "million" ? "백만원" : "원");
}

/** 원천 지역 이름(서울·전남광주 등)을 지도 광역단위로 맞춘다. 옛 광주·전남 코드는 통합 지역으로 모은다. */
function regionIdOf(name: string): RegionId | null {
  const plain = name.replace(/[·\s]/g, "");
  if (plain === "광주" || plain === "전남") return "jeonnam_gwangju";
  const found = REGION_DEFINITIONS.find((region) => region.shortLabel.replace(/[·\s]/g, "") === plain || region.fullName === name || (region.aliases as readonly string[]).includes(name));
  return found?.id ?? null;
}

/** 화면 표시용 백분율(반올림은 toFixed에서). 집행률은 서버 계산과 같게 소수 둘째 자리 반올림이다. */
const percent = (part: bigint, whole: bigint) => (whole > BigInt(0) ? (Number(part) / Number(whole)) * 100 : 0);

function KpiCard({ label, value, note, title, pending = false }: { readonly label: string; readonly value: string; readonly note?: string; readonly title?: string; readonly pending?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5" title={pending ? undefined : title} aria-busy={pending}>
      <p className="text-(length:--jeju-text-sm) font-bold text-muted-foreground">{label}</p>
      {pending ? <span aria-hidden="true" className="mt-2 block h-[1.1em] w-3/5 animate-pulse rounded-md bg-(--jeju-control-bg) text-(length:--jeju-kpi-size)" /> : <p className="mt-1.5 whitespace-nowrap text-(length:--jeju-kpi-size) leading-[1.1] font-extrabold tabular-nums text-(--jeju-text-strong)">{value}</p>}
      {note ? <p className="mt-1 text-(length:--jeju-text-xs) text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export function BudgetBrowser() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [unit, setUnit] = useState<Unit>("won");
  // 관계성 지도·공유 주소에서 넘어온 조건(분야·지역·기관·검색어)은 첫 그리기 뒤에 적용한다(복지뉴스와 같은 방식).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode") ?? "";
    const part = budgetPartOf(params.get("part") ?? "");
    const next: Filters = {
      ...EMPTY,
      ...(["social_welfare", "health"].includes(mode) ? { mode } : {}),
      ...(part ? { mode: part.mode, part: part.code } : {}),
      region: (params.get("region") ?? "").trim().slice(0, 20),
      entity: (params.get("entity") ?? "").trim().slice(0, 40),
      department: (params.get("department") ?? "").trim().slice(0, 40),
      account: (params.get("account") ?? "").trim().slice(0, 20),
      date: (params.get("date") ?? "").trim().slice(0, 10),
      q: (params.get("q") ?? "").trim().slice(0, 60),
      targetGroup: parseTargetGroup(params.get("target_group") ?? "") ?? "",
    };
    const page = Math.min(10000, Math.max(1, Math.trunc(Number(params.get("page")) || 1)));
    if (next.mode === EMPTY.mode && !next.part && !next.region && !next.entity && !next.department && !next.account && !next.date && !next.q && !next.targetGroup && page === 1) return;
    const frame = window.requestAnimationFrame(() => { setDraft(next); setApplied({ ...next, page }); });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  // 적용한 검색 조건을 주소에 남겨 다른 메뉴에 다녀오거나 새로고침해도 같은 결과로 돌아온다.
  useEffect(() => {
    const params = new URLSearchParams();
    if (applied.part) params.set("part", applied.part);
    else if (applied.mode !== EMPTY.mode) params.set("mode", applied.mode);
    for (const key of ["date", "region", "entity", "department", "account", "q"] as const) if (applied[key]) params.set(key, applied[key]);
    if (applied.targetGroup) params.set("target_group", applied.targetGroup);
    if (applied.page > 1) params.set("page", String(applied.page));
    const search = params.toString();
    const next = window.location.pathname + (search ? "?" + search : "") + window.location.hash;
    if (next !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(window.history.state, "", next);
  }, [applied]);
  // 나눠 받기: 합계·지도·목록(view=main)을 먼저 받아 보여 주고, 큰 조건 목록(view=filters)은 따로 받는다.
  const result = useBudgetJson<BudgetData>(budgetResultPath(applied));
  const options = useBudgetJson<{ readonly filters: FilterOptions }>(budgetFiltersPath(draft));
  const catalog = useBudgetJson<{ readonly filters: FilterOptions }>(budgetFiltersPath({ ...EMPTY, mode: draft.mode, date: draft.date }));
  const appliedOptions = useBudgetJson<{ readonly filters: FilterOptions }>(budgetFiltersPath(applied));
  const appliedFilters = appliedOptions.last?.filters;
  const kpi = useBudgetJson<BudgetData>(budgetResultPath({ ...applied, page: 1 }));
  const kpiSummary = kpi.last?.summary ?? null;
  const national = useBudgetJson<BudgetData>(budgetNationalPath(applied));
  const nationalSummary = national.last?.summary ?? null;
  const filters = options.last?.filters;
  const regions = catalog.last?.filters.regions ?? [];
  const catalogFilters = catalog.last?.filters;
  const choices = useMemo(() => {
    const entities = (catalogFilters?.entities ?? []).filter((entity) => !draft.region || entity.region_code === draft.region);
    const ownedEntityIds = new Set([draft.entity, ...entities.filter((entity) => entity.parent_entity_id === draft.entity).map((entity) => entity.id)]);
    const departments = (catalogFilters?.departments ?? []).filter((department) =>
      (!draft.region || department.region_code === draft.region) && (!draft.entity || ownedEntityIds.has(department.entity_id)));
    return { entities, departments };
  }, [catalogFilters, draft.region, draft.entity]);
  const resultLoading = result.loading || kpi.loading || national.loading;
  const optionsLoading = options.loading || catalog.loading || appliedOptions.loading;
  const currentSettled = !resultLoading && !optionsLoading && Boolean(result.data && kpi.data && national.data && options.data && catalog.data && appliedOptions.data);
  const loading = result.loading;
  const data = result.data;
  // 지도·지표·결과표는 다음 응답이 올 때까지 직전 값을 유지해 화면이 비지 않게 한다.
  const shown = result.last;
  const listed = data ?? (loading ? shown : null);
  const totalPages = listed ? Math.min(10000, Math.max(1, Math.ceil(listed.total / listed.size))) : 1;

  // 지금 화면을 다 보여 준 뒤 쉬는 동안 다음 쪽과 다른 모드(1쪽)를 차례로 미리 받아 둔다. 누르면 기다리지 않고 바로 바뀐다.
  useEffect(() => {
    if (!data) return;
    const targets = [
      ...(data.total > data.size * applied.page ? [budgetResultPath({ ...applied, page: applied.page + 1 })] : []),
      ...data.modes.filter((mode) => mode.available && mode.id !== applied.mode && !HIDDEN_MODES.has(mode.id)).flatMap((mode) => [budgetResultPath({ ...applied, mode: mode.id, part: "", department: "", page: 1 }), budgetResultPath({ ...EMPTY, mode: mode.id, date: applied.date })]),
    ];
    return scheduleBudgetPrefetch({
      settled: currentSettled,
      saveData: prefersDataSaving,
      targets: [...new Set(targets)],
      load: loadJson,
      schedule: (run) => {
        if (typeof window.requestIdleCallback === "function") {
          const idle = window.requestIdleCallback(run, { timeout: 2000 });
          return () => window.cancelIdleCallback(idle);
        }
        const timer = window.setTimeout(run, 600);
        return () => window.clearTimeout(timer);
      },
    });
  }, [data, applied, currentSettled]);
  const apply = (next: Partial<Filters>) => setApplied((current) => ({ ...current, ...next, page: next.page ?? 1 }));
  useSearchUsage({
    scope: "budget_project",
    keyword: applied.q,
    conditions: [applied.mode, applied.part ?? "", applied.date, applied.region, applied.entity, applied.department, applied.account].join("|"),
    settled: !loading,
    failed: !loading && data === null,
    count: data?.total ?? 0,
    match: null,
  });
  const modeLabel = shown?.modes.find((mode) => mode.id === applied.mode)?.label ?? "사회복지";
  const appliedPart = applied.part ? budgetPartOf(applied.part) : undefined;
  // 세부 예산분야 목록: 고른 지역·기관·부서에 있는 부문만 보인다. 아직 받기 전이면 직전 목록을 쓴다.
  const partChoices = filters?.parts ?? [];
  const socialParts = partChoices.filter((part) => part.mode === "social_welfare");
  const healthParts = partChoices.filter((part) => part.mode === "health");
  // 지역·기관·부서를 바꿔 고른 부문이 그 범위에 없으면 분야 전체로 본다(목록을 받는 동안에는 그대로 둔다).
  const draftPart = draft.part && (!options.data || (options.data.filters.parts ?? []).some((part) => part.code === draft.part)) ? draft.part : "";
  const fieldValue = draftPart ? "part:" + draftPart : "mode:" + draft.mode;
  const chooseField = (value: string) => {
    const part = value.startsWith("part:") ? budgetPartOf(value.slice(5)) : undefined;
    const mode = part?.mode ?? value.slice(5);
    if (mode !== "social_welfare" && mode !== "health") return;
    // 부문은 고른 부서에 있는 것만 보이므로 기관·부서는 그대로 두고, 분야가 바뀌면 그 분야에 없는 회계만 뒤에서 비운다.
    setDraft((current) => ({ ...current, mode, part: part?.code ?? "" }));
  };
  // 분야·기관을 바꿔 고른 회계가 새 목록에 없으면 빈 값으로 본다(목록을 받는 동안에는 그대로 둔다).
  const draftAccount = draft.account && (!options.data || options.data.filters.accounts.some((account) => account.code === draft.account)) ? draft.account : "";

  // 광역단위별 세부사업 수(지도 색)·예산 합계(상위 목록). 한 광역단위에 원천 코드가 여럿이면 합친다.
  const regional = useMemo(() => {
    const byRegion = new Map<RegionId, { projects: number; budget: bigint; expenditure: bigint; hasAmount: boolean; codes: { code: string; projects: number }[] }>();
    for (const row of national.last?.regions_summary ?? []) {
      const id = regionIdOf(row.name);
      if (!id) continue;
      const entry = byRegion.get(id) ?? { projects: 0, budget: BigInt(0), expenditure: BigInt(0), hasAmount: false, codes: [] };
      entry.projects += row.projects;
      if (row.current_budget_krw !== null && row.public_expenditure_krw !== null) {
        entry.budget += BigInt(row.current_budget_krw);
        entry.expenditure += BigInt(row.public_expenditure_krw);
        entry.hasAmount = true;
      }
      entry.codes.push({ code: row.code, projects: row.projects });
      byRegion.set(id, entry);
    }
    const counts: Record<string, number> = {};
    for (const region of REGION_DEFINITIONS) counts[region.fullName] = byRegion.get(region.id)?.projects ?? 0;
    const statistics = buildRegionStatisticsFromCounts(counts);
    const ranked = REGION_DEFINITIONS.flatMap((region) => {
      const entry = byRegion.get(region.id);
      return entry?.hasAmount ? [{ region, ...entry }] : [];
    }).sort((left, right) => (right.budget > left.budget ? 1 : right.budget < left.budget ? -1 : 0)).slice(0, 5);
    return { byRegion, statistics, ranked };
  }, [national.last]);
  const mapMaximum = Math.max(0, ...regional.statistics.map((region) => region.count));
  const selectedRegion = REGION_DEFINITIONS.find((region) => regional.byRegion.get(region.id)?.codes.some((entry) => entry.code === applied.region));
  const selectedSido = selectedRegion?.fullName ?? "";
  const topBudget = regional.ranked[0]?.budget ?? BigInt(0);

  const localEntityName = applied.entity ? (appliedFilters?.entities ?? []).find((entity) => entity.id === applied.entity)?.name.replace(/\((행정시|행정구)\)$/, "") ?? "" : "";
  const localRegionTitle = localEntityName || selectedRegion?.fullName || (appliedFilters?.regions ?? []).find((region) => region.code === applied.region)?.name || "";
  const department = appliedFilters?.departments.find((entry) => entry.code === applied.department);
  const departmentName = applied.department ? budgetDepartmentName(department?.fiscal_entity_name ?? "", applied.department) ?? "부서코드 " + applied.department : "";
  const localTitle = formatBudgetLocalTitle(localRegionTitle, departmentName);
  const hasUnappliedChanges =
    draft.q.trim() !== applied.q.trim() ||
    draft.date !== applied.date ||
    draft.region !== applied.region ||
    draft.entity !== applied.entity ||
    draft.department !== applied.department ||
    draftAccount !== applied.account ||
    draft.mode !== applied.mode ||
    draftPart !== applied.part ||
    draft.targetGroup !== applied.targetGroup;
  const searchFormRef = useRef<HTMLDivElement>(null);
  const selectRegion = (sido: string) => {
    const region = REGION_DEFINITIONS.find((definition) => definition.fullName === sido);
    const codes = region ? regional.byRegion.get(region.id)?.codes ?? [] : [];
    const code = [...codes].sort((left, right) => right.projects - left.projects)[0]?.code ?? "";
    usageFilter("budget_region", sido);
    setDraft((current) => ({ ...current, region: code, entity: "", department: "", account: "" }));
    apply({ region: code, entity: "", department: "", account: "" });
    // 대시보드처럼 지역을 고르면 「조회 조건」이 화면 맨 위에 오도록 내려 준다.
    window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      searchFormRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
  };
  const series = (index: number, strong: boolean) => "var(--series-" + RANK_SERIES[index % RANK_SERIES.length] + (strong ? "-strong)" : ")");

  return (
    <main className="mx-auto max-w-(--jeju-main-max-wide) space-y-4 px-4 py-5 sm:px-6">
      <section aria-labelledby="budget-map-title" aria-busy={national.loading} className="rounded-xl border border-border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 id="budget-map-title" className="text-(length:--jeju-h1-size) leading-(--jeju-leading-tight) font-extrabold text-(--jeju-text-strong)">복지예산 집행현황</h1>
            <p className="mt-2 text-(length:--jeju-text-sm) text-muted-foreground">
              지방재정365에 공개된 세부사업별 예산현액과 지출액을 기준일별로 보여 줍니다. 지도에서 광역단위를 선택하면 아래 결과에 바로 반영됩니다.
            </p>
          </div>
          <p className="rounded-full border border-(--jeju-blue-light-strong) bg-(--jeju-primary-tint) px-3.5 py-1.5 text-(length:--jeju-text-sm) font-extrabold text-primary">
            {"전국 전체 · " + modeLabel}
          </p>
        </div>

        <div role="group" aria-label="조회 모드" className="mt-4 flex flex-wrap gap-2 print:hidden">
          {(shown?.modes ?? [{ id: "social_welfare", label: "사회복지", available: true }]).filter((mode) => !HIDDEN_MODES.has(mode.id)).map((mode) => (
            <Button key={mode.id} type="button" size="sm" variant={applied.mode === mode.id ? "default" : "outline"} aria-pressed={applied.mode === mode.id}
              onClick={() => { usageFilter("budget_field", mode.id); setDraft((current) => ({ ...current, mode: mode.id, part: "", department: "", account: "" })); apply({ mode: mode.id, part: "", department: "", account: "" }); }}>
              {mode.label}{mode.available ? "" : " (미제공)"}
            </Button>
          ))}
        </div>

        <section aria-label={"핵심 현황(전국 " + modeLabel + ")"} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard pending={national.loading && !national.last} label="예산현액" value={formatJoEok(nationalSummary?.current_budget_krw ?? null)} title={formatAmount(nationalSummary?.current_budget_krw ?? null, "won")} note="일반회계, 특별회계, 기금 등 포함" />
          <KpiCard pending={national.loading && !national.last} label="공개 지출액" value={formatJoEok(nationalSummary?.public_expenditure_krw ?? null)} title={formatAmount(nationalSummary?.public_expenditure_krw ?? null, "won")} />
          <KpiCard pending={national.loading && !national.last} label="집행률" value={nationalSummary?.execution_rate_pct ? nationalSummary.execution_rate_pct + "%" : "계산 불가"} note="공개 지출액 ÷ 예산현액" />
          <KpiCard pending={national.loading && !national.last} label="세부사업" value={NUMBER_FORMAT.format(nationalSummary?.matching_rows ?? 0) + "건"} note={national.last ? "재정주체 " + NUMBER_FORMAT.format(nationalSummary?.fiscal_entities ?? 0) + "곳" : undefined} />
        </section>
        <BudgetSourceNote national />

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(25rem,0.95fr)_minmax(18rem,0.5fr)] lg:items-stretch">
          <div className="flex min-h-[30rem] flex-col gap-3 print:min-h-0">
            <RegionSelector statistics={regional.statistics} selectedSido={selectedSido} disabled={!national.last} onSelect={selectRegion} />
            <KoreaVectorMap
              statistics={regional.statistics}
              maximum={mapMaximum}
              selectedSido={selectedSido}
              disabled={!national.last}
              onSelect={selectRegion}
              colorTheme="orange"
              measureLabel="세부사업 수"
              title="대한민국 광역단위 복지예산 세부사업 지도"
              description="원하는 지역을 클릭하거나 키보드로 선택하면 해당 광역단위 예산이 아래 결과에 반영됩니다."
            />
          </div>

          <div className="flex min-w-0 flex-col rounded-xl border border-border bg-(--jeju-surface-inset) p-5">
            <h2 className="text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)">예산현액 상위 5개 지역</h2>
            {!national.last ? (
              <ol aria-label="불러오는 중" className="mt-4 flex-1 space-y-3">
                {RANK_SERIES.map((series, index) => <li key={index} aria-hidden="true" className="h-[4.6rem] animate-pulse rounded-lg border border-border bg-card" />)}
              </ol>
            ) : regional.ranked.length === 0 ? (
              <p className="mt-4 flex-1 text-(length:--jeju-text-sm) text-muted-foreground">지역별 금액을 확인할 수 있는 자료가 없습니다.</p>
            ) : (
              <ol className="mt-4 flex-1 space-y-3">
                {regional.ranked.map((entry, index) => (
                  <li key={entry.region.id} className="rounded-lg border border-border bg-card px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3 text-(length:--jeju-text-sm)">
                      <span className="flex min-w-0 items-center gap-2 truncate font-bold text-(--jeju-text-body)">
                        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-(length:--jeju-text-xs) font-extrabold text-(--jeju-on-fill)" style={{ backgroundColor: series(index, true) }}>{index + 1}</span>
                        {entry.region.fullName}
                      </span>
                      <span className="shrink-0 font-extrabold tabular-nums text-(--jeju-text-strong)" title={formatAmount(entry.budget.toString(), "won")}>{formatJoEok(entry.budget.toString())}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-(--jeju-control-bg)" aria-hidden="true">
                      <div className="h-full rounded-full" style={{ width: percent(entry.budget, topBudget).toFixed(1) + "%", backgroundColor: series(index, false) }} />
                    </div>
                    <p className="mt-1.5 text-(length:--jeju-text-xs) tabular-nums text-muted-foreground">
                      세부사업 {NUMBER_FORMAT.format(entry.projects)}건 · 집행률 {entry.budget > BigInt(0) ? percent(entry.expenditure, entry.budget).toFixed(2) + "%" : "계산 불가"}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-4 rounded-lg border border-border bg-card px-3 py-3 text-(length:--jeju-text-sm) leading-6 text-muted-foreground">
              광역시·도 선택 숫자, 지도와 순위는 선택한 분야의 최신 전국 현황이며 지역·기관·부서·회계·기준일·검색어 조건으로 바뀌지 않습니다. 같은 지역을 다시 선택하면 전국으로 돌아갑니다. 자치단체별 공개 세출의 합이며 광역·기초 사이 이전재원 중복을 조정한 순지출이 아닙니다.
            </p>
          </div>
        </div>
      </section>

      <section aria-label="자료 기준" className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-(length:--jeju-text-sm)">
        <Badge variant={!listed ? (loading ? "info" : "danger") : listed.unavailable ? "warning" : "success"}>
          {!listed ? (loading ? "자료 불러오는 중" : "자료 불러오기 실패") : listed.unavailable ? "미제공" : "공개본 조회"}
        </Badge>
        {shown?.snapshot ? (
          <>
            <p><span className="text-muted-foreground">범위</span> <strong className="font-bold text-(--jeju-text-strong)">{shown.snapshot.scope_label} · {shown.snapshot.fiscal_year}회계연도</strong></p>
            <p>
              <span className="text-muted-foreground">기준일</span> <strong className="font-bold text-(--jeju-text-strong)">{shown.snapshot.effective_reference_date ?? "단일 기준일 없음"}</strong>
              {shown.fallback_used && shown.requested_reference_date ? " (요청일 " + shown.requested_reference_date + " 자료가 없어 가장 가까운 이전 공개본)" : ""}
            </p>
            <p>
              <span className="text-muted-foreground">수집</span> <strong className="font-bold tabular-nums text-(--jeju-text-strong)">{NUMBER_FORMAT.format(shown.snapshot.expected_count)}건 {shown.snapshot.complete ? "전체 완료" : "미완료"}</strong>
              {shown.snapshot.access_tier === "SAMPLE_KEY" ? " · 원천 표본키" : ""}
            </p>
            <p className="basis-full text-(length:--jeju-text-xs) text-muted-foreground">{shown.snapshot.classification_basis} {shown.snapshot.reference_date_note}</p>
            {filters?.published_local_governments !== undefined ? (
              <p className="basis-full text-(length:--jeju-text-xs) text-muted-foreground">
                현재 공개본에 수록된 자치단체 {NUMBER_FORMAT.format(filters.published_local_governments)}곳 / 전국 {LOCAL_GOVERNMENTS}곳
                {filters.published_local_governments < LOCAL_GOVERNMENTS ? " · 목록에 있는 기관도 해당 공개본의 예산 자료가 없을 수 있습니다." : ""}
                {(shown.snapshot_set?.length ?? 0) > 1 ? " · 합친 범위: " + (shown.snapshot_set ?? []).map((item) => item.scope_label.split(" ")[0] + " " + item.requested_reference_date).join(", ") : ""}
              </p>
            ) : null}
          </>
        ) : null}
        {data?.unavailable ? <p className="basis-full text-muted-foreground">{data.unavailable.message}</p> : null}
      </section>

      <div ref={searchFormRef} className="scroll-mt-3 space-y-4">
      {applied.region && localTitle ? (
        <section aria-labelledby="budget-local-title" aria-busy={kpi.loading} className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <p className="text-(length:--jeju-text-sm) font-bold text-primary">선택 지역 예산현황 · {modeLabel}</p>
          <h2 id="budget-local-title" className="mt-1 text-(length:--jeju-h1-size) leading-(--jeju-leading-tight) font-extrabold text-(--jeju-text-strong)">{localTitle}</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard pending={kpi.loading && !kpi.last} label="예산현액" value={formatJoEok(kpiSummary?.current_budget_krw ?? null)} title={formatAmount(kpiSummary?.current_budget_krw ?? null, "won")} note="일반회계, 특별회계, 기금 등 포함" />
            <KpiCard pending={kpi.loading && !kpi.last} label="공개 지출액" value={formatJoEok(kpiSummary?.public_expenditure_krw ?? null)} title={formatAmount(kpiSummary?.public_expenditure_krw ?? null, "won")} />
            <KpiCard pending={kpi.loading && !kpi.last} label="집행률" value={kpiSummary?.execution_rate_pct ? kpiSummary.execution_rate_pct + "%" : "계산 불가"} note="공개 지출액 ÷ 예산현액" />
            <KpiCard pending={kpi.loading && !kpi.last} label="세부사업" value={NUMBER_FORMAT.format(kpiSummary?.matching_rows ?? 0) + "건"} note={kpi.last ? "재정주체 " + NUMBER_FORMAT.format(kpiSummary?.fiscal_entities ?? 0) + "곳" : undefined} />
          </div>
          <BudgetSourceNote />
        </section>
      ) : null}
      <form className="rounded-xl border border-border bg-card p-4 sm:p-5" role="search" aria-label="복지예산 검색" onSubmit={(event) => { event.preventDefault(); usageClick("budget_query"); setApplied({ ...draft, account: draftAccount, part: draftPart, page: 1 }); }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-(length:--jeju-h3-size) font-extrabold text-(--jeju-text-strong)">조회 조건</h2>
          {hasUnappliedChanges ? (
            <p role="status" aria-live="polite" className="rounded-full bg-(--jeju-primary-tint) px-3 py-1 text-(length:--jeju-text-xs) font-bold text-primary">
              조건이 변경되었습니다 · 「조회」를 눌러 결과에 적용하세요
            </p>
          ) : null}
        </div>
        {applied.targetGroup && targetGroupOf(applied.targetGroup) ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-(length:--jeju-text-sm)">
            <Badge variant="info">대상자: {targetGroupOf(applied.targetGroup)?.label}</Badge>
            <span className="text-muted-foreground">세부사업명에 「{targetGroupOf(applied.targetGroup)?.keywords.join("」「")}」 중 하나가 들어간 사업(관계성 지도와 같은 조건)</span>
            <Button type="button" size="sm" variant="outline" onClick={() => { setDraft((current) => ({ ...current, targetGroup: "" })); setApplied((current) => ({ ...current, targetGroup: "", page: 1 })); }}>대상자 조건 해제</Button>
          </p>
        ) : null}
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="budget-q">세부사업명 검색</Label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
              <Input id="budget-q" type="search" className="pl-9" value={draft.q} maxLength={60} placeholder="예: 통합돌봄, 방문의료" onChange={(event) => setDraft({ ...draft, q: event.target.value })} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="budget-date">기준일(비우면 최신)</Label>
            <Input id="budget-date" type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="budget-region">지역</Label>
            <NativeSelect id="budget-region" className="w-full" value={draft.region} disabled={!catalogFilters} aria-busy={catalog.loading} onChange={(event) => setDraft({ ...draft, region: event.target.value, entity: "", department: "", account: "" })}>
              <NativeSelectOption value="">전체 지역</NativeSelectOption>
              {regions.map((region) => <NativeSelectOption key={region.code} value={region.code}>{region.name} ({region.code})</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="budget-entity">기관(광역·기초·행정시·행정구)</Label>
            <NativeSelect id="budget-entity" className="w-full" value={draft.entity} disabled={!draft.region || !catalogFilters} aria-busy={catalog.loading} onChange={(event) => setDraft({ ...draft, entity: event.target.value, department: "", account: "" })}>
              <NativeSelectOption value="">{draft.region ? "지역 전체 기관" : "지역을 먼저 고르세요"}</NativeSelectOption>
              {choices.entities.map((entity) => (
                <NativeSelectOption key={entity.id} value={entity.id}>
                  {entity.name}{entity.kind === "admin_unit" ? "" : " (" + NUMBER_FORMAT.format(entity.project_count) + "건)"}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="budget-department">부서</Label>
            <NativeSelect id="budget-department" className="w-full" value={draft.department ? draft.entity + "|" + draft.department : ""} disabled={!catalogFilters} aria-busy={catalog.loading} onChange={(event) => setDraft(selectBudgetDepartment(draft, choices.departments.find((department) => budgetDepartmentValue(department) === event.target.value)))}>
              <NativeSelectOption value="">전체 부서</NativeSelectOption>
              {choices.departments.map((department) => (
                <NativeSelectOption key={budgetDepartmentValue(department)} value={budgetDepartmentValue(department)}>{department.fiscal_entity_name} · {budgetDepartmentLabel(department.fiscal_entity_name, department.code)} ({department.project_count}건)</NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="budget-account">회계</Label>
            <NativeSelect id="budget-account" className="w-full" value={draftAccount} disabled={!options.data} aria-busy={options.loading} onChange={(event) => setDraft({ ...draft, account: event.target.value })}>
              <NativeSelectOption value="">전체 회계</NativeSelectOption>
              {(filters?.accounts ?? []).map((account) => <NativeSelectOption key={account.code} value={account.code}>{account.name} ({account.code})</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="budget-field">예산 분야</Label>
            <NativeSelect id="budget-field" className="w-full" value={fieldValue} aria-busy={options.loading} onChange={(event) => chooseField(event.target.value)}>
              {socialParts.length || draft.mode === "social_welfare" ? (
                <NativeSelectOptGroup label="사회복지 (080)">
                  <NativeSelectOption value="mode:social_welfare">사회복지 전체</NativeSelectOption>
                  {socialParts.map((part) => <NativeSelectOption key={part.code} value={"part:" + part.code}>{part.code} {part.name} ({NUMBER_FORMAT.format(part.project_count)}건)</NativeSelectOption>)}
                </NativeSelectOptGroup>
              ) : null}
              {healthParts.length || draft.mode === "health" ? (
                <NativeSelectOptGroup label="보건 (090)">
                  <NativeSelectOption value="mode:health">보건 전체</NativeSelectOption>
                  {healthParts.map((part) => <NativeSelectOption key={part.code} value={"part:" + part.code}>{part.code} {part.name} ({NUMBER_FORMAT.format(part.project_count)}건)</NativeSelectOption>)}
                </NativeSelectOptGroup>
              ) : null}
              {draftPart && !partChoices.some((part) => part.code === draftPart) ? <NativeSelectOption value={fieldValue}>{draftPart} {budgetPartOf(draftPart)?.name ?? ""}</NativeSelectOption> : null}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="budget-unit">결과표 금액 단위</Label>
            <NativeSelect id="budget-unit" className="w-full" value={unit} onChange={(event) => setUnit(event.target.value === "million" ? "million" : "won")}>
              <NativeSelectOption value="won">원</NativeSelectOption>
              <NativeSelectOption value="million">백만원(화면 표시용 반올림)</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 sm:justify-end lg:col-span-4 xl:col-span-3">
            {/* 로딩 표시는 조회 버튼 왼쪽 빈 공간에 띄워(PC) 버튼 자리를 바꾸지 않는다. 좁은 화면은 버튼 앞에 둔다. */}
            <div className="relative flex items-center gap-2">
              <span role="status" aria-live="polite" data-budget-loading className="pointer-events-none inline-flex items-center gap-1.5 whitespace-nowrap text-(length:--jeju-text-sm) font-bold text-(--jeju-secondary-strong) sm:absolute sm:top-1/2 sm:right-full sm:mr-3 sm:-translate-y-1/2">
                {resultLoading ? (
                  <>
                    <Spinner aria-hidden="true" role="presentation" label="" className="size-4 border-current/25 border-t-current" />
                    로딩중
                    <span aria-hidden="true" className="inline-flex items-end gap-0.5">
                      {[0, 1, 2].map((dot) => <span key={dot} className="size-1 animate-bounce rounded-full bg-current" style={{ animationDelay: dot * 150 + "ms" }} />)}
                    </span>
                  </>
                ) : null}
              </span>
              <Button type="submit"><SearchIcon />조회</Button>
            </div>
            <Button type="button" variant="outline" onClick={() => { setDraft(EMPTY); setApplied(EMPTY); }}><RefreshIcon />검색조건 초기화</Button>
          </div>
        </div>
        <p role="status" aria-live="polite" data-budget-options-status className="mt-2 text-(length:--jeju-text-sm) text-muted-foreground">
          {optionsLoading ? "조회 조건 목록을 불러오고 있습니다." : !catalog.data || !options.data || !appliedOptions.data ? "조회 조건 목록을 불러오지 못했습니다. 페이지를 새로고침해 주세요." : null}
        </p>
      </form>
      </div>

      <section aria-labelledby="budget-results-heading" className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="budget-results-heading" className="text-(length:--jeju-h2-size) font-extrabold text-(--jeju-text-strong)">
            {modeLabel}{appliedPart ? " · " + appliedPart.name : ""} 세부사업 <span role="status">{listed ? NUMBER_FORMAT.format(listed.total) + "건" : ""}</span>
          </h2>
          {listed?.summary ? (
            <p className="text-(length:--jeju-text-sm) tabular-nums text-muted-foreground">
              차액(미지출액) <strong className="text-(--jeju-text-strong)" title={formatAmount(listed.summary.unspent_difference_krw, "won")}>{formatJoEok(listed.summary.unspent_difference_krw)}</strong>
              {listed.summary.excluded_rows ? " · 금액 확인 불가 " + listed.summary.excluded_rows + "건 합계 제외" : ""}
            </p>
          ) : null}
        </div>
        {loading && !listed ? (
          <div aria-label="세부사업을 불러오는 중" className="space-y-2 rounded-xl border border-border bg-card p-4">
            {Array.from({ length: 6 }, (_, index) => <div key={index} aria-hidden="true" className="h-9 animate-pulse rounded-md bg-(--jeju-surface-inset)" />)}
          </div>
        ) : null}
        {!loading && !data ? <p role="alert" className="rounded-xl border border-border bg-card px-4 py-6 text-(length:--jeju-text-sm) text-(--jeju-danger)">자료를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.</p> : null}
        {listed && listed.items.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-border bg-card" aria-busy={loading}>
            <table className="w-full min-w-[880px] text-left text-(length:--jeju-text-sm)">
              <caption className="sr-only">세부사업별 예산현액·공개 지출액</caption>
              <thead className="bg-(--jeju-surface-inset) text-muted-foreground">
                <tr><th className="px-3 py-2">세부사업</th><th className="px-3">재정주체·부서</th><th className="px-3">회계·분야</th><th className="px-3 text-right">예산현액</th><th className="px-3 text-right">공개 지출액</th><th className="px-3 text-right">집행률</th></tr>
              </thead>
              <tbody>
                {listed.items.map((item) => (
                  <tr key={item.fiscal_project_id} className="border-t border-(--jeju-hairline) align-top">
                    <td className="px-3 py-2"><span className="font-bold text-(--jeju-text-strong)">{item.name}</span><br /><span className="text-(length:--jeju-text-xs) text-muted-foreground">사업코드 {item.source_project_code}</span></td>
                    <td className="px-3 py-2">{item.fiscal_entity.name}<br /><span className="text-(length:--jeju-text-xs) text-muted-foreground">{budgetDepartmentLabel(item.fiscal_entity.name, item.department_code)}</span></td>
                    <td className="px-3 py-2">{item.account.name}<br /><span className="text-(length:--jeju-text-xs) text-muted-foreground">{item.classification.field_name} · {item.classification.part_name}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatAmount(item.current_budget_krw, unit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatAmount(item.public_expenditure_krw, unit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{item.execution_rate_pct === null ? "계산 불가" : item.execution_rate_pct + "%"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {data && !data.unavailable && data.items.length === 0 ? <p className="rounded-xl border border-dashed border-border p-4 text-(length:--jeju-text-sm) text-muted-foreground">조건에 맞는 세부사업이 없습니다. 이 범위 밖의 사업이 없다는 뜻은 아닙니다.</p> : null}
        {listed && listed.total > listed.size ? (
          <nav className="flex items-center justify-center gap-3" aria-label="쪽 이동">
            <Button variant="outline" disabled={loading || applied.page <= 1} onClick={() => apply({ page: applied.page - 1 })}>이전</Button>
            <span className="text-(length:--jeju-text-sm) text-muted-foreground">{applied.page} / {totalPages}쪽</span>
            <Button variant="outline" disabled={loading || applied.page >= totalPages} onClick={() => apply({ page: applied.page + 1 })}>다음</Button>
          </nav>
        ) : null}
        <ul className="space-y-1.5 rounded-xl border border-border bg-card p-4 text-(length:--jeju-text-xs) leading-relaxed text-muted-foreground">
          {(shown?.notes ?? []).map((note) => <li key={note}>{note}</li>)}
          <li>내부 실시간 장부나 실제 집행 성과가 아닙니다. 출처: 행정안전부 지방재정365 OpenAPI 「세부사업별 세출현황」(QWGJK).</li>
        </ul>
      </section>
    </main>
  );
}
