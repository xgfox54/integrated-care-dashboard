"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { normalizeRows, SERVICE_CATEGORY_ORDER, type ServiceRow } from "./dataset";
import { prefersDataSaving } from "./network-preferences";
import type { SearchNameMatch } from "./official-query";
import type { SearchHelp } from "./search-terms";
import type { LoadPhase } from "./use-dataset";
import { usageError, usageErrorCode, usagePerf } from "./usage/track";
import {
  extendTarget,
  nextCatalogPage,
  WIKI_LOAD_PLAN,
  WIKI_SAVER_PLAN,
  type WikiLoadPlan,
} from "./wiki-loading";

export { scrolledPast } from "./wiki-loading";

export const CATALOG_DELAY_MS = 800;
const SEARCH_DELAY_MS = 250;

export interface WikiFilters {
  readonly sido: string;
  readonly sigungu: string;
  readonly category: string;
}
export const EMPTY_WIKI_FILTERS: WikiFilters = { sido: "", sigungu: "", category: "" };

interface SelectionState {
  readonly key: string;
  readonly row: ServiceRow | null;
  readonly phase: LoadPhase;
}

interface CatalogState {
  readonly key: string;
  readonly rows: ServiceRow[];
  readonly totalCount: number;
  readonly phase: LoadPhase;
  readonly nameMatch: SearchNameMatch | null;
  readonly searchHelp: SearchHelp | undefined;
  /** 받아 둔 쪽 수 */
  readonly pages: number;
  /** 다음 쪽 받기에 실패해 멈춘 상태(「더 보기」로 다시 시도) */
  readonly moreFailed: boolean;
}

const EMPTY_CATALOG: CatalogState = {
  key: "",
  rows: [],
  totalCount: 0,
  phase: "loading",
  nameMatch: null,
  searchHelp: undefined,
  pages: 0,
  moreFailed: false,
};

function selectedRow(payload: unknown): ServiceRow | null {
  if (typeof payload !== "object" || payload === null || !("row" in payload)) {
    return null;
  }
  return normalizeRows([payload.row])[0] ?? null;
}

interface CatalogPage {
  readonly rows: ServiceRow[];
  readonly totalCount: number;
  readonly nameMatch: SearchNameMatch | null;
  readonly searchHelp?: SearchHelp;
}

function catalog(payload: unknown): CatalogPage {
  if (typeof payload !== "object" || payload === null) {
    return { rows: [], totalCount: 0, nameMatch: null };
  }
  const rows = "rows" in payload ? normalizeRows(payload.rows) : [];
  const totalCount = "totalCount" in payload && typeof payload.totalCount === "number"
    ? payload.totalCount
    : rows.length;
  const nameMatch = "nameMatch" in payload && payload.nameMatch && typeof payload.nameMatch === "object"
    ? (payload.nameMatch as SearchNameMatch)
    : null;
  const searchHelp = "searchHelp" in payload && payload.searchHelp && typeof payload.searchHelp === "object"
    ? (payload.searchHelp as SearchHelp)
    : undefined;
  return { rows, totalCount, nameMatch, searchHelp };
}

