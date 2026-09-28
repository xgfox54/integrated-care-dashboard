// 수집 요청 본문 검증. 이벤트마다 허용 필드·형식·길이·숫자 범위를 확인하고, 모르는 필드가 하나라도 있으면 그 이벤트를 버린다.
// 이 파일은 요청 원문을 기록하지 않는다.
import {
  ACTION_CODES,
  ACTION_OUTCOMES,
  ENTITY_KINDS,
  ERROR_CODES,
  ERROR_OPS,
  FILTER_KINDS,
  LINK_DESTINATIONS,
  MATCH_STATES,
  MAX_EVENTS_PER_REQUEST,
  MAX_MEASURE_MS,
  PAGE_CODES,
  PERF_METRICS,
  RESULT_BUCKETS,
  SCREEN_TYPES,
  SEARCH_SCOPES,
  SEARCH_STATUSES,
  STAGED_ACTIONS,
  TAB_CODES,
  TAB_ENTRIES,
  TEMP_ID_PATTERN,
  USAGE_POLICY_VERSION,
  USAGE_SCHEMA_VERSION,
  VIEW_ROUTES,
  isOneOf,
  type ActionCode,
  type ActionOutcome,
  type EntityKind,
  type ErrorCode,
  type ErrorOp,
  type FilterKind,
  type LinkDestination,
  type MatchState,
  type PageCode,
  type PerfMetric,
  type ResultBucket,
  type ScreenType,
  type SearchScope,
  type SearchStatus,
  type TabCode,
  type TabEntry,
  type ViewRoute,
} from "./codes.ts";

export type UsageEvent =
  | { type: "page_view"; id: string; page: PageCode; screen: ScreenType }
  | { type: "tab_view"; id: string; tab: TabCode; entry: TabEntry }
  | { type: "entity_view"; id: string; kind: EntityKind; key: string; route: ViewRoute; search?: string }
  | { type: "activity"; id: string; measure: string; tab?: TabCode; kind?: EntityKind; key?: string; ms: number }
  | {
      type: "search";
      id: string;
      search: string;
      scope: SearchScope;
      status: SearchStatus;
      results: ResultBucket;
      match: MatchState;
      key?: string;
    }
  | { type: "filter"; id: string; filter: FilterKind; code: string }
  | {
      type: "action";
      id: string;
      action: ActionCode;
      outcome: ActionOutcome;
      op?: string;
      error?: ErrorCode;
      ms?: number;
      dest?: LinkDestination;
    }
  | { type: "perf"; id: string; metric: PerfMetric; value: number; page?: PageCode }
  | { type: "error"; id: string; op: ErrorOp; code: ErrorCode };

export type UsageEventType = UsageEvent["type"];

const ALLOWED_FIELDS: Record<UsageEventType, readonly string[]> = {
  page_view: ["type", "id", "page", "screen"],
  tab_view: ["type", "id", "tab", "entry"],
  entity_view: ["type", "id", "kind", "key", "route", "search"],
  activity: ["type", "id", "measure", "tab", "kind", "key", "ms"],
  search: ["type", "id", "search", "scope", "status", "results", "match", "key"],
  filter: ["type", "id", "filter", "code"],
  action: ["type", "id", "action", "outcome", "op", "error", "ms", "dest"],
  perf: ["type", "id", "metric", "value", "page"],
  error: ["type", "id", "op", "code"],
};

/** 통합돌봄사업 키(serviceWikiKey 형식): service:서비스ID|시도|시군구|대분류|중분류|사업명, 소문자·숫자·한글만. */
const CARE_KEY_PATTERN = /^service:[0-9a-z\uAC00-\uD7A3]*(\|[0-9a-z\uAC00-\uD7A3]*){5}$/;
/** 복지제도 키: 주요 제도 slug 또는 복지로 서비스 ID. */
const WELFARE_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CARE_KEY_MAX = 400;
const FILTER_CODE_MAX = 80;
const MAX_ACTION_MS = 600_000;
const MAX_PERF_MS = 600_000;
const MAX_CLS = 10;

export function isEntityKey(kind: EntityKind, key: unknown): key is string {
  if (typeof key !== "string") return false;
  if (kind === "care_program") return key.length <= CARE_KEY_MAX && CARE_KEY_PATTERN.test(key);
  return WELFARE_KEY_PATTERN.test(key);
}

function isTempId(value: unknown): value is string {
  return typeof value === "string" && TEMP_ID_PATTERN.test(value);
}

function isWholeNumber(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

export interface UsageEnvelope {
  readonly events: readonly unknown[];
}

/** 본문 전체 형식. 판(v)·정책 판(p)이 다르거나 이벤트 수가 상한을 넘으면 요청 전체를 거절한다. */
export function parseUsageEnvelope(text: string): UsageEnvelope | null {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return null;
  }
  if (!root || typeof root !== "object" || Array.isArray(root)) return null;
  const record = root as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => key !== "v" && key !== "p" && key !== "events")) return null;
  if (record.v !== USAGE_SCHEMA_VERSION || record.p !== USAGE_POLICY_VERSION) return null;
  if (!Array.isArray(record.events) || record.events.length === 0 || record.events.length > MAX_EVENTS_PER_REQUEST) return null;
  return { events: record.events };
}

