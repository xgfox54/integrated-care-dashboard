import type { SqlDatabase } from "../sql-database.ts";
import { collectPressSource, type CollectDeps, type CollectSummary } from "./collect.ts";
import { crawlerEnabled } from "./operations.ts";
import { listDueSources, type PressSource } from "./store.ts";

// 정기 수집 실행(작업지시서 2026-10-08 P0). 이 호스팅은 예약 작업(scheduled)을 실행하지 않으므로,
// 등록된 수집 PC의 예약 작업이 인증된 경로(/api/press/tick)로 이 함수를 불러 서버 직접 수집 대기열을 처리한다.
// 방문 요청 뒤 백그라운드 수집과 같은 Source 실행권·같은 호스트 실행권(동시 1건, 요청 간격 3초 이상)을 쓰므로
// 여러 PC·방문 요청이 겹쳐도 같은 Source를 두 번 수집하거나 같은 기관 서버에 동시에 요청하지 않는다.

export const SCHEDULER_SIGNAL_KEY = "press_scheduler_signal";
/** 한 번 부를 때 쓰는 전체 시간(초). 마지막 상태 기록·실행권 반납 시간을 남긴다. */
export const TICK_BUDGET_SECONDS = 25;
/** 서로 다른 기관 서버를 동시에 처리하는 최대 수. 같은 서버는 실행권으로 한 번에 하나만. */
export const TICK_CONCURRENCY = 6;
/** 한 번 부를 때 처리하는 최대 Source 수. */
export const TICK_MAX_SOURCES = 12;
/** 새 묶음을 시작하려면 남아 있어야 하는 시간(robots 확인 + 요청 간격 3초 + 목록 요청). */
const MIN_ROUND_SECONDS = 16;
const DUE_LOOKAHEAD = 60;

export type TickStatus = "PROCESSED" | "NO_WORK" | "CRAWLER_DISABLED";

export interface TickSourceResult {
  readonly sourceId: string;
  readonly status: CollectSummary["status"];
  readonly errorCode: string;
  readonly httpStatus: number;
  readonly created: number;
  readonly feedItems: number;
  readonly coverageNote: string;
}

export interface TickResult {
  readonly status: TickStatus;
  readonly by: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly attempted: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly deferred: number;
  readonly created: number;
  /** 이 호출이 끝난 시점에 아직 수집 시각이 지난 서버 직접 수집 Source 수(실행권·보류 제외). */
  readonly remainingDue: number;
  readonly oldestDueAt: number | null;
  readonly sources: readonly TickSourceResult[];
}

export interface SchedulerSignal {
  readonly lastTickAt: number;
  readonly by: string;
  readonly status: TickStatus;
  readonly attempted: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly deferred: number;
  readonly remainingDue: number;
  readonly lastWorkAt: number | null;
}

function hostOf(source: PressSource): string {
  return new URL(source.endpointUrl).hostname.toLowerCase();
}

/**
 * 이번 묶음에 처리할 Source. 정기 회차 작업(연속 실패 0)을 재시도보다 먼저 두어, 실패가 반복되는 Source가
 * 정상 Source의 회차를 밀어내지 않게 한다. 같은 호스트는 한 묶음에 하나만 넣는다.
 */
export function pickTickBatch(
  due: readonly (PressSource & { readonly retrying?: boolean })[], limit: number, skip: ReadonlySet<string>, busyHosts: ReadonlySet<string> = new Set(),
): PressSource[] {
  const ordered = [...due.filter((source) => !source.retrying), ...due.filter((source) => source.retrying)];
  const hosts = new Set<string>();
  const batch: PressSource[] = [];
  for (const source of ordered) {
    if (batch.length >= limit) break;
    if (skip.has(source.sourceId)) continue;
    const host = hostOf(source);
    // 다른 실행이 쓰고 있거나 요청 간격(3초 이상)이 아직 지나지 않은 호스트는 이번 묶음에 넣지 않고 다음 호출로 넘긴다.
    if (hosts.has(host) || busyHosts.has(host)) continue;
    hosts.add(host);
    batch.push(source);
  }
  return batch;
}

async function busyHostsAt(db: SqlDatabase, nowSeconds: number): Promise<Set<string>> {
  const rows = await db.prepare("SELECT host FROM press_host_lease WHERE lease_expires_at > ?").bind(nowSeconds).all<{ host: string }>();
  return new Set(rows.results.map((row) => row.host.toLowerCase()));
}

async function retryingIds(db: SqlDatabase, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const marks = ids.map(() => "?").join(", ");
  const rows = await db.prepare("SELECT source_id FROM press_crawl_state WHERE consecutive_failures > 0 AND source_id IN (" + marks + ")").bind(...ids).all<{ source_id: string }>();
  return new Set(rows.results.map((row) => row.source_id));
}

