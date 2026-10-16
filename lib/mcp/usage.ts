import { z } from "zod";
import { databaseIdentity, type SqlDatabase } from "../sql-database.ts";
import { PUBLIC_MCP_TOOL_NAMES } from "./contract.ts";

export interface McpCacheDetail {
  readonly status: "HIT" | "MISS" | "NOT_STORED" | "ERROR" | "BYPASS";
  readonly layer?: string | null;
  readonly lookup?: string | null;
  readonly reason?: string | null;
}
export interface McpToolObservation {
  readonly arguments?: unknown;
  readonly response?: unknown;
  readonly requestId?: string;
  readonly callId?: string;
  readonly tool: string;
  readonly durationMs: number;
  readonly failed: boolean;
  readonly cache?: "HIT" | "MISS";
  readonly cacheDetail?: McpCacheDetail;
  readonly cacheWrite?: Promise<string>;
}
export type McpRoute = "/mcp" | "/claude/mcp";
export interface McpUsageObservation extends McpToolObservation {
  readonly route: McpRoute;
  readonly rateLimited?: boolean;
}

const CACHE_COUNTERS = ["cache_hit_memory", "cache_hit_d1", "cache_expired", "cache_not_stored", "cache_errors", "cache_bypass", "cache_write_ok", "cache_write_errors"] as const;
const COUNTERS = ["calls", "errors", "rate_limited", "cache_hits", "cache_misses", "duration_ms", "max_ms", "le100", "le500", "le1000", "le3000", "le10000", "gt10000", ...CACHE_COUNTERS] as const;
type Counter = (typeof COUNTERS)[number];
const count = z.number().nonnegative();
export const McpUsageRowSchema = z.object({
  hour_start: count, route: z.string(), tool: z.string(), calls: count, errors: count,
  rate_limited: count, cache_hits: count, cache_misses: count, duration_ms: count, max_ms: count,
  le100: count, le500: count, le1000: count, le3000: count, le10000: count, gt10000: count,
  ...Object.fromEntries(CACHE_COUNTERS.map((field) => [field, count.default(0)])) as Record<(typeof CACHE_COUNTERS)[number], z.ZodDefault<z.ZodNumber>>,
});
export const McpUsageReportSchema = z.object({
  days: z.number(), from: z.number(), generated_at: z.number(), rows: z.array(McpUsageRowSchema),
});
export type McpUsageRow = z.infer<typeof McpUsageRowSchema>;
export type McpUsageReport = z.infer<typeof McpUsageReportSchema>;

type BufferState = { readonly rows: Map<string, McpUsageRow>; flushing?: Promise<void> };
const buffers = new WeakMap<object, BufferState>();
function buffer(db: SqlDatabase): BufferState {
  const identity = databaseIdentity(db);
  let state = buffers.get(identity);
  if (!state) { state = { rows: new Map() }; buffers.set(identity, state); }
  return state;
}

function publicTool(tool: string): string {
  return tool === "__request__" ? tool : PUBLIC_MCP_TOOL_NAMES.includes(tool as (typeof PUBLIC_MCP_TOOL_NAMES)[number]) ? tool : "__unknown__";
}

function mergeRow(rows: Map<string, McpUsageRow>, hour: number, route: string, tool: string, increments: Partial<Record<Counter, number>>): void {
  const key = [hour, route, tool].join(":");
  const current = rows.get(key) ?? McpUsageRowSchema.parse({ hour_start: hour, route, tool, ...Object.fromEntries(COUNTERS.map((field) => [field, 0])) });
  const next: McpUsageRow = { ...current };
  for (const field of COUNTERS) {
    const value = increments[field] ?? 0;
    next[field] = field === "max_ms" ? Math.max(current.max_ms, value) : current[field] + value;
  }
  rows.set(key, next);
}

function cacheIncrements(observation: McpToolObservation): Partial<Record<Counter, number>> {
  const detail = observation.cacheDetail;
  const status = detail?.status ?? observation.cache;
  if (!status) return {};
  const missed = status === "MISS" || status === "NOT_STORED" || status === "ERROR";
  return {
    cache_hits: Number(status === "HIT"), cache_misses: Number(missed),
    cache_hit_memory: Number(status === "HIT" && detail?.layer === "memory"), cache_hit_d1: Number(status === "HIT" && detail?.layer === "d1"),
    cache_expired: Number(missed && detail?.lookup === "expired"), cache_not_stored: Number(status === "NOT_STORED"),
    cache_errors: Number(status === "ERROR"), cache_bypass: Number(status === "BYPASS"),
  };
}

