// 이용통계 진입 모듈. 모든 공개 화면이 부르므로 가볍게 유지한다.
// - 동의 창 없이, 제외 대상이 아닌 브라우저에서만 모은다(preference.ts: 통계에서 빼기 선택, 추적 거부 신호, 자동화 도구).
// - 수집 설정 확인이 끝날 때까지만 이번 화면의 이벤트를 메모리에 잠시 둔다. 수집이 꺼져 있으면 버린다.
// - 이벤트는 정해진 코드와 임시 ID만 담는다. 검색어·주소·화면 내용은 담지 않는다.
import {
  MAX_EVENTS_PER_REQUEST,
  USAGE_POLICY_VERSION,
  USAGE_SCHEMA_VERSION,
  type ActionCode,
  type EntityKind,
  type ErrorCode,
  type ErrorOp,
  type FilterKind,
  type MatchState,
  type PageCode,
  type PerfMetric,
  type ScreenType,
  type SearchScope,
  type TabCode,
  type ViewRoute,
  resultBucket,
} from "./codes.ts";
import { cachedUsageEnabled, isUsageExcluded } from "./preference.ts";

export type UsageEventBody = Record<string, string | number>;

/** 수집기(collector.ts)가 붙는 자리. */
export interface UsageSink {
  send(event: UsageEventBody): void;
  setTab(tab: TabCode): void;
  openEntity(viewId: string, kind: EntityKind, key: string): void;
  closeEntity(viewId: string): void;
  isComposing(): boolean;
}

type Mode = "unknown" | "off" | "pending" | "on";

interface State {
  mode: Mode;
  sink: UsageSink | null;
  pending: UsageEventBody[];
  pendingSince: number;
  page: PageCode | null;
  tab: TabCode | null;
  entities: Map<string, { kind: EntityKind; key: string }>;
  emittedViews: Set<string>;
}

const PENDING_LIMIT = 50;
const NAV_KEY = "icd-usage-nav";
const ROUTE_HINT_KEY = "icd-usage-handoff";
const NAV_TTL_MS = 15_000;
const ROUTE_HINT_TTL_MS = 60_000;

const state: State = {
  mode: "unknown",
  sink: null,
  pending: [],
  pendingSince: 0,
  page: null,
  tab: null,
  entities: new Map(),
  emittedViews: new Set(),
};

function mode(): Mode {
  if (state.mode === "unknown" && typeof window !== "undefined") {
    state.mode = isUsageExcluded() || cachedUsageEnabled() === false ? "off" : "pending";
    state.pendingSince = performance.now();
    if (state.mode === "pending") window.addEventListener("pagehide", flushPendingOnLeave, { once: true });
  }
  return state.mode;
}

/**
 * 수집기를 불러오기 전(보통 1~2초)에 화면을 떠나면, 이번 화면의 대기 이벤트를 그대로 보낸다.
 * 같은 탭에서 수집이 켜져 있다고 이미 확인한 경우에만 보낸다(꺼져 있거나 모르면 보내지 않고 버린다).
 */
function flushPendingOnLeave(): void {
  if (state.mode !== "pending" || state.pending.length === 0 || cachedUsageEnabled() !== true || isUsageExcluded()) return;
  const events = state.pending.splice(0, MAX_EVENTS_PER_REQUEST);
  try {
    void fetch("/api/usage/collect", {
      method: "POST",
      keepalive: true,
      cache: "no-store",
      credentials: "same-origin",
      referrerPolicy: "origin",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ v: USAGE_SCHEMA_VERSION, p: USAGE_POLICY_VERSION, events }),
    }).catch(() => undefined);
  } catch {
    // 보내지 못하면 버린다.
  }
}

function emit(event: UsageEventBody): void {
  const current = mode();
  if (current === "on" && state.sink) {
    state.sink.send(event);
  } else if (current === "pending" && state.pending.length < PENDING_LIMIT) {
    state.pending.push(event);
  }
}

