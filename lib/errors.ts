import { redactCredentialText } from "./credential-redaction.ts";
import { storeErrorKind } from "./store-errors.ts";
export { redactCredentialValue } from "./credential-redaction.ts";

export interface PublicErrorOptions {
  readonly code: string;
  readonly message: string;
  readonly status: number;
  readonly path: string;
}

const IPV6_PATTERN =
  /(?<![0-9A-F:])(?:(?:[0-9A-F]{1,4}:){7}[0-9A-F]{1,4}|(?:[0-9A-F]{1,4}:){1,7}:|(?:[0-9A-F]{1,4}:){1,6}:[0-9A-F]{1,4}|(?:[0-9A-F]{1,4}:){1,5}(?::[0-9A-F]{1,4}){1,2}|(?:[0-9A-F]{1,4}:){1,4}(?::[0-9A-F]{1,4}){1,3}|(?:[0-9A-F]{1,4}:){1,3}(?::[0-9A-F]{1,4}){1,4}|(?:[0-9A-F]{1,4}:){1,2}(?::[0-9A-F]{1,4}){1,5}|[0-9A-F]{1,4}:(?:(?::[0-9A-F]{1,4}){1,6})|:(?:(?::[0-9A-F]{1,4}){1,7}|:))(?![0-9A-F:])/gi;

const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  [/\bauthorization\s*[:=]\s*[^\r\n]*/gi, "[CREDENTIAL]"],
  [/\b(?:cookie|set-cookie)\s*[:=]\s*[^\r\n]*/gi, "[CREDENTIAL]"],
  [/\b(?:api[_-]?key|token)\s*[:=]\s*[^\s,;]+/gi, "[CREDENTIAL]"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]"],
  [/\b0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}\b/g, "[PHONE]"],
  [/\b\d{6}[- ]?[1-4]\d{6}\b/g, "[RRN]"],
  [IPV6_PATTERN, "[IP]"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[IP]"],
];

export function redactLogText(value: string): string {
  return REDACTIONS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), redactCredentialText(value));
}

function errorDetails(error: unknown): string {
  // Exception messages/stacks can contain raw questions, SQL, URLs or unknown credential formats.
  if (!(error instanceof Error)) return "UnknownError";
  const allowed = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "AbortError", "TimeoutError", "LawApiError", "McpToolError", "RequestBodyError"]);
  return allowed.has(error.name) ? error.name : "Error";
}

export function logServerError(
  error: unknown,
  context: Pick<PublicErrorOptions, "path" | "status"> & { readonly code?: string },
  requestId = crypto.randomUUID(),
): string {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    requestId,
    path: redactLogText(context.path.split(/[?#]/, 1)[0]).slice(0, 200),
    status: context.status,
    code: context.code ?? "INTERNAL_ERROR",
    error: errorDetails(error),
    ...(storeErrorKind(error) ? { store: storeErrorKind(error) } : {}),
  }));
  return requestId;
}

export function errorResponse(error: unknown, options: PublicErrorOptions): Response {
  const requestId = logServerError(error, options);
  return Response.json(
    { error: options.code, message: options.message, requestId },
    { status: options.status, headers: { "cache-control": "no-store" } },
  );
}
