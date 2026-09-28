import handler from "vinext/server/fetch-handler";

import { enforceApiRateLimit, pruneExpiredRateLimits } from "../lib/api-rate-limit";
import { warmDatasetCache } from "../lib/dataset-responses";
import { requestUrlIsTooLong, secureResponse } from "../lib/http-security";
import { logServerError } from "../lib/errors";
import { needsAutomaticSync, readOfficialSyncStatus } from "../lib/official-sync-status";
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
  await warmDatasetCache();
  await pruneExpiredRateLimits(db);
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
