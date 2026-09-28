"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { expandCompactRows, type DataState, type FilterState, type ServiceRow, normalizeRows } from "./dataset";
import { DEFAULT_SEARCH_PAGE_SIZE, type DatasetSummary } from "./dataset-summary";
import { versionedDataUrl } from "./data-versions";
import { prefersDataSaving } from "./network-preferences";
import type { SearchAggregates } from "./official-query";
import type { SearchNameMatch } from "./official-query";
import { bundleQueryString, planRegionBundles, type RegionTarget } from "./region-load-order";
import { bundleTask, getServerProgress, searchLoader, searchTask, type LoadProgress } from "./search-loader";
import { searchQueryString } from "./search-query";
import type { SearchHelp } from "./search-terms";
import { usagePerf } from "./usage/track";

export interface DatasetMeta {
  state: DataState;
  sourceLabel: string;
  sourceUrl: string;
  fetchedAt: string;
  dataAsOf: string;
  message: string;
}

export type LoadPhase = "loading" | "ready" | "error";

type BasePayload = DatasetMeta;

interface SummaryPayload extends BasePayload {
  summary: DatasetSummary | null;
}

interface FullDatasetPayload extends BasePayload {
  columns?: unknown;
  dictionaries?: unknown;
  rows: unknown;
}

export interface SearchState {
  readonly rows: ServiceRow[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly regionCounts: Readonly<Record<string, number>>;
  readonly categoryCounts: Readonly<Record<string, number>>;
  readonly regionSummary: SearchAggregates;
  readonly nameMatch?: SearchNameMatch;
  readonly searchHelp?: SearchHelp;
}

const EMPTY_SUMMARY: DatasetSummary = {
  totalCount: 0,
  sidoCount: 0,
  sigunguCount: 0,
  categoryCount: 0,
  regionCounts: {},
  categoryCounts: {},
  sigunguBySido: {},
  categories: [],
};

const EMPTY_SEARCH: SearchState = {
  rows: [],
  totalCount: 0,
  page: 1,
  pageSize: DEFAULT_SEARCH_PAGE_SIZE,
  pageCount: 1,
  regionCounts: {},
  categoryCounts: {},
  regionSummary: { rowCount: 0, categoryCounts: {}, typeCounts: {} },
};

const INITIAL_META: DatasetMeta = {
  state: "syncing",
  sourceLabel: "",
  sourceUrl: "",
  fetchedAt: "",
  dataAsOf: "",
  message: "",
};

function metadata(payload: BasePayload): DatasetMeta {
  return {
    state: payload.state,
    sourceLabel: payload.sourceLabel,
    sourceUrl: payload.sourceUrl,
    fetchedAt: payload.fetchedAt,
    dataAsOf: payload.dataAsOf,
    message: payload.message,
  };
}

async function readJson<T>(url: string, cache: RequestCache, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache, signal });
  if (!response.ok) throw new Error(`데이터 응답 오류: ${response.status}`);
  return response.json() as Promise<T>;
}

export interface DatasetOptions {
  /** False until the initial region (URL or visitor location) is decided. */
  readonly searchEnabled: boolean;
  /** 광역시·도 of the visitor's IP, loaded first in the background. */
  readonly preferredSido: string | null;
}

