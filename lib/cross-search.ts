"use client";

import { useEffect, useState } from "react";

import { prefersDataSaving } from "./network-preferences";
import { matchesSearch, parseSearch } from "./search-terms";

/** 검색 결과가 0건일 때 다른 탭에서 같은 검색어로 찾은 수를 알려 준다. */

export function welfareSearchHref(query: string): string {
  return "/welfare100?q=" + encodeURIComponent(query.trim()) + "#institutions";
}

export function careSearchHref(query: string): string {
  return "/?q=" + encodeURIComponent(query.trim());
}

/** 복지제도100에서 같은 검색어로 찾은 제도 수. 데이터 절약 모드에서는 목록을 받지 않고 null을 돌려준다. */
export function useWelfareMatchCount(query: string, enabled: boolean): number | null {
  const [result, setResult] = useState<{ readonly query: string; readonly count: number } | null>(null);
  const keyword = query.trim();
  useEffect(() => {
    if (!enabled || !keyword || prefersDataSaving()) return;
    let alive = true;
    import("./welfare100/payload")
      .then(({ loadCatalog }) => loadCatalog())
      .then(({ entries }) => {
        if (!alive) return;
        const parsed = parseSearch(keyword);
        const count = entries.filter((entry) => matchesSearch(entry.searchText, parsed, { ignoreRegion: entry.org === "중앙부처" })).length;
        setResult({ query: keyword, count });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enabled, keyword]);
  return enabled && result?.query === keyword ? result.count : null;
}

/** 통합돌봄 사업(대시보드·WIKI)에서 같은 검색어로 찾은 사업 수(전국). */
export function useCareMatchCount(query: string, enabled: boolean): number | null {
  const [result, setResult] = useState<{ readonly query: string; readonly count: number } | null>(null);
  const keyword = query.trim();
  useEffect(() => {
    if (!enabled || !keyword) return;
    const controller = new AbortController();
    fetch("/api/dataset/search?" + new URLSearchParams({ page: "1", size: "20", q: keyword }).toString(), {
      cache: "default",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? (response.json() as Promise<{ totalCount?: unknown }>) : null))
      .then((payload) => {
        if (payload && typeof payload.totalCount === "number") setResult({ query: keyword, count: payload.totalCount });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [enabled, keyword]);
  return enabled && result?.query === keyword ? result.count : null;
}
