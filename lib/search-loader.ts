import { normalizeRows, type DataState, type ServiceRow } from "./dataset";
import type { SearchAggregates, SearchNameMatch } from "./official-query";
import type { SearchHelp } from "./search-terms";

export interface LoadedSearch {
  readonly state: DataState;
  readonly fetchedAt: string;
  readonly dataAsOf: string;
  readonly rows: ServiceRow[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly regionCounts: Readonly<Record<string, number>>;
  readonly categoryCounts: Readonly<Record<string, number>>;
  readonly regionSummary: SearchAggregates;
  /** 검색어가 있을 때만: 검색 범위 안 사업명과 정확히 일치하는지(이용통계용). */
  readonly nameMatch?: SearchNameMatch;
  /** 검색어가 있는데 0건일 때만: 오타 제안, 단어를 하나씩 뺀 결과 수. */
  readonly searchHelp?: SearchHelp;
}

interface SearchPayload extends Omit<LoadedSearch, "rows"> {
  readonly rows: unknown;
}

interface BundlePayload {
  readonly entries?: readonly { readonly query: string; readonly body: SearchPayload }[];
}

export interface LoadProgress {
  /** Changes whenever any result arrives, so readers re-render. */
  readonly version: number;
  readonly done: number;
  readonly total: number;
}

/** 미리받기 요청 하나. 검색 한 건이거나 여러 지역을 담은 묶음이다. */
export interface BackgroundTask {
  readonly url: string;
  /** 이 요청이 채우는 검색 질의(검색 API 질의 문자열). */
  readonly queries: readonly string[];
}

const SEARCH_PATH = "/api/dataset/search?";
const BUNDLE_PATH = "/api/dataset/bundle?";
const BACKGROUND_CONCURRENCY = 2;
const REQUEST_TIMEOUT_MS = 30_000;

export function searchTask(query: string): BackgroundTask {
  return { url: SEARCH_PATH + query, queries: [query] };
}

export function bundleTask(bundleQuery: string, queries: readonly string[]): BackgroundTask {
  return { url: BUNDLE_PATH + bundleQuery, queries };
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { cache: "default", signal: controller.signal });
    if (!response.ok) throw new Error(`검색 응답 오류: ${response.status}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function toLoaded(payload: SearchPayload): LoadedSearch {
  return { ...payload, rows: normalizeRows(payload.rows) };
}

/**
 * Loads search result pages with two lanes. Priority requests (what the user
 * is looking at) start immediately; background requests follow the planned
 * region order and wait while any priority request is running. Background
 * requests are region bundles, so the whole country takes about a dozen
 * requests instead of one per region.
 */
class SearchLoader {
  private readonly results = new Map<string, LoadedSearch>();
  private readonly running = new Map<string, Promise<LoadedSearch>>();
  /** 미리받기로 받는 중인 검색 질의. 계획을 새로 세워도 다시 요청하지 않는다. */
  private readonly backgroundQueries = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private queue: BackgroundTask[] = [];
  private planned: string[] = [];
  private priorityRunning = 0;
  private backgroundRunning = 0;
  private progress: LoadProgress = { version: 0, done: 0, total: 0 };

  peek(query: string): LoadedSearch | undefined {
    return this.results.get(query);
  }

  getProgress = (): LoadProgress => this.progress;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Load now, ahead of everything waiting in the background queue. */
  load(query: string): Promise<LoadedSearch> {
    const done = this.results.get(query);
    if (done) return Promise.resolve(done);
    const inFlight = this.running.get(query);
    if (inFlight) return inFlight;
    this.priorityRunning += 1;
    const task = fetchJson<SearchPayload>(SEARCH_PATH + query)
      .then((payload) => {
        const result = toLoaded(payload);
        this.results.set(query, result);
        return result;
      })
      .finally(() => {
        this.running.delete(query);
        this.priorityRunning -= 1;
        this.updateProgress();
        this.pump();
      });
    this.running.set(query, task);
    return task;
  }

  /** Replace the background queue with a new ordered plan. */
  plan(tasks: readonly BackgroundTask[]): void {
    this.planned = [...new Set(tasks.flatMap((task) => task.queries))];
    this.queue = tasks.filter((task) => task.queries.some((query) => !this.isCovered(query)));
    this.updateProgress();
    this.pump();
  }

  private isCovered(query: string): boolean {
    return this.results.has(query) || this.running.has(query) || this.backgroundQueries.has(query);
  }

  private releaseBackground(task: BackgroundTask): void {
    for (const query of task.queries) this.backgroundQueries.delete(query);
  }

  private runBackground(task: BackgroundTask): void {
    this.backgroundRunning += 1;
    for (const query of task.queries) this.backgroundQueries.add(query);
    const work = task.url.startsWith(SEARCH_PATH)
      ? fetchJson<SearchPayload>(task.url).then((payload) => {
          if (!this.results.has(task.queries[0])) this.results.set(task.queries[0], toLoaded(payload));
        })
      : fetchJson<BundlePayload>(task.url).then((payload) => {
          for (const entry of payload.entries ?? []) {
            if (!this.results.has(entry.query)) this.results.set(entry.query, toLoaded(entry.body));
          }
          this.releaseBackground(task);
          // 서버의 지역 목록이 화면과 달라 묶음에 빠진 지역은 하나씩 이어 받는다.
          const missing = task.queries.filter((query) => this.planned.includes(query) && !this.isCovered(query));
          this.queue.push(...missing.map(searchTask));
        });
    work
      // Background failures are skipped; the region loads again on demand.
      .catch(() => undefined)
      .finally(() => {
        this.releaseBackground(task);
        this.backgroundRunning -= 1;
        this.updateProgress();
        this.pump();
      });
  }

  private pump(): void {
    while (
      this.priorityRunning === 0 &&
      this.backgroundRunning < BACKGROUND_CONCURRENCY &&
      this.queue.length > 0
    ) {
      const task = this.queue.shift()!;
      if (task.queries.every((query) => this.isCovered(query))) continue;
      this.runBackground(task);
    }
  }

  private updateProgress(): void {
    const done = this.planned.filter((query) => this.results.has(query)).length;
    this.progress = { version: this.progress.version + 1, done, total: this.planned.length };
    for (const listener of this.listeners) listener();
  }
}

export const searchLoader = new SearchLoader();

const SERVER_PROGRESS: LoadProgress = { version: 0, done: 0, total: 0 };
export const getServerProgress = (): LoadProgress => SERVER_PROGRESS;
