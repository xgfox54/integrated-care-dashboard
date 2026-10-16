import { z } from "zod";
import type { SqlDatabase } from "../sql-database.ts";
import { REGION_DEFINITIONS } from "../region-statistics.ts";
import { parseSearch } from "../search-terms.ts";
import { PUBLIC_MCP_TOOL_NAMES } from "./contract.ts";
import { refineWelfareQuery } from "./query-refiner.ts";
import type { McpRoute, McpToolObservation } from "./usage.ts";

export const MCP_TRACE_RETENTION_DAYS = 14;
const MAX_REFERENCES = 100;
const CACHE_WRITE_WAIT_MS = 8000;
const PUBLIC_TRACE_REGIONS: ReadonlySet<string> = new Set([
  "region:전국", ...REGION_DEFINITIONS.map((region) => "region:" + region.fullName),
  "region:제주특별자치도|제주시", "region:제주특별자치도|서귀포시",
]);
const TraceYearSchema = z.union([z.number().int(), z.string().regex(/^\d{4}$/).transform(Number)]).pipe(z.number().int().min(1900).max(2200));
const TraceDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const timestamp = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
});
function publicTraceRegion(value: string | null): string | null {
  if (!value) return null;
  if (PUBLIC_TRACE_REGIONS.has(value)) return value;
  const [province, municipality, extra] = value.split("|");
  if (!PUBLIC_TRACE_REGIONS.has(province) || !municipality || extra !== undefined) return null;
  if (!/^[가-힣]{2,20}(시|군|구)$/.test(municipality)) return province;
  const parsed = parseSearch(municipality);
  const term = parsed.terms[0];
  return parsed.terms.length === 1 && term.region && term.plain && !term.negated && term.alternatives.includes(municipality) ? value : province;
}
const TraceRegionsSchema = z.array(z.string().refine((value) => publicTraceRegion(value) === value)).max(10);
const TraceRowSchema = z.object({
  call_id: z.string(), request_id: z.string(), started_at: z.number(), route: z.string(), tool: z.string(),
  failed: z.number(), cache: z.string().nullable(), duration_ms: z.number(), query_hash: z.string().nullable(),
  conditions_json: z.string(), provenance_json: z.string(),
  cache_status: z.string().nullable().default(null), cache_layer: z.string().nullable().default(null), cache_reason: z.string().nullable().default(null),
  cache_write: z.string().nullable().default(null), instance_id: z.string().nullable().default(null), colo: z.string().nullable().default(null),
  edge_probe: z.string().nullable().default(null), d1_statements: z.number().nullable().default(null), d1_rows_read: z.number().nullable().default(null), d1_ms: z.number().nullable().default(null),
});
export const McpTraceReportSchema = z.object({ rows: z.array(TraceRowSchema), retention_days: z.number(), limit: z.number() });
export type McpTraceRow = z.infer<typeof TraceRowSchema>;
export type McpTraceReport = z.infer<typeof McpTraceReportSchema>;
export interface McpTraceContext { readonly requestId: string; readonly callId: string; readonly route: McpRoute; readonly startedAt: number }
export type McpTraceDiagnostics = Pick<McpTraceRow, "instance_id" | "colo" | "edge_probe" | "d1_statements" | "d1_rows_read" | "d1_ms">;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
}

/** Store only public reference fields, never response prose, URLs, or user conditions. */
export function responseProvenance(response: unknown) {
  const references = new Set<string>();
  const versions = new Set<string>();
  let visited = 0;
  let truncated = false;
  function visit(value: unknown, depth: number): void {
    if (visited++ >= 3000 || depth > 12) { truncated = true; return; }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (/^(id|evidence_id|source_id|document_id|document_revision_id|source_version_id|revision|revision_id|release_bundle_id|source_revision|dataset_id|implementation_id|entity_id|manual_id|section_id|chunk_id|corpus_revision|source_commit|manual_revision|gov24_revision|faq_revision|content_sha256|snapshot_id)$/.test(key)
        && typeof child === "string" && /^[\w:./@+\-]{1,200}$/.test(child) && !child.includes("://")) {
        const target = /revision|version|^release_bundle_id$|^source_commit$|^content_sha256$|^snapshot_id$/.test(key) ? versions : references;
        if (target.size < MAX_REFERENCES) target.add(key + "=" + child);
        else truncated = true;
      }
    }
    for (const child of Object.values(value)) if (typeof child === "object") visit(child, depth + 1);
  }
  visit(response, 0);
  return { references: [...versions, ...references].slice(0, MAX_REFERENCES), truncated: truncated || versions.size + references.size > MAX_REFERENCES };
}