async function readSelected(key: string, signal: AbortSignal): Promise<ServiceRow | null> {
  const params = new URLSearchParams({ service: key });
  const response = await fetch(`/api/dataset/service?${params.toString()}`, {
    cache: "default",
    signal,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`선택 사업 응답 오류: ${response.status}`);
  const payload: unknown = await response.json();
  return selectedRow(payload);
}

async function readCatalogPage(
  keyword: string,
  filters: WikiFilters,
  page: number,
  pageSize: number,
  signal: AbortSignal,
): Promise<CatalogPage> {
  const params = new URLSearchParams({ page: String(page), size: String(pageSize) });
  if (keyword) params.set("q", keyword);
  if (filters.sido) params.set("sido", filters.sido);
  if (filters.sigungu) params.set("sigungu", filters.sigungu);
  if (filters.category) params.set("category", filters.category);
  const response = await fetch(`/api/dataset/search?${params.toString()}`, {
    cache: "default",
    signal,
  });
  if (!response.ok) throw new Error(`사업 목록 응답 오류: ${response.status}`);
  const payload: unknown = await response.json();
  return catalog(payload);
}

/**
 * 선택한 사업 1건을 먼저 받고, 사업 목록은 검색어·조건에 맞춰 쪽 단위로 차례로 받는다.
 * enabled가 거짓이면(처음 조건을 아직 정하지 못함) 목록을 받지 않는다.
 */
export function useWikiDataset(selectedKey: string, query: string, filters: WikiFilters, enabled: boolean) {
  const [plan] = useState<WikiLoadPlan>(() => (prefersDataSaving() ? WIKI_SAVER_PLAN : WIKI_LOAD_PLAN));
  // 주소에 사업이 있으면 첫 목록은 그 사업을 먼저 보여 준 뒤 조금 늦게 받는다.
  const [firstDelay] = useState(() => (selectedKey ? CATALOG_DELAY_MS : 0));
  const firstCatalogStarted = useRef(false);
  const [selection, setSelection] = useState<SelectionState>({
    key: "",
    row: null,
    phase: "ready",
  });
  // 목록에서 고른 사업은 목록에 받아 둔 내용으로 바로 보여 준다(따로 받지 않음).
  const [seed, setSeed] = useState<{ readonly key: string; readonly row: ServiceRow | null }>({ key: "", row: null });
  const [catalogState, setCatalogState] = useState<CatalogState>(EMPTY_CATALOG);
  const keyword = query.trim();
  const { sido, sigungu, category } = filters;
  const catalogKey = JSON.stringify([keyword, sido, sigungu, category]);
  const [target, setTarget] = useState<{ readonly key: string; readonly count: number }>({ key: "", count: plan.firstTarget });

  const seeded = Boolean(selectedKey) && seed.key === selectedKey;
  const selectionResolved = !selectedKey || seeded || selection.key === selectedKey;
  const selected = seeded ? seed.row : selection.key === selectedKey ? selection.row : null;
  const selectedPhase: LoadPhase = !selectedKey || seeded
    ? "ready"
    : selection.key === selectedKey
      ? selection.phase
      : "loading";
  const current = catalogState.key === catalogKey ? catalogState : null;
  const catalogPhase: LoadPhase = current?.phase ?? "loading";
  const loadedPages = current?.pages ?? 0;
  const totalCount = current?.totalCount ?? 0;
  const targetCount = target.key === catalogKey ? target.count : plan.firstTarget;
  const nextPage = current?.phase === "ready" && !current.moreFailed
    ? nextCatalogPage(loadedPages, plan.pageSize, totalCount, targetCount)
    : null;
  const hasMore = current?.phase === "ready" && loadedPages * plan.pageSize < totalCount;

  useEffect(() => {
    if (!selectedKey || seed.key === selectedKey) return;

    const controller = new AbortController();
    const started = performance.now();
    void readSelected(selectedKey, controller.signal)
      .then((row) => {
        if (controller.signal.aborted) return;
        setSelection({ key: selectedKey, row, phase: "ready" });
        performance.mark("wiki-selected-ready");
        if (row) usagePerf("care_detail", performance.now() - started);
        else usageError("care_detail", "not_found");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSelection({ key: selectedKey, row: null, phase: "error" });
        usageError("care_detail", usageErrorCode(error));
      });
    return () => controller.abort();
  }, [seed.key, selectedKey]);

  /** 목록에서 고른 사업을 받아 둔 내용으로 바로 표시한다. */
  const showSelected = useCallback((key: string, row: ServiceRow) => {
    setSeed({ key, row });
  }, []);

  // 첫 쪽: 검색어·조건이 바뀔 때마다 새로 받는다(검색어는 입력이 멈춘 뒤).
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const delay = keyword ? SEARCH_DELAY_MS : firstCatalogStarted.current ? 0 : firstDelay;
    const timer = window.setTimeout(() => {
      firstCatalogStarted.current = true;
      performance.mark("wiki-catalog-requested");
      const started = performance.now();
      void readCatalogPage(keyword, { sido, sigungu, category }, 1, plan.pageSize, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          if (keyword) usagePerf("search_wiki", performance.now() - started);
          setCatalogState({
            key: catalogKey,
            rows: result.rows,
            totalCount: result.totalCount,
            phase: "ready",
            nameMatch: result.nameMatch,
            searchHelp: result.searchHelp,
            pages: 1,
            moreFailed: false,
          });
          performance.mark("wiki-catalog-ready");
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setCatalogState({ ...EMPTY_CATALOG, key: catalogKey, phase: "error" });
          if (!keyword) usageError("wiki_catalog", usageErrorCode(error));
        });
    }, delay);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [catalogKey, category, enabled, firstDelay, keyword, plan.pageSize, sido, sigungu]);

  // 다음 쪽: 목표 수에 닿을 때까지 한 쪽씩 차례로 받아 뒤에 붙이고, 닿으면 멈춘다.
  useEffect(() => {
    if (nextPage === null) return;
    const controller = new AbortController();
    void readCatalogPage(keyword, { sido, sigungu, category }, nextPage, plan.pageSize, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setCatalogState((state) =>
          state.key === catalogKey && state.pages === nextPage - 1
            ? { ...state, rows: [...state.rows, ...result.rows], pages: nextPage }
            : state,
        );
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setCatalogState((state) => (state.key === catalogKey ? { ...state, moreFailed: true } : state));
      });
    return () => controller.abort();
  }, [catalogKey, category, keyword, nextPage, plan.pageSize, sido, sigungu]);

  /** 다음 묶음을 받는다(목록을 80% 이상 내렸을 때, 「더 보기」, 실패 뒤 다시 시도). */
  const requestMore = useCallback(() => {
    if (!hasMore) return;
    setCatalogState((state) => (state.key === catalogKey && state.moreFailed ? { ...state, moreFailed: false } : state));
    setTarget((currentTarget) => ({
      key: catalogKey,
      count: extendTarget(
        currentTarget.key === catalogKey ? currentTarget.count : plan.firstTarget,
        loadedPages * plan.pageSize,
        plan.step,
      ),
    }));
  }, [catalogKey, hasMore, loadedPages, plan]);

  return {
    selected,
    selectedPhase,
    selectionResolved,
    catalogRows: current?.rows ?? [],
    catalogTotalCount: totalCount,
    catalogPhase,
    catalogNameMatch: current?.nameMatch ?? null,
    catalogSearchHelp: current?.searchHelp,
    hasMore,
    loadingMore: nextPage !== null,
    moreFailed: current?.moreFailed ?? false,
    requestMore,
    showSelected,
  };
}

