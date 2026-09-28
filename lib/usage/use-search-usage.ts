"use client";

import { useCallback, useEffect, useRef } from "react";

import { SEARCH_SETTLE_MS, normalizeName, type MatchState, type SearchScope } from "./codes";
import { isUsageComposing, usageSearch } from "./track";

export interface SearchUsageOptions {
  readonly scope: SearchScope;
  /** 검색창의 현재 값. 이 값 자체는 보내지 않고, 검색 1회를 가르는 데만 쓴다. */
  readonly keyword: string;
  /** 검색어 외 조건(지역·분류 등). 바뀌면 새 검색으로 본다. 쪽 이동은 넣지 않는다. */
  readonly conditions: string;
  /** 현재 조건의 결과가 도착(또는 실패)했는지. */
  readonly settled: boolean;
  readonly failed: boolean;
  readonly count: number;
  readonly match: { readonly status: MatchState; readonly key?: string } | null;
}

/**
 * 검색 1회 판정: 검색어가 있고, 결과가 확정됐고, 입력이 800ms 동안 바뀌지 않았으며(한글 조합 중이 아니면) 한 번 센다.
 * 같은 조건의 재렌더링·쪽 이동·응답 재수신은 다시 세지 않는다. 결과를 눌러 상세로 가면 그 자리에서 바로 확정한다.
 */
export function useSearchUsage(options: SearchUsageOptions): { confirm: () => string | undefined; active: boolean } {
  const normalized = normalizeName(options.keyword);
  const context = normalized ? options.scope + "\u0000" + normalized + "\u0000" + options.conditions : "";
  const latest = useRef(options);
  const record = useRef<{ context: string; search: string | undefined }>({ context: "", search: undefined });

  useEffect(() => {
    latest.current = options;
  });

  const emit = useCallback((target: string): string | undefined => {
    if (!target) return undefined;
    if (record.current.context === target) return record.current.search;
    const current = latest.current;
    if (!current.settled) return undefined;
    const search = usageSearch({ scope: current.scope, failed: current.failed, count: current.count, match: current.match });
    record.current = { context: target, search };
    return search;
  }, []);

  const settled = options.settled;
  useEffect(() => {
    if (!context || !settled) return;
    let timer = 0;
    const tick = () => {
      if (isUsageComposing()) {
        timer = window.setTimeout(tick, 300);
        return;
      }
      emit(context);
    };
    timer = window.setTimeout(tick, SEARCH_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [context, settled, emit]);

  const confirm = useCallback(() => emit(context), [context, emit]);
  return { confirm, active: Boolean(context) };
}