export function isUsageActive(): boolean {
  const current = mode();
  return current === "on" || current === "pending";
}

/** 16바이트 무작위 값(base64url 22자). 한 화면·한 검색·한 작업에만 쓰는 임시 ID다. */
export function newUsageId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function screenType(): ScreenType {
  const width = window.innerWidth;
  if (width < 768) return "mobile";
  if (width < 1200) return "tablet";
  return "desktop";
}

// ---- 수집기 연결 ----

export interface UsageContext {
  readonly page: PageCode | null;
  readonly tab: TabCode | null;
  readonly entities: ReadonlyMap<string, { kind: EntityKind; key: string }>;
  /** 화면을 연 때부터 수집 대상이었으면 그 시각(performance.now). 화면 도중 다시 포함했으면 null. */
  readonly measuredSince: number | null;
}

/** 수집기를 붙인다. 대기 중이던 이번 화면의 이벤트를 넘기고, 현재 화면 맥락으로 측정을 시작한다. */
export function attachUsageSink(sink: UsageSink): { context: UsageContext; backlog: UsageEventBody[] } {
  const wasPending = mode() === "pending";
  const backlog = wasPending ? state.pending.splice(0) : [];
  state.pending = [];
  state.mode = "on";
  state.sink = sink;
  return {
    backlog,
    context: { page: state.page, tab: state.tab, entities: state.entities, measuredSince: wasPending ? state.pendingSince : null },
  };
}

/** 수집기를 뗀다(통계에서 빼기, 수집 중지). 대기 이벤트도 버린다. */
export function detachUsageSink(nextMode: "off" | "pending" = "off"): void {
  state.sink = null;
  state.pending = [];
  state.mode = nextMode;
  if (nextMode === "pending") state.pendingSince = performance.now();
  clearUsageMarkers();
}

export function clearUsageMarkers(): void {
  try {
    window.sessionStorage.removeItem(NAV_KEY);
    window.localStorage.removeItem(ROUTE_HINT_KEY);
  } catch {
    // 무시
  }
}

export function isUsageComposing(): boolean {
  return state.sink?.isComposing() ?? false;
}

// ---- 화면·탭 ----

const NAV_TABS: Record<string, TabCode> = {
  "/": "dashboard_search",
  "/wiki": "wiki",
  "/welfare100": "welfare100",
  "/mindmap": "mindmap",
  "/news": "news",
  "/budget": "budget",
  "/law": "law",
  "/sources": "sources",
};

/** 상단 메뉴를 누를 때. 다음 화면이 '이용자가 고른 탭'인지, 지금 탭을 다시 누른 것인지 알려 준다. */
export function markUsageNavigation(href: string, current: boolean): void {
  if (!isUsageActive()) return;
  const tab = NAV_TABS[href];
  if (!tab) return;
  try {
    window.sessionStorage.setItem(NAV_KEY, JSON.stringify({ tab, current, at: Date.now() }));
  } catch {
    // 무시
  }
}

function consumeNavigation(tab: TabCode): "initial" | "selected" | "reclick" {
  try {
    const raw = window.sessionStorage.getItem(NAV_KEY);
    if (!raw) return "initial";
    window.sessionStorage.removeItem(NAV_KEY);
    const marker = JSON.parse(raw) as { tab?: string; current?: boolean; at?: number };
    if (marker.tab !== tab || typeof marker.at !== "number" || Date.now() - marker.at > NAV_TTL_MS) return "initial";
    return marker.current ? "reclick" : "selected";
  } catch {
    return "initial";
  }
}

/** 같은 탭 안에서 다른 화면으로 옮겨 갈 때(WIKI 목록 → 사업, 복지제도 목록 → 상세). 다음 화면에서 탭 열람을 다시 세지 않는다. */
export function markUsageInternalNavigation(tab: TabCode): void {
  if (!isUsageActive()) return;
  try {
    window.sessionStorage.setItem(NAV_KEY, JSON.stringify({ tab, current: true, at: Date.now() }));
  } catch {
    // 무시
  }
}

