import { DEFAULT_EXECUTION_LIMITS, RequestExecutionBudget } from "korean-law-mcp/lib/execution-limits";
import { runWithRequestContext } from "korean-law-mcp/lib/session-state";
import { readBoundedJson, RequestBodyError } from "../request-body.ts";

import {
  KOREAN_LAW_PACKAGE_VERSION,
  LAW_WEB_TOOL_NAMES,
  isLawWebToolName,
  runLawTool,
} from "./mcp-tools.ts";

const MAX_REQUEST_BYTES = 64 * 1024;
const NO_STORE = { "cache-control": "no-store" };
const OFFICIAL_LAW_URL = "https://www.law.go.kr";

export interface LawHttpEnvironment {
  readonly LAW_OC?: string;
}

function reply(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function sameOrigin(request: Request): boolean {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin !== null) return origin === expected;
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === null || fetchSite === "same-origin";
}

export async function handleLawHttpRequest(request: Request, env: LawHttpEnvironment): Promise<Response> {
  if (request.method === "GET") {
    return reply({
      ok: true,
      configured: Boolean(env.LAW_OC?.trim()),
      implementation: "embedded",
      package: "korean-law-mcp",
      package_version: KOREAN_LAW_PACKAGE_VERSION,
      source: OFFICIAL_LAW_URL,
      tools: LAW_WEB_TOOL_NAMES,
    });
  }
  if (request.method !== "POST") {
    return Response.json(
      { error: "METHOD_NOT_ALLOWED", message: "GET 또는 POST 요청만 지원합니다." },
      { status: 405, headers: { ...NO_STORE, allow: "GET, POST" } },
    );
  }
  if (!sameOrigin(request)) return reply({ error: "ORIGIN_NOT_ALLOWED", message: "같은 사이트 요청만 허용합니다." }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return reply({ error: "UNSUPPORTED_MEDIA_TYPE", message: "application/json 요청만 지원합니다." }, 415);
  }
  const apiKey = env.LAW_OC?.trim();
  if (!apiKey) {
    return reply({
      error: "LAW_API_NOT_CONFIGURED",
      message: "운영 서버에 법제처 OPEN API 인증값(LAW_OC)이 설정되지 않았습니다.",
    }, 503);
  }
  let body: unknown;
  try {
    body = await readBoundedJson(request, { maxBytes: MAX_REQUEST_BYTES });
  } catch (error) {
    // 기존 공개 오류 계약(REQUEST_TOO_LARGE·INVALID_REQUEST)을 유지하고, 수신 시간 초과만 408로 구분한다.
    if (error instanceof RequestBodyError && error.status === 413) {
      return reply({ error: "REQUEST_TOO_LARGE", message: "요청 본문은 64 KiB 이하여야 합니다." }, 413);
    }
    if (error instanceof RequestBodyError && error.status === 408) {
      return reply({ error: error.code, message: error.message }, 408);
    }
    return reply({ error: "INVALID_REQUEST", message: "요청 본문을 확인해 주세요." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reply({ error: "INVALID_REQUEST", message: "요청 본문을 확인해 주세요." }, 400);
  }
  const record = body as Record<string, unknown>;
  if (!isLawWebToolName(record.tool)) {
    return reply({
      error: "UNSUPPORTED_TOOL",
      message: "웹 화면에서 지원하지 않는 법령 도구입니다.",
      tools: LAW_WEB_TOOL_NAMES,
    }, 400);
  }
  const tool = record.tool;
  const args = record.args && typeof record.args === "object" && !Array.isArray(record.args) ? record.args : {};
  const result = await runWithRequestContext({
    apiKey,
    signal: request.signal,
    budget: new RequestExecutionBudget(DEFAULT_EXECUTION_LIMITS),
  }, () => runLawTool(tool, args, { apiKey }));
  const text = result.content.map((item) => item.text).join("\n");
  return reply({
    ok: !result.isError,
    tool,
    text,
    package_version: KOREAN_LAW_PACKAGE_VERSION,
    source: OFFICIAL_LAW_URL,
    ...(result.isError ? { error: "LAW_TOOL_ERROR" } : {}),
  }, result.isError ? 422 : 200);
}
