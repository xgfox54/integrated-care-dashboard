import { getD1 } from "@/lib/d1";
import { errorResponse } from "@/lib/errors";
import { McpData } from "@/lib/mcp/data";
import { readWikiContext } from "@/lib/wiki-context";
import { cachedWikiEdits } from "@/lib/wiki-edit-store";

export const dynamic = "force-dynamic";

/** 위키 사업 통합 문맥(문서 근거·검토된 예산 연결·관련 보도 링크). 외부 MCP와 같은 도구·공개본으로 만든다. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = (url.searchParams.get("service") ?? "").trim();
  if (!id.startsWith("service:") || id.length > 400) {
    return Response.json({ error: "INVALID_SERVICE", message: "service: 로 시작하는 사업 ID가 필요합니다." }, { status: 400, headers: { "cache-control": "no-store" } });
  }
  try {
    const result = await readWikiContext(() => new McpData(getD1(), cachedWikiEdits), url.origin, id);
    return Response.json(result, { status: result.ok ? 200 : result.code === "NOT_FOUND" || result.code === "MISSING_FROM_LATEST_SOURCE" ? 404 : 502, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, { code: "WIKI_CONTEXT_FAILED", message: "통합 문맥을 불러오지 못했습니다.", status: 500, path: "/api/wiki/context" });
  }
}
