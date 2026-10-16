import handler from "vinext/server/fetch-handler";

import { enforceApiRateLimit, mcpRecentlyActive, mcpToolCallWeight, pruneExpiredRateLimits } from "../lib/api-rate-limit";
import { advanceDatasetCacheInBackground, warmDatasetCache } from "../lib/dataset-responses";
import { requestUrlIsTooLong, secureResponse } from "../lib/http-security";
import { logServerError } from "../lib/errors";
import { advanceOfficialSyncInBackground, needsAutomaticSync, readOfficialSyncStatus } from "../lib/official-sync-status";
import { advancePressInBackground } from "../lib/press/background";
import { flagEnabled } from "../lib/platform/flags";
import { resolveVisitorSido, type VisitorCf } from "../lib/visitor-region";
import type { SqlDatabase } from "../lib/sql-database";

// 예약 실행을 지원하는 환경을 위한 보조 경로다. 현재 Sites에서는 scheduled가 실행되지 않아
// 실제 자동 갱신은 일반 방문과 등록 PC의 인증된 tick·relay 호출이 이어 간다.
async function scheduledWork(env: Cloudflare.Env): Promise<void> {
  const db = env.DB;
  await advanceStatisticsSafely(db);
  if (db) await import("../lib/mcp/search-fts").then(({ advanceSearchFtsBackfill }) => advanceSearchFtsBackfill(db));
  const { advanceBundledManuals } = await import("../lib/manuals/background");
  await advanceBundledManuals(env);
  await usageMaintenance();
  const status = await readOfficialSyncStatus();
  if (needsAutomaticSync(status)) {
    const { runOfficialSync } = await import("../lib/official-sync");
    await runOfficialSync("automatic");
  }
  // 웹은 활성 통합 공개본의 실행을 읽으므로, 새 수집 뒤 공개본을 먼저 바꾸고 그 실행으로 캐시를 데운다.
  const { advanceBundleInBackground } = await import("../lib/platform/background");
  if (flagEnabled("RELEASE_BUNDLE_ENABLED")) await advanceBundleInBackground();
  await warmDatasetCache();
  await pruneExpiredRateLimits(db);
  if (flagEnabled("NEWS_DISCOVERY_ENABLED")) await advancePressInBackground();
  const { advanceFiscalInBackground } = await import("../lib/fiscal/background");
  if (flagEnabled("FISCAL_INGEST_ENABLED")) await advanceFiscalInBackground();
}

// 통계는 고정된 공식 원천만 자체 시간 예산·D1 공통 실행권 안에서 확인한다.
// 원천 장애가 기존 페이지 응답이나 다른 수집 작업을 실패로 바꾸지 않게 분리한다.
async function advanceStatisticsSafely(db: SqlDatabase | undefined): Promise<void> {
  if (!db) return;
  try {
    const { advanceStatisticsInBackground } = await import("../lib/statistics/background");
    const { readIndexKey } = await import("../lib/integrations/keys");
    await advanceStatisticsInBackground(db, { readIndexKey });
  } catch (error) {
    logServerError(error, { path: "background-statistics", status: 500 });
  }
}

async function warmDatasetCacheSafely(db: SqlDatabase): Promise<void> {
  if (await mcpRecentlyActive(db).catch(() => true)) return;
  await advanceDatasetCacheInBackground();
}

/** 이용통계: 만료된 임시 상태(최대 24시간)와 24개월 지난 집계를 지우고, 사업·제도 통계 ID의 현재 목록 포함 여부를 갱신한다. */
async function usageMaintenance(): Promise<void> {
  try {
    const { runUsageCleanup } = await import("../lib/usage/cleanup");
    await runUsageCleanup();
    const { getD1 } = await import("../lib/d1");
    await import("../lib/mcp/usage").then(({ pruneMcpUsage }) => pruneMcpUsage(getD1()));
    await import("../lib/mcp/trace").then(({ pruneMcpTraces }) => pruneMcpTraces(getD1()));
    const { refreshUsageEntityStatuses } = await import("../lib/usage/registry");
    await refreshUsageEntityStatuses();
  } catch {
    console.error("usage maintenance failed");
  }
}