/** 공개 화면이 처음 표시될 때 한 번. 같은 화면에서 다시 불려도(개발 모드 이중 실행) 한 번만 센다. */
export function usagePage(page: PageCode, tab: TabCode): void {
  if (state.page) return;
  state.page = page;
  state.tab = tab;
  if (!isUsageActive()) return;
  const entry = consumeNavigation(tab);
  emit({ type: "page_view", id: newUsageId(), page, screen: screenType() });
  if (entry !== "reclick") emit({ type: "tab_view", id: newUsageId(), tab, entry });
  state.sink?.setTab(tab);
}

/** 화면 안의 탭 전환(대시보드 검색 결과 ↔ 지자체 비교). 지금 탭을 다시 누르면 세지 않는다. */
export function usageTab(tab: TabCode): void {
  if (state.tab === tab) return;
  state.tab = tab;
  if (!isUsageActive()) return;
  emit({ type: "tab_view", id: newUsageId(), tab, entry: "selected" });
  state.sink?.setTab(tab);
}

// ---- 사업·제도 상세 ----

/**
 * 상세가 실제로 표시됐을 때. viewId는 그 표시 한 번(열람 수명주기)에 한 번 만들어 유지한다.
 * 같은 viewId로 다시 불리면(재렌더링·개발 모드 이중 실행) 열람을 다시 세지 않는다.
 */
export function usageEntityOpen(viewId: string, kind: EntityKind, key: string, route: ViewRoute, search?: string): void {
  state.entities.set(viewId, { kind, key });
  if (!isUsageActive()) return;
  if (!state.emittedViews.has(viewId)) {
    state.emittedViews.add(viewId);
    emit(route === "search" && search ? { type: "entity_view", id: viewId, kind, key, route, search } : { type: "entity_view", id: viewId, kind, key, route });
  }
  state.sink?.openEntity(viewId, kind, key);
}

export function usageEntityClose(viewId: string): void {
  state.entities.delete(viewId);
  state.sink?.closeEntity(viewId);
}

/** 목록·검색 결과에서 상세로 옮겨 갈 때(새 창 포함) 진입 경로를 60초 동안 넘긴다. */
export function setUsageHandoff(kind: EntityKind, key: string, route: ViewRoute, search?: string): void {
  if (!isUsageActive()) return;
  try {
    window.localStorage.setItem(ROUTE_HINT_KEY, JSON.stringify({ kind, key, route, search: search ?? "", at: Date.now() }));
  } catch {
    // 무시
  }
}

export function takeUsageHandoff(kind: EntityKind, keys: readonly string[]): { route: ViewRoute; search?: string } {
  try {
    const raw = window.localStorage.getItem(ROUTE_HINT_KEY);
    if (!raw) return { route: "direct" };
    const handoff = JSON.parse(raw) as { kind?: string; key?: string; route?: ViewRoute; search?: string; at?: number };
    if (handoff.kind !== kind || !keys.includes(handoff.key ?? "")) return { route: "direct" };
    window.localStorage.removeItem(ROUTE_HINT_KEY);
    if (typeof handoff.at !== "number" || Date.now() - handoff.at > ROUTE_HINT_TTL_MS) return { route: "direct" };
    const route = handoff.route === "search" || handoff.route === "list" || handoff.route === "compare" ? handoff.route : "direct";
    return route === "search" && handoff.search ? { route, search: handoff.search } : { route };
  } catch {
    return { route: "direct" };
  }
}

// ---- 검색·탐색·기능·품질 ----

export interface SearchUsageInput {
  readonly scope: SearchScope;
  readonly failed: boolean;
  readonly count: number;
  readonly match: { readonly status: MatchState; readonly key?: string } | null;
}

