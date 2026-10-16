/** Bounded UTF-8 JSON reader. Never buffer the complete oversized input first. */
export class RequestBodyError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "RequestBodyError";
    this.code = code;
    this.status = status;
  }
}

export interface BodyReadOptions {
  readonly maxBytes: number;
  readonly timeoutMs?: number;
}

type BodySource = Pick<Request, "headers" | "body" | "signal">;

export async function readBoundedBody(request: BodySource, options: BodyReadOptions): Promise<Uint8Array> {
  const { maxBytes, timeoutMs = 10_000 } = options;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("Invalid request body limits");
  }
  const fail = (code: string, status: number, message: string): never => {
    if (request.body && !request.body.locked) void request.body.cancel().catch(() => undefined);
    throw new RequestBodyError(code, status, message);
  };
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared.trim()) || !Number.isSafeInteger(Number(declared))) {
      fail("INVALID_CONTENT_LENGTH", 400, "요청 길이 형식이 올바르지 않습니다.");
    }
    if (Number(declared) > maxBytes) fail("PAYLOAD_TOO_LARGE", 413, "요청 본문 크기가 허용 한도를 초과했습니다.");
  }
  if (request.signal.aborted) fail("REQUEST_ABORTED", 400, "요청이 취소되었습니다.");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  let rejectBoundary!: (reason: RequestBodyError) => void;
  const boundary = new Promise<never>((_resolve, reject) => { rejectBoundary = reject; });
  const abort = () => rejectBoundary(new RequestBodyError("REQUEST_ABORTED", 400, "요청이 취소되었습니다."));
  const timer = setTimeout(() => rejectBoundary(new RequestBodyError("REQUEST_TIMEOUT", 408, "요청 본문 수신 시간이 초과되었습니다.")), timeoutMs);
  request.signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (request.signal.aborted) abort();
    while (true) {
      const { value, done } = await Promise.race([reader.read(), boundary]);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new RequestBodyError("INVALID_BODY", 400, "요청 본문 형식이 올바르지 않습니다.");
      size += value.byteLength;
      if (size > maxBytes) throw new RequestBodyError("PAYLOAD_TOO_LARGE", 413, "요청 본문 크기가 허용 한도를 초과했습니다.");
      chunks.push(value);
    }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    return buffer;
  } catch (error) {
    // Cancellation must not wait for a potentially hostile underlying source.
    void reader.cancel().catch(() => undefined);
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError("INVALID_BODY", 400, "요청 본문을 읽지 못했습니다.");
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

export async function readBoundedJson(request: BodySource, options: BodyReadOptions): Promise<unknown> {
  const bytes = await readBoundedBody(request, options);
  if (bytes.byteLength === 0) throw new RequestBodyError("EMPTY_BODY", 400, "요청 본문이 비어 있습니다.");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new RequestBodyError("INVALID_UTF8", 400, "UTF-8 요청 본문이 필요합니다."); }
  try { return JSON.parse(text); }
  catch { throw new RequestBodyError("INVALID_JSON", 400, "JSON 요청 본문 형식이 올바르지 않습니다."); }
}
