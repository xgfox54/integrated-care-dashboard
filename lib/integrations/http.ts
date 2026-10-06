// 외부 공공 API 응답을 한 가지 결과 상태로 분류한다. 정상 0건·인증 누락/실패·호출한도·일시 장애·미지원 조회를 구분하고,
// 실패를 0건이나 성공으로 바꾸지 않는다. 판정 근거는 2026-10-05 실제 무인증 응답(docs/integrations/samples/no-key-responses-2026-10-05.json)과
// 공공데이터포털 오류코드표·KOSIS FAQ(오류 30·31·40·50)·국민건강보험공단 활용가이드다.

export type OutcomeKind =
  | "OK"
  | "EMPTY"
  | "AUTH_MISSING"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "TRANSIENT"
  | "UNSUPPORTED"
  | "BLOCKED"
  | "PARSE_ERROR";

export interface Outcome {
  readonly kind: OutcomeKind;
  readonly httpStatus: number;
  /** 원천 결과코드(예: 30, -4, err 11). 없으면 null. */
  readonly code: string | null;
  /** 이용자에게 보일 수 있는 짧은 설명. 인증값·요청 주소를 넣지 않는다. */
  readonly message: string;
  /** Retry-After 또는 원천 안내로 정한 다시 시도 가능 시각까지의 초. */
  readonly retryAfterSeconds: number | null;
}

export interface HttpLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type Provider = "DATA_GO_KR" | "ODCLOUD" | "KOSIS";

/** 실패로 끝난 결과만 다시 시도할 가치가 있다(일시 장애·호출한도). 인증·미지원·차단은 다시 시도하지 않는다. */
export function retryable(kind: OutcomeKind): boolean {
  return kind === "TRANSIENT" || kind === "RATE_LIMITED";
}

/** 결과가 수집 성공(자료 있음 또는 정상 0건)인가. */
export function succeeded(kind: OutcomeKind): boolean {
  return kind === "OK" || kind === "EMPTY";
}

/** Retry-After 헤더(초 또는 HTTP 날짜)를 초로. 없거나 읽을 수 없으면 null. 최대 1일로 자른다. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Math.min(Number(text), 86_400);
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(0, Math.ceil((at - nowMs) / 1000)), 86_400);
}

/** 지수 백오프(초). attempt 1부터. 기본 30초에서 두 배씩, 최대 6시간. Retry-After가 더 길면 그 값을 쓴다. */
export function backoffSeconds(attempt: number, retryAfter: number | null = null, baseSeconds = 30): number {
  const exponential = Math.min(baseSeconds * 2 ** Math.max(0, attempt - 1), 6 * 3600);
  return Math.max(exponential, retryAfter ?? 0);
}

const DATA_GO_KR_CODES: Readonly<Record<string, OutcomeKind>> = {
  "00": "OK", "0": "OK", "INFO-0": "OK", "INFO-00": "OK",
  "03": "EMPTY", "INFO-200": "EMPTY",
  "01": "TRANSIENT", "02": "TRANSIENT", "04": "TRANSIENT", "05": "TRANSIENT", "99": "TRANSIENT",
  "10": "UNSUPPORTED", "11": "UNSUPPORTED", "12": "UNSUPPORTED",
  "20": "AUTH_FAILED", "30": "AUTH_FAILED", "31": "AUTH_FAILED", "32": "AUTH_FAILED", "33": "AUTH_FAILED",
  "22": "RATE_LIMITED", "23": "RATE_LIMITED",
  "29": "BLOCKED",
};

const KOSIS_CODES: Readonly<Record<string, OutcomeKind>> = {
  "10": "AUTH_MISSING", "11": "AUTH_FAILED",
  "20": "UNSUPPORTED", "21": "UNSUPPORTED",
  "30": "EMPTY",
  "31": "UNSUPPORTED",
  "40": "RATE_LIMITED", "41": "UNSUPPORTED", "42": "BLOCKED",
  "50": "TRANSIENT",
};

