import { env } from "cloudflare:workers";

import { getD1 } from "@/lib/d1";
import { errorResponse } from "@/lib/errors";
import { claimRelayJobs, parseRelayTokens, processRelayResult, readRelayPcs, relayClientName, releaseRelayClaim, RELAY_MAX_BYTES, touchRelayPc, type RelayResponse } from "@/lib/press/relay";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

async function client(request: Request): Promise<string | null> {
  // 환경변수로 등록한 PC와 관리자 화면에서 등록한 PC를 함께 인정한다.
  const tokens = [...parseRelayTokens((env as { PRESS_RELAY_TOKEN_SHA256?: string }).PRESS_RELAY_TOKEN_SHA256), ...(await readRelayPcs(getD1()))];
  return relayClientName(request.headers.get("authorization"), tokens);
}

function denied(): Response {
  return Response.json({ error: "등록된 수집 PC가 아닙니다." }, { status: 401, headers: NO_STORE });
}

/** 수집 PC: 차례를 잡고 받아 올 목록을 받는다. */
export async function GET(request: Request): Promise<Response> {
  const pc = await client(request);
  if (!pc) return denied();
  try {
    const now = Math.floor(Date.now() / 1000);
    await touchRelayPc(getD1(), pc, now);
    const result = await claimRelayJobs(getD1(), pc, now);
    return Response.json({ pc, ...result }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, { code: "PRESS_RELAY_JOBS_FAILED", message: "수집 목록을 만들지 못했습니다.", status: 500, path: "/api/press/relay" });
  }
}

function readResponses(value: unknown): RelayResponse[] | null {
  if (!Array.isArray(value) || value.length > 4) return null;
  const out: RelayResponse[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { url, status, contentType, bodyBase64 } = item as Record<string, unknown>;
    if (typeof url !== "string" || url.length > 1000 || typeof status !== "number" || !Number.isInteger(status) || status < 0 || status > 599) return null;
    if (contentType !== undefined && (typeof contentType !== "string" || contentType.length > 200)) return null;
    if (bodyBase64 !== undefined && (typeof bodyBase64 !== "string" || bodyBase64.length > Math.ceil(RELAY_MAX_BYTES / 3) * 4)) return null;
    out.push({ url, status, contentType, bodyBase64 });
  }
  return out;
}

/** 수집 PC: 한 Source의 응답을 올리거나({ sourceId, responses }), 차례를 놓는다({ done: true }). */
export async function POST(request: Request): Promise<Response> {
  const pc = await client(request);
  if (!pc) return denied();
  try {
    const body: unknown = await request.json().catch(() => null);
    if (typeof body !== "object" || body === null) return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400, headers: NO_STORE });
    const record = body as Record<string, unknown>;
    const db = getD1();
    const now = () => Math.floor(Date.now() / 1000);
    if (record.done === true) {
      await releaseRelayClaim(db, pc, now());
      return Response.json({ ok: true }, { headers: NO_STORE });
    }
    const responses = readResponses(record.responses);
    if (typeof record.sourceId !== "string" || !responses) return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400, headers: NO_STORE });
    const summary = await processRelayResult(db, pc, record.sourceId, responses, { now, newId: () => crypto.randomUUID() });
    if (!summary) return Response.json({ error: "중계 수집 대상이 아닙니다." }, { status: 404, headers: NO_STORE });
    return Response.json({ ok: true, summary }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error, { code: "PRESS_RELAY_UPLOAD_FAILED", message: "올린 목록을 처리하지 못했습니다.", status: 500, path: "/api/press/relay" });
  }
}
