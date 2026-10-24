import { env } from "cloudflare:workers";
import { getD1 } from "@/lib/d1";
import { errorResponse } from "@/lib/errors";
import { readPressCoverage } from "@/lib/press/coverage";
import { parseRelayTokens, readRelayPcs, relayClientName } from "@/lib/press/relay";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    {
      if (!request.headers.has("authorization")) return new Response(null, { status: 401 });
      const tokens = [...parseRelayTokens(env.PRESS_RELAY_TOKEN_SHA256), ...await readRelayPcs(getD1())];
      if (!await relayClientName(request.headers.get("authorization"), tokens)) return new Response(null, { status: 401 });
    }
    return Response.json(await readPressCoverage(getD1(), Math.floor(Date.now() / 1000)), { headers: { "cache-control": "private, no-store", vary: "Cookie, Authorization" } });
  } catch (error) {
    return errorResponse(error, { code: "PRESS_STATUS_FAILED", message: "수집 현황을 읽지 못했습니다.", status: 500, path: "/api/press/status/detail" });
  }
}
