"use client";

import { useEffect, useState } from "react";

import { normalizeRows, type ServiceRow } from "./dataset";
import type { LoadPhase } from "./use-dataset";

export const CATALOG_DELAY_MS = 800;
const SEARCH_DELAY_MS = 250;

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
}

interface CatalogScope {
  readonly sido: string;
  readonly sigungu: string;
}

function selectedRow(payload: unknown): ServiceRow | null {
  if (typeof payload !== "object" || payload === null || !("row" in payload)) {
    return null;
  }
  return normalizeRows([payload.row])[0] ?? null;
}

function catalog(payload: unknown): { rows: ServiceRow[]; totalCount: number } {
  if (typeof payload !== "object" || payload === null) {
    return { rows: [], totalCount: 0 };
  }
  const rows = "rows" in payload ? normalizeRows(payload.rows) : [];
  const totalCount = "totalCount" in payload && typeof payload.totalCount === "number"
    ? payload.totalCount
    : rows.length;
  return { rows, totalCount };
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

async function readCatalogPage(filters: Record<string, string>, signal: AbortSignal) {
  const params = new URLSearchParams({ page: "1", size: "30", ...filters });
  const response = await fetch(`/api/dataset/search?${params.toString()}`, {
    cache: "default",
    signal,
  });
  if (!response.ok) throw new Error(`사업 목록 응답 오류: ${response.status}`);
  const payload: unknown = await response.json();
  return catalog(payload);
}

async function readCatalog(query: string, scope: CatalogScope, signal: AbortSignal) {
  const keyword = query.trim();
  if (keyword || !scope.sido) return readCatalogPage(keyword ? { q: keyword } : {}, signal);
  const [local, province] = await Promise.all([
    scope.sigungu
      ? readCatalogPage({ sido: scope.sido, sigungu: scope.sigungu }, signal)
      : null,
    readCatalogPage({ sido: scope.sido }, signal),
  ]);
  return {
    rows: [...(local?.rows ?? []), ...province.rows],
    totalCount: province.totalCount,
  };
}

export function useWikiDataset(selectedKey: string, query: string) {
  const [selection, setSelection] = useState<SelectionState>({
    key: "",
    row: null,
    phase: "ready",
  });
  const [catalogState, setCatalogState] = useState<CatalogState>({
    key: "",
    rows: [],
    totalCount: 0,
    phase: "loading",
  });
  const selectionResolved = !selectedKey || selection.key === selectedKey;
  const selected = selection.key === selectedKey ? selection.row : null;
  const scopeSido = query.trim() ? "" : selected?.sido ?? "";
  const scopeSigungu = scopeSido ? selected?.sigungu ?? "" : "";
  const catalogKey = JSON.stringify([selectedKey, query.trim(), scopeSido, scopeSigungu]);
  const selectedPhase = !selectedKey
    ? "ready"
    : selection.key === selectedKey
      ? selection.phase
      : "loading";
  const catalogRows = catalogState.key === catalogKey ? catalogState.rows : [];
  const catalogTotalCount = catalogState.key === catalogKey ? catalogState.totalCount : 0;
  const catalogPhase = catalogState.key === catalogKey ? catalogState.phase : "loading";

  useEffect(() => {
    if (!selectedKey) return;

    const controller = new AbortController();
    void readSelected(selectedKey, controller.signal)
      .then((row) => {
        if (controller.signal.aborted) return;
        setSelection({ key: selectedKey, row, phase: "ready" });
        performance.mark("wiki-selected-ready");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setSelection({ key: selectedKey, row: null, phase: "error" });
      });
    return () => controller.abort();
  }, [selectedKey]);

  useEffect(() => {
    if (!selectionResolved) return;
    const controller = new AbortController();
    const delay = query.trim()
      ? SEARCH_DELAY_MS
      : selectedKey
        ? CATALOG_DELAY_MS
        : 0;
    const timer = window.setTimeout(() => {
      performance.mark("wiki-catalog-requested");
      void readCatalog(query, { sido: scopeSido, sigungu: scopeSigungu }, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setCatalogState({
            key: catalogKey,
            rows: result.rows,
            totalCount: result.totalCount,
            phase: "ready",
          });
          performance.mark("wiki-catalog-ready");
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setCatalogState({ key: catalogKey, rows: [], totalCount: 0, phase: "error" });
          }
        });
    }, delay);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [catalogKey, query, scopeSido, scopeSigungu, selectedKey, selectionResolved]);

  return {
    selected,
    selectedPhase,
    selectionResolved,
    catalogRows,
    catalogTotalCount,
    catalogPhase,
    catalogScope: scopeSido,
  };
}