const worker = {
  async fetch(request: Request, workerEnv: Cloudflare.Env, context: ExecutionContext) {
    const requestStarted = Date.now();
    const url = new URL(request.url);
    // Plaintext packs are not included in public assets. Hosting serves static
    // assets first, so only authenticated ciphertext is published for import.
    let decodedPath = url.pathname;
    try { decodedPath = decodeURIComponent(decodedPath); } catch { /* malformed paths remain unmatched */ }
    if (decodedPath.replace(/^\/+/, "/").startsWith("/__manual_corpus/")) {
      return secureResponse(new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } }));
    }
    if (url.pathname.startsWith("/api/") && requestUrlIsTooLong(request)) {
      return secureResponse(Response.json(
        { error: "REQUEST_URI_TOO_LONG", message: "요청 주소가 너무 깁니다." },
        { status: 414, headers: { "cache-control": "no-store" } },
      ));
    }
    // Sites는 정확히 /mcp인 경로를 플랫폼 OAuth 전용으로 예약하므로, ChatGPT도 로그인 없는 /chatgpt/mcp를 쓴다.
    // 두 경로 모두 공개 자료만 조회하는 익명 경로라 사용자 ID 헤더를 신뢰하지 않고 출구 IP·경로 총량 한도로 센다.
    const isMcp = url.pathname === "/chatgpt/mcp" || url.pathname === "/claude/mcp";
    // MCP는 tools/call 수만 센다. initialize·알림·tools/list·server/discover는 D1 기록 없이 통과한다.
    const weight = isMcp ? await mcpToolCallWeight(request) : undefined;
    const limited = await enforceApiRateLimit(request, workerEnv.DB, undefined, { weight, reserveCalls: isMcp ? 5 : undefined });
    if (limited) {
      if (isMcp && workerEnv.DB) {
        const { recordMcpUsage, flushMcpUsage } = await import("../lib/mcp/usage");
        recordMcpUsage(workerEnv.DB, { route: url.pathname === "/claude/mcp" ? "/claude/mcp" : "/mcp", tool: "__request__", durationMs: Date.now() - requestStarted, failed: true, rateLimited: limited.status === 429 });
        context.waitUntil(flushMcpUsage(workerEnv.DB));
      }
      return secureResponse(limited);
    }
    if (isMcp) {
      // korean-law-mcp가 모듈 초기화 때 Referer를 읽으므로 동적 import 전에 운영 등록값을 주입한다.
      // 별도 설정이 없으면 사용자 헤더가 아닌 Worker의 실제 요청 origin을 사용한다.
      process.env.LAW_REFERER = workerEnv.LAW_REFERER?.trim() || `${url.origin}/`;
      const [{ handleMcpRequest }, { McpData }, { cachedWikiEdits }, { createSearchResultCache, probeEdgeCache, edgeCacheProbeResult, searchCacheInstanceId }, { recordMcpUsage, recordMcpCacheWrite, flushMcpUsage }] = await Promise.all([
        import("../lib/mcp/server"),
        import("../lib/mcp/data"),
        import("../lib/wiki-edit-store"),
        import("../lib/mcp/search-cache"),
        import("../lib/mcp/usage"),
      ]);
      if (!workerEnv.DB) return secureResponse(Response.json({ error: "MCP_UNAVAILABLE" }, { status: 503, headers: { "cache-control": "no-store" } }));
      const usageDb = workerEnv.DB;
      const { recordMcpTrace } = await import("../lib/mcp/trace");
      // 느린 요청만 D1 문장별 비용을 남긴다(바인딩 값·사용자 질문은 기록하지 않음).
      const { profileDatabase } = await import("../lib/d1-profile");
      const profiled = profileDatabase(workerEnv.DB);
      const started = Date.now();
      const route = url.pathname === "/claude/mcp" ? "/claude/mcp" : "/mcp";
      const cfColo = (request as { cf?: { colo?: unknown } }).cf?.colo;
      const colo = typeof cfColo === "string" && /^[A-Z]{3}$/.test(cfColo) ? cfColo : null;
      probeEdgeCache(url.origin, (task) => context.waitUntil(task));
      let status = 500;
      try {
      const response = await handleMcpRequest(request, new McpData(profiled.db, cachedWikiEdits), (error, tool) => {
        logServerError(error, { path: url.pathname + ":" + tool, status: 500 });
      }, {
        includeLaw: false,
        welfareAssets: workerEnv.ASSETS,
        requestIdentity: "anonymous",
        stateCacheMs: 30_000,
        searchCache: createSearchResultCache({ db: profiled.db, defer: (task) => context.waitUntil(task) }),
        observeTool: (observation) => {
          recordMcpUsage(usageDb, { ...observation, route });
          if (observation.cacheWrite) context.waitUntil(observation.cacheWrite.then((outcome) => {
            recordMcpCacheWrite(usageDb, { route, tool: observation.tool, outcome });
            return flushMcpUsage(usageDb);
          }));
        },
        observeTrace: (trace) => context.waitUntil(trace.then((row) => {
          const cost = profiled.report(0);
          return recordMcpTrace(usageDb, { ...row, instance_id: searchCacheInstanceId(), colo, edge_probe: edgeCacheProbeResult(), d1_statements: cost.statements, d1_rows_read: cost.rows_read, d1_ms: cost.d1_ms });
        }).catch((error: unknown) => {
          console.warn("mcp trace capture failed", error instanceof Error ? error.name : "UnknownError");
        })),
      });
      status = response.status;
      const profile = profiled.report();
      if (Date.now() - started >= 3000 || profile.d1_ms >= 1000) console.log(JSON.stringify({ mcp_db_profile: { path: url.pathname, request_ms: Date.now() - started, ...profile } }));
      return secureResponse(response);
      } finally {
        recordMcpUsage(workerEnv.DB, { route, tool: "__request__", durationMs: Date.now() - requestStarted, failed: status >= 400 });
        context.waitUntil(flushMcpUsage(workerEnv.DB));
      }
    }
    if (url.pathname === "/api/law") {
      // 웹 법령 검색도 외부 MCP가 아니라 같은 Worker의 korean-law-mcp 실행 모듈을 직접 호출한다.
      process.env.LAW_REFERER = workerEnv.LAW_REFERER?.trim() || `${url.origin}/`;
      const { handleLawHttpRequest } = await import("../lib/law/http");
      return secureResponse(await handleLawHttpRequest(request, workerEnv));
    }
    // 상태 읽기는 실행과 분리한다. PC 수집 응답이 끝난 뒤 성공한 인증 경로만 통계를 깨운다.
    // 기존 보도자료·예산 배경 체인을 다시 실행하지 않으며, PC의 토큰·실행 결과 형식은 유지한다.
    if (["/api/press/status", "/api/press/tick", "/api/press/relay"].includes(url.pathname)) {
      const response = await handler.fetch(request, workerEnv, context);
      const authenticatedWake = (url.pathname === "/api/press/tick" && request.method === "POST")
        || (url.pathname === "/api/press/relay" && (request.method === "GET" || request.method === "POST"));
      if (authenticatedWake && response.status === 200 && workerEnv.DB) {
        const db = workerEnv.DB;
        context.waitUntil(advanceStatisticsSafely(db).then(() => warmDatasetCacheSafely(db)));
      }
      return secureResponse(response);
    }
    if (url.pathname === "/api/manuals/status") {
      if (request.method !== "GET" && request.method !== "HEAD") return secureResponse(new Response(null, { status: 405, headers: { allow: "GET, HEAD" } }));
      if (!workerEnv.DB) return secureResponse(Response.json({ error: "MANUAL_DATABASE_UNAVAILABLE" }, { status: 503 }));
      const [{ readManualCorpusState }, { MANUAL_CORPUS_MANIFEST }, { advanceBundledManuals }] = await Promise.all([
        import("../lib/manuals/store"), import("../lib/manuals/manifest"), import("../lib/manuals/background"),
      ]);
      const status = await readManualCorpusState(workerEnv.DB);
      // As with the existing automatic collectors, normal web access resumes a
      // bounded server-owned job. This route cannot choose or upload any data.
      context.waitUntil(advanceBundledManuals(workerEnv).catch((error: unknown) => logServerError(error, { path: "background-manuals", status: 500 })));
      return secureResponse(Response.json({
        ...status, configured_revision: MANUAL_CORPUS_MANIFEST.revision,
        expected_documents: MANUAL_CORPUS_MANIFEST.document_count,
        expected_sections: MANUAL_CORPUS_MANIFEST.section_count,
        asset_binding_available: Boolean(workerEnv.ASSETS),
        asset_key_available: Boolean(workerEnv.MANUAL_CORPUS_KEY?.trim()),
      }, { headers: { "cache-control": "no-store" } }));
    }
    // 이 호스팅에서는 예약 작업이 돌지 않으므로, 응답 뒤 남는 시간에 수집을 한 단계씩 잇는다.
    // 보도자료 수집(기관 누리집 요청, 7초×3회)을 먼저 단독으로 끝낸다. 예산 수집(20초 요청·대량 DB 쓰기)과 동시에 돌던 동안
    // 평소 1~6초면 끝나던 보도자료 요청이 세 번 모두 7초를 넘겨 NETWORK_ERROR가 크게 늘었다(2026-10-04 16시 UTC 이후).
    const backgroundWork = (async () => {
      const classificationDb = workerEnv.DB;
      if (classificationDb) await import("../lib/classification-backfill").then(({ applyReviewedClassifications }) => applyReviewedClassifications(classificationDb)).catch((error: unknown) => {
        logServerError(error, { path: "background-classifications", status: 500 });
      });
      // The fixed manual corpus advances before network collectors. MCP has
      // already returned above and never runs this ingestion path.
      await import("../lib/manuals/background").then(({ advanceBundledManuals }) => advanceBundledManuals(workerEnv)).catch((error: unknown) => {
        logServerError(error, { path: "background-manuals", status: 500 });
      });
      // 정기 수집 호출(/api/press/tick)은 요청 안에서 대기열을 직접 처리하므로 같은 요청 뒤에 보도자료 수집을 한 번 더 돌리지 않는다.
      if (flagEnabled("NEWS_DISCOVERY_ENABLED") && url.pathname !== "/api/press/tick") await advancePressInBackground().catch((error: unknown) => {
        logServerError(error, { path: "background-press", status: 500 });
      });
      // 최근 MCP 도구 호출이 있으면 쓰기가 많은 수집(공식 수집·재정·외부 연계)은 다음 방문으로 미룬다.
      // D1은 한 데이터베이스의 쿼리를 차례로 처리해, 대량 쓰기와 겹친 검색이 실패한 사례가 있었다(2026-10-11 788문항 측정).
      const yieldToMcp = workerEnv.DB ? await mcpRecentlyActive(workerEnv.DB).catch(() => false) : false;
      // 사업·정부24 검색 전문 인덱스의 기존 행 채우기(0114). 끝나면 아무 일도 하지 않는다.
      if (workerEnv.DB && !yieldToMcp) {
        const db = workerEnv.DB;
        await import("../lib/mcp/search-fts").then(({ advanceSearchFtsBackfill }) => advanceSearchFtsBackfill(db)).catch((error: unknown) => {
          logServerError(error, { path: "background-search-fts", status: 500 });
        });
      }
      await Promise.all([
        flagEnabled("OFFICIAL_SYNC_ENABLED") && !yieldToMcp ? advanceOfficialSyncInBackground().catch((error: unknown) => {
          logServerError(error, { path: "background-sync", status: 500 });
        }) : undefined,
        flagEnabled("FISCAL_INGEST_ENABLED") && !yieldToMcp ? import("../lib/fiscal/background").then(({ advanceFiscalInBackground }) => advanceFiscalInBackground()).catch((error: unknown) => {
          logServerError(error, { path: "background-fiscal", status: 500 });
        }) : undefined,
        // 외부 데이터 연계(법정동코드·장기요양기관·정부24·KOSIS): 때가 된 범위 하나를 한 단계씩 잇는다. 인증키가 없으면 요청하지 않는다.
        flagEnabled("EXTERNAL_INGEST_ENABLED") && !yieldToMcp ? import("../lib/integrations/background").then(({ advanceIntegrationsInBackground }) => advanceIntegrationsInBackground()).catch((error: unknown) => {
          logServerError(error, { path: "background-integrations", status: 500 });
        }) : undefined,
        // 통합 공개본: 모듈이 바뀌었으면 새 공개본을 만들고 활성 포인터를 CAS로 바꾼다.
        flagEnabled("RELEASE_BUNDLE_ENABLED") ? import("../lib/platform/background").then(({ advanceBundleInBackground }) => advanceBundleInBackground()).catch((error: unknown) => {
          logServerError(error, { path: "background-bundle", status: 500 });
        }) : undefined,
      ]);
    })();
    context.waitUntil(backgroundWork);
    if (url.pathname === "/api/geo") {
      const cf = (request as Request & { cf?: VisitorCf }).cf;
      const result = await resolveVisitorSido(cf);
      if (workerEnv.DB) {
        const db = workerEnv.DB;
        context.waitUntil(Promise.all([backgroundWork, advanceStatisticsSafely(db)]).then(() => warmDatasetCacheSafely(db)));
      }
      return secureResponse(Response.json(result, { headers: { "cache-control": "private, no-store" } }));
    }
    const response = await handler.fetch(request, workerEnv, context);
    // 기존 긴 수집 체인의 완료를 기다리지 않는 독립된 단계다. 오류·인증 실패 응답은 깨우지 않는다.
    if (response.ok && workerEnv.DB) {
      const db = workerEnv.DB;
      context.waitUntil(Promise.all([backgroundWork, advanceStatisticsSafely(db)]).then(() => warmDatasetCacheSafely(db)));
    }
    return secureResponse(response);
  },
  scheduled(
    _controller: ScheduledController,
    _workerEnv: Cloudflare.Env,
    context: ExecutionContext,
  ) {
    context.waitUntil(scheduledWork(_workerEnv).catch((error: unknown) => {
      logServerError(error, { path: "scheduled-work", status: 500 });
    }));
  },
};

export default worker;
