import { handleMcpRequest } from "./mcp/server.ts";
import type { McpData } from "./mcp/data.ts";

// 위키 사업 상세의 통합 문맥(작업지시서 v5 §17.6·T138): 외부 MCP와 같은 도구(get_welfare_context·get_entity)를
// 서버 안에서 그대로 호출해, 같은 공개본·같은 연결 규칙(검토된 예산 연결만, 보도는 제목 일치 미확인 표시, 승인된 문서 사실만)을 쓴다.

interface ToolResult { readonly isError?: boolean; readonly structuredContent?: Record<string, unknown> }

async function callTool(data: McpData, origin: string, name: string, args: Record<string, unknown>): Promise<ToolResult | null> {
  const response = await handleMcpRequest(new Request(origin + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  }), data);
  if (!response.ok) return null;
  return ((await response.json()) as { result?: ToolResult }).result ?? null;
}

export async function readWikiContext(makeData: () => McpData, origin: string, implementationId: string) {
  const context = await callTool(makeData(), origin, "get_welfare_context", { implementation_id: implementationId, news_limit: 5 });
  if (!context?.structuredContent || context.isError) {
    const error = context?.structuredContent?.error as { code?: string; message?: string } | undefined;
    return { ok: false as const, code: error?.code ?? "CONTEXT_UNAVAILABLE", message: error?.message ?? "통합 문맥을 불러오지 못했습니다." };
  }
  const envelope = context.structuredContent as { release_bundle_id: string | null; generated_at: string; basis: Record<string, unknown>; data: Record<string, unknown> };
  // 문서 사실은 같은 공개본으로 고정해 읽는다(두 호출 사이에 공개본이 바뀌어도 섞이지 않게).
  const entity = await callTool(makeData(), origin, "get_entity", { entity_id: implementationId, ...(envelope.release_bundle_id ? { release_bundle_id: envelope.release_bundle_id } : {}) });
  const entityData = (entity?.structuredContent?.data ?? {}) as { document_facts?: unknown[]; temporal?: unknown };
  return {
    ok: true as const,
    release_bundle_id: envelope.release_bundle_id,
    generated_at: envelope.generated_at,
    basis: envelope.basis,
    fiscal: envelope.data.fiscal,
    news: envelope.data.news,
    document_facts: entityData.document_facts ?? [],
    temporal: entityData.temporal ?? null,
  };
}
