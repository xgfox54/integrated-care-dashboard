import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { after } from "node:test";

// The Worker router is real; collector/network boundaries record invocation order.
globalThis.warmWake = { events: [], status: 200, recentMcp: false, statisticsGate: null, contentType: 'text/html', transportBlocked: false };
const modules = {
  "../lib/visit-background-lease.ts": "export const claimVisitBackground=async()=>true;",
  "vinext/server/fetch-handler": "export default { fetch: async () => new Response('{}', {status: globalThis.warmWake.status, headers:{'server-timing':'app;dur=7','content-type':globalThis.warmWake.contentType}}) };",
  "../lib/api-rate-limit": "export const enforceApiRateLimit=async(req,db,now,options)=>{globalThis.warmWake.lastOptions=options;globalThis.warmWake.events.push(options?.transport?'transport':'quota');return options?.transport && globalThis.warmWake.transportBlocked?new Response('',{status:429}):null}, mcpRecentlyActive=async()=>globalThis.warmWake.recentMcp, mcpToolCallWeight=async()=>{globalThis.warmWake.events.push('body-peek');return 0}, pruneExpiredRateLimits=async()=>{};",
  "../lib/classification-backfill": "export const applyReviewedClassifications=async()=>{globalThis.warmWake.events.push('classifications')};",
  "../lib/dataset-responses": "export const warmDatasetCache=async()=>{}, advanceDatasetCacheInBackground=async()=>{globalThis.warmWake.events.push('warm')};",
  "../lib/http-security": "export const requestUrlIsTooLong=()=>false, secureResponse=response=>response, scriptNoncePolicy=()=>\"\";",
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
  const key = specifier.startsWith('./') ? '../lib/' + specifier.slice(2) : specifier;
  if (Object.hasOwn(modules, key)) return { url: "data:text/javascript," + encodeURIComponent(modules[key]), shortCircuit: true };
  return next(specifier, context);
} });
const { default: worker } = await import("../worker/index.ts");
after(() => { hooks.deregister(); delete globalThis.warmWake; });

for (const scenario of [
  { path: "/api/press/tick", method: "POST", status: 200, warm: true },
  { path: "/api/press/relay", method: "GET", status: 200, warm: true },
  { path: "/api/press/tick", method: "POST", status: 401, warm: false },
  { path: "/api/press/status", method: "GET", status: 200, warm: false },
  { path: "/api/press/%73tatus", method: "GET", status: 200, warm: false },
  { path: "/api/press//status", method: "GET", status: 200, warm: false },
  { path: "/api/press/status.rsc", method: "GET", status: 200, warm: false },
  { path: "/api/press/status/.rsc", method: "GET", status: 200, warm: false },
  { path: "/", method: "GET", status: 200, warm: true },
  { path: "/", method: "GET", status: 200, recentMcp: true, warm: false },
  { path: "/news.rsc", method: "GET", status: 200, contentType: 'text/x-component', visit: true, warm: true },
  { path: "/", method: "HEAD", status: 200, warm: true },
  { path: "/budget", method: "GET", status: 200, warm: false },
  { path: "/budget", method: "HEAD", status: 200, warm: false },
  ...["/budget", "/budget/", "/budget.rsc", "/budget/.rsc", "/%62udget"].map(path => ({ path, method: "GET", status: 200, contentType: "text/x-component", warm: false })),
  { path: "/api/data.rsc", method: "GET", status: 200, contentType: 'text/x-component', warm: false },
  { path: "/unknown", method: "GET", status: 404, warm: false },
  { path: "/api/private", method: "GET", status: 403, warm: false },
  { path: "/unknown", method: "POST", status: 405, warm: false },
  { path: "/", method: "GET", status: 500, warm: false },
  { path: "/api/usage/collect", method: "POST", status: 200, warm: false },
  { path: "/api/dataset", method: "GET", status: 200, contentType: 'application/json', warm: false },
  { path: "/api/geo", method: "POST", status: 200, responseStatus: 405, warm: false },
  { path: "/api/geo", method: "GET", status: 200, warm: true },
  { path: "/chatgpt/mcp", method: "POST", status: 200, warm: false },
  { path: "/claude/mcp", method: "POST", status: 200, warm: false },
]) test(`Worker cache wake ${scenario.method} ${scenario.path} status=${scenario.status} recentMcp=${Boolean(scenario.recentMcp)}`, async () => {
  // Given: a controlled downstream response and MCP activity signal.
  const gate = Promise.withResolvers();
  Object.assign(globalThis.warmWake, { events: [], status: scenario.status, recentMcp: scenario.recentMcp ?? false, statisticsGate: gate.promise, contentType: scenario.contentType ?? 'text/html' });
  const tasks = [];
  // When: the real Worker dispatches the request and its waitUntil jobs.
  const response = await worker.fetch(new Request("https://fixture.test" + scenario.path, {
    method: scenario.method,
    ...(scenario.method === 'POST' ? { headers: { origin: 'https://fixture.test', 'content-type': 'application/json' }, body: '{}' } : {}),
  }), { DB: {} }, { waitUntil: task => tasks.push(task) });
  assert.equal(response.status, scenario.responseStatus ?? scenario.status);
  assert.equal(globalThis.warmWake.events.includes("warm"), false, "warming must wait for statistics completion");
  gate.resolve();
  await Promise.all(tasks);
  // Then: only successful wake paths warm, after their preceding work finishes.
  assert.equal(globalThis.warmWake.events.includes("warm"), scenario.warm);
  const visit = scenario.status === 200 && ['GET', 'HEAD'].includes(scenario.method) && (scenario.path === '/' || scenario.path === '/api/geo' || scenario.visit === true);
  assert.equal(globalThis.warmWake.events.includes('classifications'), visit, 'only intended successful public visits start collection');
  if (scenario.warm) assert.equal(globalThis.warmWake.events.at(-1), "warm");
});

