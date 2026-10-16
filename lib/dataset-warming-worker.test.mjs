import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { after } from "node:test";

// The Worker router is real; collector/network boundaries record invocation order.
globalThis.warmWake = { events: [], status: 200, recentMcp: false, statisticsGate: null };
const modules = {
  "vinext/server/fetch-handler": "export default { fetch: async () => new Response('{}', {status: globalThis.warmWake.status}) };",
  "../lib/api-rate-limit": "export const enforceApiRateLimit=async()=>null, mcpRecentlyActive=async()=>globalThis.warmWake.recentMcp, mcpToolCallWeight=async()=>0, pruneExpiredRateLimits=async()=>{};",
  "../lib/dataset-responses": "export const warmDatasetCache=async()=>{}, advanceDatasetCacheInBackground=async()=>{globalThis.warmWake.events.push('warm')};",
  "../lib/http-security": "export const requestUrlIsTooLong=()=>false, secureResponse=response=>response;",
  "../lib/errors": "export const logServerError=()=>{};",
  "../lib/official-sync-status": "export const advanceOfficialSyncInBackground=async()=>{}, needsAutomaticSync=()=>false, readOfficialSyncStatus=async()=>({});",
  "../lib/press/background": "export const advancePressInBackground=async()=>{};",
  "../lib/platform/flags": "export const flagEnabled=()=>false;",
  "../lib/visitor-region": "export const resolveVisitorSido=async()=>({});",
  "../lib/statistics/background": "export const advanceStatisticsInBackground=async()=>{globalThis.warmWake.events.push('statistics-start');await globalThis.warmWake.statisticsGate;globalThis.warmWake.events.push('statistics-end')};",
  "../lib/integrations/keys": "export const readIndexKey=async()=>null;",
  "../lib/manuals/background": "export const advanceBundledManuals=async()=>{globalThis.warmWake.events.push('manuals')};",
  "../lib/mcp/search-fts": "export const advanceSearchFtsBackfill=async()=>{globalThis.warmWake.events.push('backfill')};",
  "../lib/mcp/server": "export const handleMcpRequest=async()=>new Response('{}');",
  "../lib/mcp/data": "export class McpData {}",
  "../lib/wiki-edit-store": "export const cachedWikiEdits=async()=>new Map();",
  "../lib/mcp/search-cache": "export const createSearchResultCache=()=>null, probeEdgeCache=()=>'untried', edgeCacheProbeResult=()=>'untried', searchCacheInstanceId=()=>'test';",
  "../lib/mcp/usage": "export const recordMcpUsage=()=>{},recordMcpCacheWrite=()=>{},flushMcpUsage=async()=>{};",
  "../lib/mcp/trace": "export const recordMcpTrace=async()=>{};",
  "../lib/d1-profile": "export const profileDatabase=db=>({db,report:()=>({d1_ms:0})});",
};
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (Object.hasOwn(modules, specifier)) return { url: "data:text/javascript," + encodeURIComponent(modules[specifier]), shortCircuit: true };
  return next(specifier, context);
} });
const { default: worker } = await import("../worker/index.ts");
after(() => { hooks.deregister(); delete globalThis.warmWake; });

for (const scenario of [
  { path: "/api/press/tick", method: "POST", status: 200, warm: true },
  { path: "/api/press/relay", method: "GET", status: 200, warm: true },
  { path: "/api/press/tick", method: "POST", status: 401, warm: false },
  { path: "/api/press/status", method: "GET", status: 200, warm: false },
  { path: "/", method: "GET", status: 200, warm: true },
  { path: "/", method: "GET", status: 200, recentMcp: true, warm: false },
  { path: "/chatgpt/mcp", method: "POST", status: 200, warm: false },
  { path: "/claude/mcp", method: "POST", status: 200, warm: false },
]) test(`Worker cache wake ${scenario.method} ${scenario.path} status=${scenario.status} recentMcp=${Boolean(scenario.recentMcp)}`, async () => {
  // Given: a controlled downstream response and MCP activity signal.
  const gate = Promise.withResolvers();
  Object.assign(globalThis.warmWake, { events: [], status: scenario.status, recentMcp: scenario.recentMcp ?? false, statisticsGate: gate.promise });
  const tasks = [];
  // When: the real Worker dispatches the request and its waitUntil jobs.
  await worker.fetch(new Request("https://fixture.test" + scenario.path, { method: scenario.method }), { DB: {} }, { waitUntil: task => tasks.push(task) });
  assert.equal(globalThis.warmWake.events.includes("warm"), false, "warming must wait for statistics completion");
  gate.resolve();
  await Promise.all(tasks);
  // Then: only successful wake paths warm, after their preceding work finishes.
  assert.equal(globalThis.warmWake.events.includes("warm"), scenario.warm);
  if (scenario.warm) assert.equal(globalThis.warmWake.events.at(-1), "warm");
});
