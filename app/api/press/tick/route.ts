import { env } from "cloudflare:workers";

import { getD1 } from "@/lib/d1";
import { errorResponse } from "@/lib/errors";
import { collectDepsUntil } from "@/lib/press/background";
import { parseRelayTokens, readRelayPcs, relayClientName, touchRelayPc } from "@/lib/press/relay";
import { runPressTick } from "@/lib/press/tick";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

// 정기 수집 실행: 등록된 수집 PC(Bearer 토큰)만 부를 수 있다. 인증 없는 공개 실행 경로는 두지 않는다.
// 서버가 기관 누리집에 직접 요청하는 Source만 처리한다(PC 중계 Source는 기존 /api/press/relay 차례로 처리).
export async function POST(request: Request): Promise<Response> {
  const tokens = [...parseRelayTokens((env as { PRESS_RELAY_TOKEN_SHA256?: string }).PRESS_RELAY_TOKEN_SHA256), ...(await readRelayPcs(getD1()))];
  const pc = await relayClientName(request.headers.get("authorization"), tokens);
  if (!pc) return Response.json({ error: "등록된 수집 PC가 아닙니다." }, { status: 401, headers: NO_STORE });
  try {
    const db = getD1();
    const now = () => Math.floor(Date.now() / 1000);
    await touchRelayPc(db, pc, now());
    const result = await runPressTick(db, pc, collectDepsUntil, now);
    return Response.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, { code: "PRESS_TICK_FAILED", message: "정기 수집을 실행하지 못했습니다.", status: 500, path: "/api/press/tick" });
  }
}

export function GET(): Response {
  return Response.json({ error: "POST만 허용합니다." }, { status: 405, headers: { ...NO_STORE, allow: "POST" } });
}