export function useDataset(filters: FilterState, page: number, pageSize: number, options: DatasetOptions) {
  const { searchEnabled, preferredSido } = options;
  const [summary, setSummary] = useState<DatasetSummary>(EMPTY_SUMMARY);
  const [meta, setMeta] = useState<DatasetMeta>(INITIAL_META);
  const [summaryPhase, setSummaryPhase] = useState<LoadPhase>("loading");
  const [failedQuery, setFailedQuery] = useState("");
  const [lastSearch, setLastSearch] = useState<SearchState>(EMPTY_SEARCH);
  const [reloadToken, setReloadToken] = useState(0);
  // 처음 보이는 화면(접속 지역)의 결과가 도착하거나 실패한 뒤에 미리받기를 시작한다.
  const [firstViewSettled, setFirstViewSettled] = useState(false);
  const hasSummary = useRef(false);
  const lastKeyword = useRef(filters.keyword);
  const progress = useSyncExternalStore<LoadProgress>(
    searchLoader.subscribe,
    searchLoader.getProgress,
    getServerProgress,
  );

  const query = searchQueryString(filters, page, pageSize);
  const loaded = searchEnabled ? searchLoader.peek(query) : undefined;
  if (!firstViewSettled && searchEnabled && (loaded || failedQuery === query)) setFirstViewSettled(true);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let liveTimer = 0;
    let cancelled = false;

    const apply = (payload: SummaryPayload) => {
      if (cancelled || !payload.summary) return;
      hasSummary.current = true;
      setSummary(payload.summary);
      setMeta(metadata(payload));
      setSummaryPhase(payload.state === "failed" ? "error" : "ready");
      if (process.env.NODE_ENV !== "production") performance.mark("dashboard-summary-ready");
    };

    const loadLive = async () => {
      try {
        const suffix = reloadToken > 0 ? `?refresh=${reloadToken}` : "";
        apply(await readJson<SummaryPayload>(`/api/dataset/summary${suffix}`, reloadToken ? "reload" : "default", controller.signal));
      } catch (error) {
        if (controller.signal.aborted || cancelled) return;
        if (!hasSummary.current) {
          setMeta({
            ...INITIAL_META,
            state: "failed",
            message: "사이트 서버에 연결하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 확인해 주세요.",
          });
          setSummaryPhase("error");
        } else {
          setMeta((current) => ({
            ...current,
            message: error instanceof Error
              ? `최신 요약 확인에 실패해 검증된 배포 자료를 표시합니다: ${error.message}`
              : "최신 요약 확인에 실패해 검증된 배포 자료를 표시합니다.",
          }));
        }
      }
    };

    if (!hasSummary.current) setSummaryPhase("loading");
    if (reloadToken > 0) {
      void loadLive();
    } else {
      readJson<SummaryPayload>(versionedDataUrl("/data/summary.json", "dashboardSummary"), "force-cache", controller.signal)
        .then((payload) => {
          apply(payload);
          liveTimer = window.setTimeout(() => void loadLive(), 800);
        })
        .catch(() => void loadLive());
    }

    return () => {
      cancelled = true;
      window.clearTimeout(liveTimer);
      controller.abort();
    };
  }, [reloadToken]);

  // The page the user is looking at always loads first, ahead of the queue.
  useEffect(() => {
    if (!searchEnabled || searchLoader.peek(query)) return;
    let cancelled = false;
    const typing = lastKeyword.current !== filters.keyword;
    lastKeyword.current = filters.keyword;
    const keywordSearch = filters.keyword.trim() !== "";
    const timer = window.setTimeout(() => {
      const started = performance.now();
      searchLoader
        .load(query)
        .then(() => {
          if (!cancelled) setFailedQuery("");
          if (keywordSearch) usagePerf("search_care", performance.now() - started);
        })
        .catch(() => {
          if (!cancelled) setFailedQuery(query);
        });
    }, typing ? 350 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [filters.keyword, query, reloadToken, searchEnabled]);

  // Background order: visitor's 광역시·도, other 광역시·도 (가나다), then 시·군·구 (가나다),
  // fetched as region bundles. Data-saver mode skips the background prefetch entirely;
  // regions still load the moment the visitor selects them.
  const planCategory = filters.category;
  const planTasks = useMemo(() => {
    if (!searchEnabled || !firstViewSettled || summaryPhase !== "ready" || filters.keyword) return null;
    if (prefersDataSaving()) return null;
    const toQuery = (target: RegionTarget) =>
      searchQueryString({ ...target, category: planCategory, keyword: "" }, 1, pageSize);
    const { preferred, bundles } = planRegionBundles(summary.sigunguBySido, preferredSido, pageSize);
    return [
      ...(preferred ? [searchTask(toQuery(preferred))] : []),
      ...bundles.map((bundle) =>
        bundleTask(bundleQueryString(bundle, pageSize, planCategory), bundle.targets.map(toQuery)),
      ),
    ];
  }, [filters.keyword, firstViewSettled, pageSize, planCategory, preferredSido, searchEnabled, summary.sigunguBySido, summaryPhase]);

  useEffect(() => {
    if (planTasks) searchLoader.plan(planTasks);
  }, [planTasks]);

  // Keep the previous counts on screen while the next page loads.
  if (loaded && loaded !== lastSearch) setLastSearch(loaded);

  const search: SearchState = loaded ?? lastSearch;
  const searchPhase: LoadPhase = loaded
    ? loaded.state === "failed" ? "error" : "ready"
    : failedQuery === query ? "error" : "loading";
  const displayMeta = useMemo(
    () => loaded
      ? { ...meta, fetchedAt: loaded.fetchedAt || meta.fetchedAt, dataAsOf: loaded.dataAsOf || meta.dataAsOf }
      : meta,
    [loaded, meta],
  );
  const prefetch = planTasks ? { done: progress.done, total: progress.total } : null;

  return { summary, search, meta: displayMeta, summaryPhase, searchPhase, reload, prefetch };
}

export function useFullDataset(enabled = true) {
  const [rows, setRows] = useState<ServiceRow[]>([]);
  const [meta, setMeta] = useState<DatasetMeta>(INITIAL_META);
  const [phase, setPhase] = useState<LoadPhase>("loading");

  useEffect(() => {
    if (!enabled || rows.length > 0) return;
    const controller = new AbortController();
    readJson<FullDatasetPayload>("/api/dataset", "default", controller.signal)
      .then((payload) => {
        if (controller.signal.aborted) return;
        const normalized = normalizeRows(expandCompactRows(payload));
        setRows(normalized);
        setMeta(metadata({ ...payload, state: normalized.length > 0 ? payload.state : "empty" }));
        setPhase(payload.state === "failed" ? "error" : "ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setPhase("error");
      });
    return () => controller.abort();
  }, [enabled, rows.length]);

  return { rows, meta, phase: enabled ? phase : "ready" };
}