async function dueBacklog(db: SqlDatabase, nowSeconds: number): Promise<{ readonly count: number; readonly oldest: number | null }> {
  const row = await db.prepare(
    "SELECT COUNT(*) AS n, MIN(COALESCE(c.next_due_at, 0)) AS oldest FROM press_source s LEFT JOIN press_crawl_state c ON c.source_id = s.source_id " +
      "WHERE s.collect_via = 'server' AND s.enabled = 1 AND s.approval_status = 'POLICY_APPROVED' AND COALESCE(c.next_due_at, 0) <= ? " +
      "AND (COALESCE(c.collection_hold, '') = '' OR (c.hold_until IS NOT NULL AND c.hold_until <= ?))",
  ).bind(nowSeconds, nowSeconds).first<{ n: number; oldest: number | null }>();
  const count = Number(row?.n ?? 0);
  return { count, oldest: count > 0 ? Number(row?.oldest ?? 0) : null };
}

export async function readSchedulerSignal(db: SqlDatabase): Promise<SchedulerSignal | null> {
  const row = await db.prepare("SELECT value FROM app_setting WHERE key = ?").bind(SCHEDULER_SIGNAL_KEY).first<{ value: string }>();
  if (!row) return null;
  try {
    const value = JSON.parse(row.value) as Partial<SchedulerSignal>;
    return typeof value.lastTickAt === "number" ? value as SchedulerSignal : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeSchedulerSignal(db: SqlDatabase, result: TickResult): Promise<void> {
  const previous = await readSchedulerSignal(db);
  const signal: SchedulerSignal = {
    lastTickAt: result.finishedAt, by: result.by, status: result.status, attempted: result.attempted, succeeded: result.succeeded,
    failed: result.failed, deferred: result.deferred, remainingDue: result.remainingDue,
    lastWorkAt: result.attempted > 0 ? result.finishedAt : previous?.lastWorkAt ?? null,
  };
  await db.prepare("INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(SCHEDULER_SIGNAL_KEY, JSON.stringify(signal), result.finishedAt).run();
}

function classify(summary: CollectSummary): "succeeded" | "failed" | "deferred" {
  if (summary.status === "succeeded" || summary.status === "not_modified") return "succeeded";
  if (summary.status === "failed") return "failed";
  return "deferred";
}

/**
 * 수집 시각이 지난 서버 직접 수집 Source를 서로 다른 호스트끼리 제한된 수만큼 동시에 처리한다.
 * 대기열이 비어 있으면 NO_WORK로만 기록하고, 마지막 수집 성공 시각이나 미해결 오류는 건드리지 않는다.
 */
export async function runPressTick(
  db: SqlDatabase, by: string, makeDeps: (deadlineAt: number) => CollectDeps, now: () => number,
  options: { readonly budgetSeconds?: number; readonly concurrency?: number; readonly maxSources?: number } = {},
): Promise<TickResult> {
  const startedAt = now();
  const deadlineAt = startedAt + (options.budgetSeconds ?? TICK_BUDGET_SECONDS);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? TICK_CONCURRENCY, TICK_CONCURRENCY));
  const maxSources = Math.max(1, Math.min(options.maxSources ?? TICK_MAX_SOURCES, TICK_MAX_SOURCES));
  const summaries: CollectSummary[] = [];
  let status: TickStatus = "NO_WORK";
  if (!(await crawlerEnabled(db))) {
    status = "CRAWLER_DISABLED";
  } else {
    const tried = new Set<string>();
    while (summaries.length < maxSources && now() + MIN_ROUND_SECONDS <= deadlineAt) {
      const due = await listDueSources(db, now(), DUE_LOOKAHEAD);
      const retrying = await retryingIds(db, due.map((source) => source.sourceId));
      const busy = await busyHostsAt(db, now());
      const batch = pickTickBatch(due.map((source) => ({ ...source, retrying: retrying.has(source.sourceId) })), Math.min(concurrency, maxSources - summaries.length), tried, busy);
      if (batch.length === 0) break;
      for (const source of batch) tried.add(source.sourceId);
      const deps = makeDeps(deadlineAt);
      summaries.push(...await Promise.all(batch.map((source) => collectPressSource(db, { source, trigger: "scheduled" }, deps))));
    }
    if (summaries.length > 0) status = "PROCESSED";
  }
  const backlog = await dueBacklog(db, now());
  const counts = { succeeded: 0, failed: 0, deferred: 0 };
  for (const summary of summaries) counts[classify(summary)] += 1;
  const result: TickResult = {
    status, by, startedAt, finishedAt: now(), attempted: summaries.length, ...counts,
    created: summaries.reduce((sum, summary) => sum + summary.counts.created, 0),
    remainingDue: backlog.count, oldestDueAt: backlog.oldest,
    sources: summaries.map((summary) => ({
      sourceId: summary.sourceId, status: summary.status, errorCode: summary.errorCode, httpStatus: summary.httpStatus,
      created: summary.counts.created, feedItems: summary.counts.feedItems, coverageNote: summary.coverageNote ?? "",
    })),
  };
  await writeSchedulerSignal(db, result);
  return result;
}
