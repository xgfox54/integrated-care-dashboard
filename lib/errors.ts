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
  return REDACTIONS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value);
}

function errorDetails(error: unknown): string {
  if (typeof error === "string") return redactLogText(error).slice(0, 4000);
  if (!(error instanceof Error)) return "UnknownError";
  return redactLogText(`${error.name}: ${error.message}\n${error.stack ?? ""}`).slice(0, 4000);
}

export function logServerError(
  error: unknown,
  context: Pick<PublicErrorOptions, "path" | "status"> & { readonly code?: string },
  requestId = crypto.randomUUID(),
): string {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    requestId,
    path: context.path,
    status: context.status,
    code: context.code ?? "INTERNAL_ERROR",
    error: errorDetails(error),
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
