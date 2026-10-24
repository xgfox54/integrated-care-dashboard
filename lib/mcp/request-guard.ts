/** Reject invalid transport headers before reading any untrusted body. */
export const MCP_ALLOWED_ORIGINS: ReadonlySet<string> = new Set(["https://chatgpt.com", "https://chat.openai.com", "https://claude.ai"]);

export function mcpOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === null || origin === new URL(request.url).origin || MCP_ALLOWED_ORIGINS.has(origin);
}

export function mcpRequestError(request: Request): Response | null {
  let status: number;
  let message: string;
  if (request.method !== "POST") {
    status = 405;
    message = "Method not allowed. Use POST /mcp.";
  } else if (!mcpOriginAllowed(request)) {
    status = 403;
    message = "Origin not allowed.";
  } else if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    status = 415;
    message = "application/json required.";
  } else {
    return null;
  }
  const headers = new Headers({ "cache-control": "no-store" });
  if (status === 405) headers.set("allow", "POST");
  return Response.json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }, { status, headers });
}