test('MCP header rejection and exhausted transport admission precede body parsing', async () => {
  for (const [path, method, headers, blocked, expected] of [
    ['/chatgpt/mcp', 'POST', { origin: 'https://foreign.invalid', 'content-type': 'application/json' }, false, 403],
    ['/claude/mcp', 'POST', { 'content-type': 'text/plain' }, false, 415],
    ['/chatgpt//mcp', 'GET', {}, false, 405],
    ['/chatgpt/mcp.rsc', 'POST', { 'content-type': 'application/json' }, true, 429],
  ]) {
    Object.assign(globalThis.warmWake, { events: [], transportBlocked: blocked });
    const request = new Request('https://fixture.test' + path, { method, headers, ...(method === 'POST' ? { body: '{}' } : {}) });
    const tasks = [];
    const response = await worker.fetch(request, { DB: {} }, { waitUntil: task => tasks.push(task) });
    assert.equal(response.status, expected);
    assert.equal(request.bodyUsed, false);
    assert.deepEqual(globalThis.warmWake.events, blocked ? ['transport'] : []);
    assert.equal(tasks.length, 0);
  }
  globalThis.warmWake.transportBlocked = false;
});

test('normal visits coalesce checks per database and recover after the minute', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  const { advanceVisitInBackground } = await import('./visit-background.ts');
  Object.assign(globalThis.warmWake, { events: [], recentMcp: false });
  const env = { DB: {} };
  await Promise.all(Array.from({ length: 25 }, () => advanceVisitInBackground(env)));
  assert.equal(globalThis.warmWake.events.filter(v => v === 'classifications').length, 1);
  await advanceVisitInBackground({ DB: {} });
  assert.equal(globalThis.warmWake.events.filter(v => v === 'classifications').length, 2);
  t.mock.timers.tick(60_000);
  await advanceVisitInBackground(env);
  assert.equal(globalThis.warmWake.events.filter(v => v === 'classifications').length, 3);
});


test('budget Worker timing preserves app duration and uses server-selected reservations', async () => {
  // Given: the renderer has supplied its own timing metric.
  Object.assign(globalThis.warmWake, { events: [], status: 200, contentType: 'application/json' });
  for (const path of ['/api/budget', '/api//budget.rsc', '/budget', '/api/dataset']) {
    // When: the Worker dispatches a budget or unrelated request.
    const response = await worker.fetch(new Request('https://fixture.test' + path), { DB: {} }, { waitUntil: () => {} });
    // Then: budget responses retain app timing and add numeric Worker metrics only.
    const timing = response.headers.get('server-timing');
    if (path === '/api/dataset') {
      assert.equal(timing, 'app;dur=7');
      assert.equal(globalThis.warmWake.lastOptions.reserveCalls, undefined);
    } else {
      assert.match(timing, /^app;dur=7, rate_limit;dur=\d+, worker;dur=\d+$/);
      assert.equal(globalThis.warmWake.lastOptions.reserveCalls, path === '/budget' ? undefined : 5);
    }
  }
});
