import handler from "vinext/server/fetch-handler";

import { warmDatasetCache } from "../lib/dataset-responses";
import { needsAutomaticSync, readOfficialSyncStatus } from "../lib/official-sync-status";
import { resolveVisitorSido, type VisitorCf } from "../lib/visitor-region";

// 매시 정각: 자동 수집이 필요할 때만 수집 모듈(기준 자료 12MB)을 불러오고,
// 이어서 대시보드 요약·지역 묶음 보관본을 채운다.
async function scheduledWork(): Promise<void> {
  const status = await readOfficialSyncStatus();
  if (needsAutomaticSync(status)) {
    const { runOfficialSync } = await import("../lib/official-sync");
    await runOfficialSync("automatic");
  }
  await warmDatasetCache();
}

const worker = {
  async fetch(request: Request, workerEnv: Cloudflare.Env, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/api/geo") {
      const cf = (request as Request & { cf?: VisitorCf }).cf;
      const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? "";
      const country = cf?.country ?? request.headers.get("cf-ipcountry") ?? "";
      const result = await resolveVisitorSido(cf, ip, country);
      const body = url.searchParams.has("debug")
        ? { ...result, cf: cf ? { country: cf.country, regionCode: cf.regionCode, region: cf.region } : null }
        : { sido: result.sido };
      return Response.json(body, { headers: { "cache-control": "private, no-store" } });
    }
    return handler.fetch(request, workerEnv, context);
  },
  scheduled(
    _controller: ScheduledController,
    _workerEnv: Cloudflare.Env,
    context: ExecutionContext,
  ) {
    context.waitUntil(scheduledWork().catch((error: unknown) => console.error("scheduled work failed", error)));
  },
};

export default worker;