/** 확정된 검색 1회. 검색 ID(이 검색과 이어지는 상세 열람을 잇는 임시 ID)를 돌려준다. 수집 중이 아니면 undefined. */
export function usageSearch(input: SearchUsageInput): string | undefined {
  if (!isUsageActive()) return undefined;
  const search = newUsageId();
  const match = input.failed ? "unmatched" : input.match?.status ?? "unmatched";
  const event: UsageEventBody = {
    type: "search",
    id: newUsageId(),
    search,
    scope: input.scope,
    status: input.failed ? "error" : "ok",
    results: input.failed ? "0" : resultBucket(input.count),
    match,
  };
  if (match === "matched" && input.match?.key) event.key = input.match.key;
  emit(event);
  return search;
}

export function usageFilter(filter: FilterKind, code: string): void {
  if (!code || !isUsageActive()) return;
  emit({ type: "filter", id: newUsageId(), filter, code });
}

export interface UsageActionHandle {
  success(ms?: number): void;
  failure(code: ErrorCode, ms?: number): void;
  cancel(): void;
}

const NOOP_ACTION: UsageActionHandle = { success() {}, failure() {}, cancel() {} };

/** 비교·CSV·공유처럼 시작과 결과가 있는 기능. 결과는 한 번만 보낸다. */
export function startUsageAction(action: ActionCode): UsageActionHandle {
  if (!isUsageActive()) return NOOP_ACTION;
  const op = newUsageId();
  let done = false;
  emit({ type: "action", id: newUsageId(), action, outcome: "start", op });
  const finish = (outcome: "success" | "failure" | "cancel", ms?: number, code?: ErrorCode) => {
    if (done) return;
    done = true;
    const event: UsageEventBody = { type: "action", id: newUsageId(), action, outcome, op };
    if (code) event.error = code;
    if (ms !== undefined && outcome !== "cancel") event.ms = Math.max(0, Math.min(600_000, Math.round(ms)));
    emit(event);
  };
  return {
    success: (ms) => finish("success", ms),
    failure: (code, ms) => finish("failure", ms, code),
    cancel: () => finish("cancel"),
  };
}

/** 클릭만 세는 기능(WIKI→복지제도100 바로가기, 마인드맵 마디 선택, 복지뉴스 원문 보기, 복지예산 조회). */
export function usageClick(action: "wiki_welfare100" | "mindmap_select" | "news_original" | "budget_query"): void {
  if (!isUsageActive()) return;
  emit({ type: "action", id: newUsageId(), action, outcome: "click" });
}

export function usagePerf(metric: Exclude<PerfMetric, "lcp" | "cls">, ms: number): void {
  if (!isUsageActive() || !Number.isFinite(ms) || ms < 0) return;
  emit({ type: "perf", id: newUsageId(), metric, value: Math.min(600_000, Math.round(ms)) });
}

/** 웹 성능 지표(LCP·CLS). 수집기가 부른다. */
export function usageVital(metric: "lcp" | "cls", value: number): void {
  if (!state.page || !isUsageActive() || !Number.isFinite(value) || value < 0) return;
  emit({ type: "perf", id: newUsageId(), metric, value: metric === "cls" ? Math.min(10, Number(value.toFixed(3))) : Math.min(600_000, Math.round(value)), page: state.page });
}

export function usageError(op: ErrorOp, code: ErrorCode): void {
  if (!isUsageActive()) return;
  emit({ type: "error", id: newUsageId(), op, code });
}

/** 오류를 등록된 오류 코드로만 바꾼다(메시지 원문은 보내지 않는다). */
export function usageErrorCode(error: unknown): ErrorCode {
  if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) return "timeout";
  if (error instanceof SyntaxError) return "parse";
  if (error instanceof TypeError) return "network";
  const status = error instanceof Error ? /\b([45]\d\d)\b/.exec(error.message)?.[1] : undefined;
  if (status === "404") return "not_found";
  if (status?.startsWith("4")) return "http_4xx";
  if (status?.startsWith("5")) return "http_5xx";
  return "unknown";
}