export function recordMcpUsage(db: SqlDatabase, observation: McpUsageObservation, now = Date.now()): void {
  const duration = Number.isFinite(observation.durationMs) ? Math.max(0, Math.round(observation.durationMs)) : 0;
  const bin = duration <= 100 ? "le100" : duration <= 500 ? "le500" : duration <= 1000 ? "le1000" : duration <= 3000 ? "le3000" : duration <= 10000 ? "le10000" : "gt10000";
  mergeRow(buffer(db).rows, Math.floor(now / 3_600_000) * 3600, observation.route, publicTool(observation.tool), {
    calls: 1, errors: Number(observation.failed), rate_limited: Number(Boolean(observation.rateLimited)),
    duration_ms: duration, max_ms: duration, [bin]: 1, ...cacheIncrements(observation),
  });
}

export function recordMcpCacheWrite(db: SqlDatabase, write: { readonly route: McpRoute; readonly tool: string; readonly outcome: string }, now = Date.now()): void {
  const stored = write.outcome === "stored";
  const failed = write.outcome.startsWith("failed");
  if (!stored && !failed) return;
  mergeRow(buffer(db).rows, Math.floor(now / 3_600_000) * 3600, write.route, publicTool(write.tool), { cache_write_ok: Number(stored), cache_write_errors: Number(failed) });
}

export function flushMcpUsage(db: SqlDatabase, delayMs = 3000): Promise<void> {
  const state = buffer(db);
  if (state.flushing) return state.flushing;
  state.flushing = (async () => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    for (let pass = 0; pass < 2 && state.rows.size; pass += 1) {
      const rows = [...state.rows.values()];
      state.rows.clear();
      try {
        await db.batch(rows.map((row) => db.prepare(
          "INSERT INTO mcp_usage_hourly (hour_start, route, tool, " + COUNTERS.join(", ") + ") VALUES (" + Array.from({ length: COUNTERS.length + 3 }, () => "?").join(", ") + ") ON CONFLICT(hour_start, route, tool) DO UPDATE SET " + COUNTERS.map((field) => field === "max_ms" ? "max_ms = MAX(max_ms, excluded.max_ms)" : field + " = " + field + " + excluded." + field).join(", "),
        ).bind(row.hour_start, row.route, row.tool, ...COUNTERS.map((field) => row[field]))));
      } catch (error) {
        for (const row of rows) mergeRow(state.rows, row.hour_start, row.route, row.tool, row);
        console.error("mcp usage aggregation failed", error instanceof Error ? error.name : "UnknownError");
        break;
      }
    }
  })().finally(() => { state.flushing = undefined; });
  return state.flushing;
}

export async function readMcpUsage(db: SqlDatabase, days: number, now = Date.now()): Promise<McpUsageReport> {
  const from = Math.floor((now + 9 * 3_600_000) / 86_400_000) * 86400 - 9 * 3600 - (days - 1) * 86400;
  const rows = await db.prepare("SELECT * FROM mcp_usage_hourly WHERE hour_start >= ? AND hour_start <= ? ORDER BY hour_start, route, tool").bind(from, Math.floor(now / 1000)).all<McpUsageRow>();
  return McpUsageReportSchema.parse({ days, from, generated_at: Math.floor(now / 1000), rows: rows.results });
}

export async function pruneMcpUsage(db: SqlDatabase, now = Date.now()): Promise<void> {
  await db.prepare("DELETE FROM mcp_usage_hourly WHERE hour_start < ?").bind(Math.floor(now / 1000) - 90 * 86400).run();
}

export function summarizeMcpUsage(rows: readonly McpUsageRow[]) {
  const sum = (field: Counter) => rows.reduce((total, row) => total + row[field], 0);
  const calls = sum("calls");
  const target = Math.ceil(calls * 0.95);
  let cumulative = 0;
  let p95 = "-";
  for (const [field, label] of [["le100", "≤100 ms"], ["le500", "≤500 ms"], ["le1000", "≤1 s"], ["le3000", "≤3 s"], ["le10000", "≤10 s"], ["gt10000", ">10 s"]] as const) {
    cumulative += sum(field);
    if (calls && cumulative >= target) { p95 = label; break; }
  }
  return {
    calls, errors: sum("errors"), rateLimited: sum("rate_limited"), hits: sum("cache_hits"), misses: sum("cache_misses"),
    memoryHits: sum("cache_hit_memory"), d1Hits: sum("cache_hit_d1"), expired: sum("cache_expired"), notStored: sum("cache_not_stored"),
    cacheErrors: sum("cache_errors"), bypass: sum("cache_bypass"), writeOk: sum("cache_write_ok"), writeErrors: sum("cache_write_errors"),
    meanMs: calls ? Math.round(sum("duration_ms") / calls) : 0, maxMs: Math.max(0, ...rows.map((row) => row.max_ms)), p95,
  };
}
