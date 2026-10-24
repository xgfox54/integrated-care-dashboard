import { mcpRecentlyActive } from "./api-rate-limit";
import { logServerError } from "./errors";
import { advanceOfficialSyncInBackground } from "./official-sync-status";
import { advancePressInBackground } from "./press/background";
import { flagEnabled } from "./platform/flags";
import type { SqlDatabase } from "./sql-database";
import { canonicalRequestPath } from "./request-path.ts";
import { claimVisitBackground } from "./visit-background-lease.ts";

const lastVisitChecks = new WeakMap<SqlDatabase, number>();

export function isCollectionVisit(request: Request, response: Response): boolean {
  const path = canonicalRequestPath(new URL(request.url).pathname);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return (request.method === "GET" || request.method === "HEAD") && response.ok &&
    path !== "/budget" && !path.startsWith("/api/") && !path.startsWith("/admin") &&
    (contentType.startsWith("text/html") || contentType.startsWith("text/x-component"));
}

export async function advanceVisitInBackground(workerEnv: Cloudflare.Env): Promise<void> {
  const db = workerEnv.DB;
  if (!db) return;
  const now = Date.now();
  const last = lastVisitChecks.get(db);
  if (last !== undefined && now - last < 60_000) return;
  lastVisitChecks.set(db, now);
  try {
    if (!await claimVisitBackground(db, Math.floor(now / 1000))) return;
  } catch (error: unknown) {
    logServerError(error, { path: "background-visit-admission", status: 500 });
    return;
  }
  await import("./press/link-corrections").then(({ applyVerifiedPressLinkCorrections }) => applyVerifiedPressLinkCorrections(db, Math.floor(now / 1000))).catch((error: unknown) => {
    logServerError(error, { path: "background-press-link-corrections", status: 500 });
  });
  await import("./press/title-exclusions").then(({ withdrawExcludedPressItems }) => withdrawExcludedPressItems(db, Math.floor(now / 1000))).catch((error: unknown) => {
    logServerError(error, { path: "background-press-title-exclusions", status: 500 });
  });
  await import("./classification-backfill").then(({ applyReviewedClassifications }) => applyReviewedClassifications(db)).catch((error: unknown) => {
    logServerError(error, { path: "background-classifications", status: 500 });
  });
  await import("./reviewed-wiki-edits").then(({ applyReviewedWikiEdits }) => applyReviewedWikiEdits(db)).catch((error: unknown) => {
    logServerError(error, { path: "background-reviewed-wiki-edits", status: 500 });
  });
  await import("./manuals/background").then(({ advanceBundledManuals }) => advanceBundledManuals(workerEnv)).catch((error: unknown) => {
    logServerError(error, { path: "background-manuals", status: 500 });
  });
  if (flagEnabled("NEWS_DISCOVERY_ENABLED")) await advancePressInBackground().catch((error: unknown) => {
    logServerError(error, { path: "background-press", status: 500 });
  });
  const yieldToMcp = await mcpRecentlyActive(db).catch(() => true);
  if (!yieldToMcp) await import("./mcp/search-fts").then(({ advanceSearchFtsBackfill }) => advanceSearchFtsBackfill(db)).catch((error: unknown) => {
    logServerError(error, { path: "background-search-fts", status: 500 });
  });
  await Promise.all([
    flagEnabled("OFFICIAL_SYNC_ENABLED") && !yieldToMcp ? advanceOfficialSyncInBackground().catch((error: unknown) => {
      logServerError(error, { path: "background-sync", status: 500 });
    }) : undefined,
    flagEnabled("FISCAL_INGEST_ENABLED") && !yieldToMcp ? import("./fiscal/background").then(({ advanceFiscalInBackground }) => advanceFiscalInBackground()).catch((error: unknown) => {
      logServerError(error, { path: "background-fiscal", status: 500 });
    }) : undefined,
    flagEnabled("EXTERNAL_INGEST_ENABLED") && !yieldToMcp ? import("./integrations/background").then(({ advanceIntegrationsInBackground }) => advanceIntegrationsInBackground()).catch((error: unknown) => {
      logServerError(error, { path: "background-integrations", status: 500 });
    }) : undefined,
    flagEnabled("RELEASE_BUNDLE_ENABLED") ? import("./platform/background").then(({ advanceBundleInBackground }) => advanceBundleInBackground()).catch((error: unknown) => {
      logServerError(error, { path: "background-bundle", status: 500 });
    }) : undefined,
  ]);
}