/** 이벤트 한 건의 형식 검증. 통과하지 못하면 null. 실제 존재 여부(사업·지역 코드)는 집계 단계에서 따로 확인한다. */
export function parseUsageEvent(raw: unknown): UsageEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string" || !(type in ALLOWED_FIELDS)) return null;
  const allowed = ALLOWED_FIELDS[type as UsageEventType];
  if (Object.keys(record).some((key) => !allowed.includes(key))) return null;
  if (!isTempId(record.id)) return null;
  const id = record.id;

  switch (type as UsageEventType) {
    case "page_view":
      if (!isOneOf(PAGE_CODES, record.page) || !isOneOf(SCREEN_TYPES, record.screen)) return null;
      return { type: "page_view", id, page: record.page, screen: record.screen };
    case "tab_view":
      if (!isOneOf(TAB_CODES, record.tab) || !isOneOf(TAB_ENTRIES, record.entry)) return null;
      return { type: "tab_view", id, tab: record.tab, entry: record.entry };
    case "entity_view": {
      if (!isOneOf(ENTITY_KINDS, record.kind) || !isEntityKey(record.kind, record.key)) return null;
      if (!isOneOf(VIEW_ROUTES, record.route)) return null;
      if (record.search !== undefined && (record.route !== "search" || !isTempId(record.search))) return null;
      const event: UsageEvent = { type: "entity_view", id, kind: record.kind, key: record.key, route: record.route };
      return record.search === undefined ? event : { ...event, search: record.search };
    }
    case "activity": {
      if (!isTempId(record.measure) || !isWholeNumber(record.ms, MAX_MEASURE_MS)) return null;
      const hasTab = record.tab !== undefined;
      const hasEntity = record.kind !== undefined || record.key !== undefined;
      if (hasTab === hasEntity) return null;
      if (hasTab) {
        if (!isOneOf(TAB_CODES, record.tab)) return null;
        return { type: "activity", id, measure: record.measure, tab: record.tab, ms: record.ms };
      }
      if (!isOneOf(ENTITY_KINDS, record.kind) || !isEntityKey(record.kind, record.key)) return null;
      return { type: "activity", id, measure: record.measure, kind: record.kind, key: record.key, ms: record.ms };
    }
    case "search": {
      if (!isTempId(record.search) || !isOneOf(SEARCH_SCOPES, record.scope)) return null;
      if (!isOneOf(SEARCH_STATUSES, record.status) || !isOneOf(RESULT_BUCKETS, record.results)) return null;
      if (!isOneOf(MATCH_STATES, record.match)) return null;
      if (record.status === "error" && (record.results !== "0" || record.match !== "unmatched")) return null;
      const base = {
        type: "search" as const,
        id,
        search: record.search,
        scope: record.scope,
        status: record.status,
        results: record.results,
        match: record.match,
      };
      if (record.match !== "matched") return record.key === undefined ? base : null;
      const kind = record.scope === "welfare_catalog" ? "welfare_policy" : "care_program";
      if (!isEntityKey(kind, record.key)) return null;
      return { ...base, key: record.key };
    }
    case "filter":
      if (!isOneOf(FILTER_KINDS, record.filter)) return null;
      if (typeof record.code !== "string" || record.code.length === 0 || record.code.length > FILTER_CODE_MAX) return null;
      return { type: "filter", id, filter: record.filter, code: record.code };
    case "action": {
      if (!isOneOf(ACTION_CODES, record.action) || !isOneOf(ACTION_OUTCOMES, record.outcome)) return null;
      const action = record.action;
      const outcome = record.outcome;
      if (action === "source_link") {
        if (outcome !== "click" || !isOneOf(LINK_DESTINATIONS, record.dest)) return null;
        if (record.op !== undefined || record.error !== undefined || record.ms !== undefined) return null;
        return { type: "action", id, action, outcome, dest: record.dest };
      }
      if (!STAGED_ACTIONS.includes(action) || outcome === "click" || record.dest !== undefined) return null;
      if (!isTempId(record.op)) return null;
      if (record.error !== undefined && (outcome !== "failure" || !isOneOf(ERROR_CODES, record.error))) return null;
      if (record.ms !== undefined && ((outcome !== "success" && outcome !== "failure") || !isWholeNumber(record.ms, MAX_ACTION_MS))) {
        return null;
      }
      const event: UsageEvent = { type: "action", id, action, outcome, op: record.op };
      return {
        ...event,
        ...(record.error !== undefined ? { error: record.error as ErrorCode } : {}),
        ...(record.ms !== undefined ? { ms: record.ms as number } : {}),
      };
    }
    case "perf": {
      if (!isOneOf(PERF_METRICS, record.metric)) return null;
      const value = record.value;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
      const vital = record.metric === "lcp" || record.metric === "cls";
      if (vital !== (record.page !== undefined)) return null;
      if (vital && !isOneOf(PAGE_CODES, record.page)) return null;
      if (record.metric === "cls") {
        if (value > MAX_CLS) return null;
        return { type: "perf", id, metric: "cls", value: Math.round(value * 1000), page: record.page as PageCode };
      }
      if (value > MAX_PERF_MS) return null;
      const event: UsageEvent = { type: "perf", id, metric: record.metric, value: Math.round(value) };
      return vital ? { ...event, page: record.page as PageCode } : event;
    }
    case "error":
      if (!isOneOf(ERROR_OPS, record.op) || !isOneOf(ERROR_CODES, record.code)) return null;
      return { type: "error", id, op: record.op, code: record.code };
    default:
      return null;
  }
}

/** 같은 이벤트 ID가 다른 내용으로 다시 오는지 가리기 위한 정규 문자열(필드 순서 고정). */
export function canonicalEvent(event: UsageEvent): string {
  const record = event as unknown as Record<string, unknown>;
  return JSON.stringify(Object.keys(record).sort().map((key) => [key, record[key]]));
}