export interface WikiFilterOptions {
  readonly sidoList: readonly string[];
  readonly sigunguBySido: Readonly<Record<string, readonly string[]>>;
  readonly categories: readonly string[];
}

function filterOptions(payload: unknown): WikiFilterOptions | null {
  if (typeof payload !== "object" || payload === null || !("summary" in payload)) return null;
  const summary = payload.summary as {
    readonly regionCounts?: Record<string, number>;
    readonly sigunguBySido?: Record<string, readonly string[]>;
    readonly categories?: readonly string[];
  } | null;
  if (!summary?.regionCounts || !summary.sigunguBySido) return null;
  const available = new Set(summary.categories ?? []);
  return {
    sidoList: Object.keys(summary.regionCounts).sort((left, right) => left.localeCompare(right, "ko")),
    sigunguBySido: summary.sigunguBySido,
    categories: SERVICE_CATEGORY_ORDER.filter((name) => available.has(name)),
  };
}

/** 검색 조건 선택 메뉴(광역시·도, 기초시·군·구, 사업 분류)의 항목. 전국 요약(약 4KB)에서 읽는다. */
export function useWikiFilterOptions(): WikiFilterOptions | null {
  const [options, setOptions] = useState<WikiFilterOptions | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/dataset/summary", { cache: "default", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        if (!controller.signal.aborted) setOptions(filterOptions(payload));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return options;
}