export async function createMcpTrace(observation: McpToolObservation, context: McpTraceContext): Promise<McpTraceRow> {
  const args = record(observation.arguments);
  const raw = typeof args.query === "string" ? args.query : typeof args.question === "string" ? args.question : "";
  const plan = refineWelfareQuery(raw, { currentYear: new Date(context.startedAt).getUTCFullYear() });
  const explicitRegion = typeof args.region_id === "string" ? (args.region_id === "region:전국" ? args.region_id : refineWelfareQuery(args.region_id.replaceAll(":", " ").replaceAll("|", " ")).region_id) : null;
  const explicitYear = TraceYearSchema.safeParse(args.year);
  const fiscalYear = TraceYearSchema.safeParse(args.fiscal_year);
  const regions = TraceRegionsSchema.safeParse(args.region_ids);
  const dateFrom = TraceDateSchema.safeParse(args.date_from);
  const dateTo = TraceDateSchema.safeParse(args.date_to);
  const asOf = TraceDateSchema.safeParse(args.as_of);
  const year = explicitYear.success ? explicitYear.data : fiscalYear.success ? fiscalYear.data : plan.year;
  const hash = raw ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)))].map((byte) => byte.toString(16).padStart(2, "0")).join("") : null;
  const detail = observation.cacheDetail;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cacheWrite = observation.cacheWrite
    ? await Promise.race([observation.cacheWrite, new Promise<string>((resolve) => { timer = setTimeout(() => resolve("pending"), CACHE_WRITE_WAIT_MS); })]).finally(() => clearTimeout(timer))
    : null;
  return {
    call_id: context.callId, request_id: context.requestId, started_at: Math.floor(context.startedAt / 1000), route: context.route,
    tool: PUBLIC_MCP_TOOL_NAMES.some((name) => name === observation.tool) ? observation.tool : "__unknown__",
    failed: Number(observation.failed), cache: observation.cache ?? null,
    duration_ms: Number.isFinite(observation.durationMs) ? Math.max(0, Math.round(observation.durationMs)) : 0,
    query_hash: hash,
    conditions_json: JSON.stringify({ region_id: publicTraceRegion(explicitRegion ?? plan.region_id), region_ids: regions.success ? [...new Set(regions.data)] : [],
      year, fiscal_year: fiscalYear.success ? fiscalYear.data : null,
      date_from: dateFrom.success ? dateFrom.data : null, date_to: dateTo.success ? dateTo.data : null, as_of: asOf.success ? asOf.data : null,
      requested_years: plan.requested_years, excluded_years: plan.excluded_years, intents: plan.intents, include_ancestor_scope: typeof args.include_ancestor_scope === "boolean" ? args.include_ancestor_scope : plan.include_ancestor_scope }),
    provenance_json: JSON.stringify(responseProvenance(observation.response)),
    cache_status: detail?.status ?? null, cache_layer: detail?.layer ?? null, cache_reason: detail?.reason ?? detail?.lookup ?? null, cache_write: cacheWrite,
    instance_id: null, colo: null, edge_probe: null, d1_statements: null, d1_rows_read: null, d1_ms: null,
  };
}

export async function recordMcpTrace(db: SqlDatabase, trace: McpTraceRow): Promise<void> {
  try {
    await db.batch([
      db.prepare("INSERT INTO mcp_call_traces (call_id, request_id, started_at, route, tool, failed, cache, duration_ms, query_hash, conditions_json, provenance_json, cache_status, cache_layer, cache_reason, cache_write, instance_id, colo, edge_probe, d1_statements, d1_rows_read, d1_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(trace.call_id, trace.request_id, trace.started_at, trace.route, trace.tool, trace.failed, trace.cache, trace.duration_ms, trace.query_hash, trace.conditions_json, trace.provenance_json,
          trace.cache_status, trace.cache_layer, trace.cache_reason, trace.cache_write, trace.instance_id, trace.colo, trace.edge_probe, trace.d1_statements, trace.d1_rows_read, trace.d1_ms),
      db.prepare("DELETE FROM mcp_call_traces WHERE started_at < ?").bind(Math.floor(Date.now() / 1000) - MCP_TRACE_RETENTION_DAYS * 86400),
    ]);
  } catch (error) {
    console.warn("mcp trace persistence failed", { request_id: trace.request_id, error_type: error instanceof Error ? error.name : "UnknownError" });
  }
}

export async function readMcpTraces(db: SqlDatabase, filter: { readonly requestId?: string; readonly limit: number }, now = Date.now()): Promise<McpTraceReport> {
  const from = Math.floor(now / 1000) - MCP_TRACE_RETENTION_DAYS * 86400;
  const limit = Math.min(100, Math.max(1, Math.floor(filter.limit)));
  const query = "SELECT * FROM mcp_call_traces WHERE started_at >= ?" + (filter.requestId ? " AND request_id = ?" : "") + " ORDER BY started_at DESC, call_id DESC LIMIT ?";
  const values = filter.requestId ? [from, filter.requestId, limit] : [from, limit];
  const rows = await db.prepare(query).bind(...values).all<McpTraceRow>();
  return McpTraceReportSchema.parse({ rows: rows.results, retention_days: MCP_TRACE_RETENTION_DAYS, limit });
}

export async function pruneMcpTraces(db: SqlDatabase, now = Date.now()): Promise<void> {
  await db.prepare("DELETE FROM mcp_call_traces WHERE started_at < ?").bind(Math.floor(now / 1000) - MCP_TRACE_RETENTION_DAYS * 86400).run();
}