function tag(xml: string, name: string): string | null {
  const open = "<" + name + ">";
  const start = xml.indexOf(open);
  if (start < 0) return null;
  const end = xml.indexOf("</" + name + ">", start);
  return end < 0 ? null : xml.slice(start + open.length, end).trim();
}

function outcome(kind: OutcomeKind, httpStatus: number, code: string | null, message: string, retryAfterSeconds: number | null = null): Outcome {
  return { kind, httpStatus, code, message, retryAfterSeconds };
}

function httpStatusKind(status: number): OutcomeKind | null {
  if (status === 429) return "RATE_LIMITED";
  if (status === 401) return "AUTH_FAILED";
  if (status === 403) return "AUTH_FAILED";
  if (status === 404 || status === 405 || status === 400) return "UNSUPPORTED";
  if (status >= 500 || status === 408) return "TRANSIENT";
  if (status >= 300) return "TRANSIENT";
  return null;
}

/**
 * 공공데이터포털 게이트웨이(apis.data.go.kr): 오류는 OpenAPI_ServiceResponse.cmmMsgHeader(JSON·XML)로,
 * 정상은 response.header.resultCode로 온다. 키 누락(SERVICE_KEY_IS_NULL, 20)은 AUTH_MISSING으로 따로 둔다.
 */
export function classifyDataGoKr(status: number, contentType: string, body: string, retryAfter: number | null): Outcome {
  const trimmed = body.trim();
  let gatewayCode: string | null = null;
  let gatewayMessage: string | null = null;
  let resultCode: string | null = null;
  let resultMessage: string | null = null;
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const gateway = (parsed.OpenAPI_ServiceResponse as { cmmMsgHeader?: Record<string, unknown> } | undefined)?.cmmMsgHeader;
      if (gateway) {
        gatewayCode = String(gateway.returnReasonCode ?? "");
        gatewayMessage = String(gateway.errMsg ?? "");
      }
      const header = ((parsed.response as { header?: Record<string, unknown> } | undefined)?.header) ?? (parsed.header as Record<string, unknown> | undefined);
      if (header) {
        resultCode = String(header.resultCode ?? "");
        resultMessage = String(header.resultMsg ?? "");
      } else {
        // 법정동코드 API처럼 head 배열 안 RESULT에 결과코드를 두는 형식
        const flat = JSON.stringify(parsed);
        resultCode = /"resultCode":"([^"]*)"/.exec(flat)?.[1] ?? null;
        resultMessage = /"resultMsg":"([^"]*)"/.exec(flat)?.[1] ?? null;
      }
    } catch {
      return outcome("PARSE_ERROR", status, null, "응답 JSON을 해석하지 못했습니다.");
    }
  } else if (trimmed.startsWith("<")) {
    if (trimmed.includes("<OpenAPI_ServiceResponse")) {
      gatewayCode = tag(trimmed, "returnReasonCode");
      gatewayMessage = tag(trimmed, "errMsg");
    } else {
      resultCode = tag(trimmed, "resultCode");
      resultMessage = tag(trimmed, "resultMsg");
    }
  } else if (status >= 200 && status < 300) {
    return outcome("PARSE_ERROR", status, null, "응답 형식(" + (contentType || "알 수 없음") + ")을 해석하지 못했습니다.");
  }
  if (gatewayCode !== null) {
    if (gatewayMessage === "SERVICE_KEY_IS_NULL") return outcome("AUTH_MISSING", status, gatewayCode, "인증키가 설정되지 않았습니다.");
    const kind = DATA_GO_KR_CODES[gatewayCode] ?? httpStatusKind(status) ?? "TRANSIENT";
    return outcome(kind === "OK" ? "TRANSIENT" : kind, status, gatewayCode, gatewayMessage || "공공데이터포털 게이트웨이 오류", kind === "RATE_LIMITED" ? retryAfter ?? (gatewayCode === "22" ? 3600 : 60) : retryAfter);
  }
  const byStatus = httpStatusKind(status);
  if (byStatus) return outcome(byStatus, status, resultCode, resultMessage || "HTTP " + status, retryAfter);
  if (resultCode === null || resultCode === "") return outcome("PARSE_ERROR", status, null, "결과코드가 없는 응답입니다.");
  const kind = DATA_GO_KR_CODES[resultCode];
  // 명세에 없는 결과코드는 성공·0건으로 보지 않는다.
  if (!kind) return outcome("PARSE_ERROR", status, resultCode, "알 수 없는 결과코드 " + resultCode + (resultMessage ? "(" + resultMessage + ")" : ""));
  return outcome(kind, status, resultCode, resultMessage || "결과코드 " + resultCode);
}

