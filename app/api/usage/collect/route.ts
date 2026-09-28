import { after } from "next/server";

import { getD1 } from "@/lib/d1";
import { isAdminRequest } from "@/lib/usage/admin-exclusion";
import { runUsageCleanupIfDue } from "@/lib/usage/cleanup";
import { MAX_REQUEST_BYTES } from "@/lib/usage/codes";
import { ingestUsageEvents, type SqlDatabase } from "@/lib/usage/ingest";
import { isAllowedUsageFilter, resolveUsageEntity } from "@/lib/usage/registry";
import { parseUsageEnvelope } from "@/lib/usage/schema";
import { isAllowedCollectHost, takeRateToken } from "@/lib/usage/request-guard";
import { readUsageEnabled } from "@/lib/usage/settings";

export const dynamic = "force-dynamic";

// 이용통계 수집 API. 공개 이용자의 이벤트 입력만 받는다(조회·수정 기능 없음).
// 요청 본문·헤더를 기록하지 않고, 거절한 요청의 원문도 남기지 않는다.

const NO_STORE = { "cache-control": "no-store" };

function reply(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function sameOrigin(request: Request): boolean {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") return origin === url.origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

async function readLimitedText(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_REQUEST_BYTES) return null;
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_REQUEST_BYTES) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isAllowedCollectHost(new URL(request.url).hostname) || !sameOrigin(request)) return reply({ error: "forbidden" }, 403);
  if (!(await takeRateToken(request))) return reply({ error: "rate_limited" }, 429);
  const text = await readLimitedText(request);
  if (text === null) return reply({ error: "too_large" }, 413);
  if (!(await readUsageEnabled())) return reply({ collecting: false });
  if (await isAdminRequest(request)) return reply({ collecting: true, excluded: true });
  const envelope = parseUsageEnvelope(text);
  if (!envelope) return reply({ error: "invalid" }, 400);
  try {
    const result = await ingestUsageEvents(getD1() as unknown as SqlDatabase, envelope.events, {
      now: Date.now(),
      nonce: () => crypto.randomUUID(),
      resolveEntity: resolveUsageEntity,
      isAllowedFilter: isAllowedUsageFilter,
    });
    after(() => runUsageCleanupIfDue().catch(() => undefined));
    return reply({ collecting: true, ...result });
  } catch {
    console.error("usage collect failed");
    return reply({ error: "unavailable" }, 503);
  }
}

