import handler from "vinext/server/fetch-handler";

import { enforceApiRateLimit, pruneExpiredRateLimits } from "../lib/api-rate-limit";
import { warmDatasetCache } from "../lib/dataset-responses";
import { requestUrlIsTooLong, secureResponse } from "../lib/http-security";
import { logServerError } from "../lib/errors";
import { advanceOfficialSyncInBackground, needsAutomaticSync, readOfficialSyncStatus } from "../lib/official-sync-status";
import { advancePressInBackground } from "../lib/press/background";
import { flagEnabled } from "../lib/platform/flags";
import { resolveVisitorSido, type VisitorCf } from "../lib/visitor-region";

// 매시 정각: 자동 수집이 필요할 때만 수집 모듈(기준 자료 12MB)을 불러오고,
// 이어서 대시보드 요약·지역 묶음 보관본을 채운다. 이용통계 단기 상태 정리도 여기서 한다.
async function scheduledWork(db: D1Database | undefined): Promise<void> {
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

/** 이용통계: 만료된 임시 상태(최대 24시간)와 24개월 지난 집계를 지우고, 사업·제도 통계 ID의 현재 목록 포함 여부를 갱신한다. */
async function usageMaintenance(): Promise<void> {
  try {
    const { runUsageCleanup } = await import("../lib/usage/cleanup");
    await runUsageCleanup();
    const { refreshUsageEntityStatuses } = await import("../lib/usage/registry");
    await refreshUsageEntityStatuses();
  } catch {
    console.error("usage maintenance failed");
  }
}

const worker = {
  async fetch(request: Request, workerEnv: Cloudflare.Env, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") && requestUrlIsTooLong(request)) {
      return secureResponse(Response.json(
        { error: "REQUEST_URI_TOO_LONG", message: "요청 주소가 너무 깁니다." },
        { status: 414, headers: { "cache-control": "no-store" } },
      ));
    }
    const limited = await enforceApiRateLimit(request, workerEnv.DB);
    if (limited) return secureResponse(limited);
    if (url.pathname === "/mcp") {
      // 공개 MCP는 배경 수집을 부수적으로 일으키지 않는다. 법령 도구만 법제처 OPEN API를 요청 시점에 읽는다.
      // korean-law-mcp가 모듈 초기화 때 Referer를 읽으므로 동적 import 전에 운영 등록값을 주입한다.
      if (workerEnv.LAW_REFERER?.trim()) process.env.LAW_REFERER = workerEnv.LAW_REFERER.trim();
      const [{ handleMcpRequest }, { McpData }, { cachedWikiEdits }] = await Promise.all([
        import("../lib/mcp/server"),
        import("../lib/mcp/data"),
        import("../lib/wiki-edit-store"),
      ]);
      if (!workerEnv.DB) return secureResponse(Response.json({ error: "MCP_UNAVAILABLE" }, { status: 503, headers: { "cache-control": "no-store" } }));
      const response = await handleMcpRequest(request, new McpData(workerEnv.DB, cachedWikiEdits), (error, tool) => {
        logServerError(error, { path: "/mcp:" + tool, status: 500 });
      }, { lawApiKey: workerEnv.LAW_OC });
      return secureResponse(response);
    }
    if (url.pathname === "/api/law") {
      // 웹 법령 검색도 외부 MCP가 아니라 같은 Worker의 korean-law-mcp 실행 모듈을 직접 호출한다.
      if (workerEnv.LAW_REFERER?.trim()) process.env.LAW_REFERER = workerEnv.LAW_REFERER.trim();
      const { handleLawHttpRequest } = await import("../lib/law/http");
      return secureResponse(await handleLawHttpRequest(request, workerEnv));
    }
    // 이 호스팅에서는 예약 작업이 돌지 않으므로, 응답 뒤 남는 시간에 수집을 한 단계씩 잇는다.
    // 보도자료 수집(기관 누리집 요청, 7초×3회)을 먼저 단독으로 끝낸다. 예산 수집(20초 요청·대량 DB 쓰기)과 동시에 돌던 동안
    // 평소 1~6초면 끝나던 보도자료 요청이 세 번 모두 7초를 넘겨 NETWORK_ERROR가 크게 늘었다(2026-10-04 16시 UTC 이후).
    context.waitUntil((async () => {
      // 정기 수집 호출(/api/press/tick)은 요청 안에서 대기열을 직접 처리하므로 같은 요청 뒤에 보도자료 수집을 한 번 더 돌리지 않는다.
      if (flagEnabled("NEWS_DISCOVERY_ENABLED") && url.pathname !== "/api/press/tick") await advancePressInBackground().catch((error: unknown) => {
        logServerError(error, { path: "background-press", status: 500 });
      });
      await Promise.all([
        flagEnabled("OFFICIAL_SYNC_ENABLED") ? advanceOfficialSyncInBackground().catch((error: unknown) => {
          logServerError(error, { path: "background-sync", status: 500 });
        }) : undefined,
        flagEnabled("FISCAL_INGEST_ENABLED") ? import("../lib/fiscal/background").then(({ advanceFiscalInBackground }) => advanceFiscalInBackground()).catch((error: unknown) => {
          logServerError(error, { path: "background-fiscal", status: 500 });
        }) : undefined,
        // 외부 데이터 연계(법정동코드·장기요양기관·정부24·KOSIS): 때가 된 범위 하나를 한 단계씩 잇는다. 인증키가 없으면 요청하지 않는다.
        flagEnabled("EXTERNAL_INGEST_ENABLED") ? import("../lib/integrations/background").then(({ advanceIntegrationsInBackground }) => advanceIntegrationsInBackground()).catch((error: unknown) => {
          logServerError(error, { path: "background-integrations", status: 500 });
        }) : undefined,
        // 통합 공개본: 모듈이 바뀌었으면 새 공개본을 만들고 활성 포인터를 CAS로 바꾼다.
        flagEnabled("RELEASE_BUNDLE_ENABLED") ? import("../lib/platform/background").then(({ advanceBundleInBackground }) => advanceBundleInBackground()).catch((error: unknown) => {
          logServerError(error, { path: "background-bundle", status: 500 });
        }) : undefined,
      ]);
    })());
    if (url.pathname === "/api/geo") {
      const cf = (request as Request & { cf?: VisitorCf }).cf;
      const result = await resolveVisitorSido(cf);
      return secureResponse(Response.json(result, { headers: { "cache-control": "private, no-store" } }));
    }
    return secureResponse(await handler.fetch(request, workerEnv, context));
  },
  scheduled(
    _controller: ScheduledController,
    _workerEnv: Cloudflare.Env,
    context: ExecutionContext,
  ) {
    context.waitUntil(scheduledWork(_workerEnv.DB).catch((error: unknown) => {
      logServerError(error, { path: "scheduled-work", status: 500 });
    }));
  },
};

export default worker;