/** 정부24 공공서비스(api.odcloud.kr): 오류는 HTTP 상태와 {code, msg}로 온다. 정상은 {page, perPage, totalCount, data}. */
export function classifyOdcloud(status: number, body: string, retryAfter: number | null): Outcome {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return outcome(httpStatusKind(status) ?? "PARSE_ERROR", status, null, "응답 JSON을 해석하지 못했습니다.", retryAfter);
  }
  const code = parsed && "code" in parsed ? String(parsed.code) : null;
  if (code === "-401") return outcome("AUTH_MISSING", status, code, "인증키가 설정되지 않았습니다.");
  if (code === "-4") return outcome("AUTH_FAILED", status, code, "등록되지 않은 인증키입니다.");
  const byStatus = httpStatusKind(status);
  if (byStatus) return outcome(byStatus, status, code, String(parsed?.msg ?? "HTTP " + status), retryAfter);
  if (!Array.isArray(parsed?.data)) return outcome("PARSE_ERROR", status, code, "data 배열이 없는 응답입니다.");
  return outcome((parsed.data as unknown[]).length ? "OK" : "EMPTY", status, null, "정상");
}

/** KOSIS: 오류도 HTTP 200으로 오고 본문 {err, errMsg}로 구분한다. 정상은 배열(JSON). */
export function classifyKosis(status: number, body: string, retryAfter: number | null): Outcome {
  const byStatus = httpStatusKind(status);
  if (byStatus) return outcome(byStatus, status, null, "HTTP " + status, retryAfter);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return outcome("PARSE_ERROR", status, null, "응답 JSON을 해석하지 못했습니다.");
  }
  if (Array.isArray(parsed)) return outcome(parsed.length ? "OK" : "EMPTY", status, null, "정상");
  if (parsed && typeof parsed === "object" && "err" in parsed) {
    const code = String((parsed as { err: unknown }).err);
    const kind = KOSIS_CODES[code] ?? "TRANSIENT";
    return outcome(kind, status, "err " + code, String((parsed as { errMsg?: unknown }).errMsg ?? "KOSIS 오류"), kind === "RATE_LIMITED" ? retryAfter ?? 3600 : retryAfter);
  }
  return outcome("PARSE_ERROR", status, null, "알 수 없는 응답 형식입니다.");
}

export async function classify(provider: Provider, response: HttpLike, nowMs: number): Promise<{ readonly outcome: Outcome; readonly body: string }> {
  const body = await response.text();
  const retryAfter = parseRetryAfter(response.headers.get("retry-after"), nowMs);
  const contentType = response.headers.get("content-type") ?? "";
  if (provider === "DATA_GO_KR") return { outcome: classifyDataGoKr(response.status, contentType, body, retryAfter), body };
  if (provider === "ODCLOUD") return { outcome: classifyOdcloud(response.status, body, retryAfter), body };
  return { outcome: classifyKosis(response.status, body, retryAfter), body };
}

/** 요청 주소에서 인증값을 지운 조회 근거. 기록·화면·보고서에는 이것만 쓴다. */
export function redactQuery(url: string): string {
  const parsed = new URL(url);
  for (const name of [...parsed.searchParams.keys()]) {
    if (/^(servicekey|apikey|oc|key)$/i.test(name)) parsed.searchParams.set(name, "<redacted>");
  }
  return parsed.origin + parsed.pathname + (parsed.search ? decodeURIComponent(parsed.search) : "");
}

/** 응답 원문의 SHA-256(16진). 같은 자료를 다시 받았는지 판정하는 데 쓴다. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
