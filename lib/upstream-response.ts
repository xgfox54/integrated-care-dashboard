/** Page-sized upstream reads: the same deadline covers headers AND all body bytes. */
export class UpstreamResponseError extends Error {
  readonly code: string;
  constructor(code: string, name = "UpstreamResponseError") {
    super(code); // Never include a URL, credentials, raw upstream body, or request text.
    this.code = code;
    this.name = name;
  }
}
export interface UpstreamReadOptions {
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly headers?: HeadersInit;
  readonly signal?: AbortSignal;
}
export interface BoundedUpstreamResponse {
  readonly status: number;
  readonly headers: Headers;
  text(): Promise<string>;
}
export const DEFAULT_UPSTREAM_PAGE_BYTES = 8 * 1024 * 1024;

export async function readBoundedResponseText(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError("Invalid upstream byte limit");
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    if (response.body) void response.body.cancel().catch(() => undefined);
    throw new UpstreamResponseError("UPSTREAM_BODY_TOO_LARGE");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  let removeAbort = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    const abort = () => reject(new UpstreamResponseError("UPSTREAM_ABORTED", signal.reason?.name === "TimeoutError" ? "TimeoutError" : "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    removeAbort = () => signal.removeEventListener("abort", abort);
    if (signal.aborted) abort();
  });
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let received = 0;
  try {
    while (true) {
      const item = await Promise.race([reader.read(), interrupted]);
      if (signal.aborted) throw new UpstreamResponseError("UPSTREAM_ABORTED", "AbortError");
      if (item.done) break;
      received += item.value.byteLength;
      if (received > maxBytes) throw new UpstreamResponseError("UPSTREAM_BODY_TOO_LARGE");
      chunks.push(decoder.decode(item.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof UpstreamResponseError) throw error;
    if (typeof error === "object" && error !== null && "name" in error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new UpstreamResponseError("UPSTREAM_ABORTED", error.name);
    }
    throw new UpstreamResponseError("UPSTREAM_READ_FAILED");
  } finally {
    removeAbort();
    reader.releaseLock();
  }
}

export async function fetchBoundedResponse(
  url: string,
  options: UpstreamReadOptions,
  fetcher: typeof fetch = fetch,
): Promise<BoundedUpstreamResponse> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 ||
      !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
    throw new RangeError("Invalid upstream read limits");
  }
  if (options.signal?.aborted) throw new UpstreamResponseError("UPSTREAM_ABORTED", "AbortError");
  const controller = new AbortController();
  let response: Response | undefined;
  let stopped = false;
  let rejectBoundary!: (reason: UpstreamResponseError) => void;
  const boundary = new Promise<never>((_resolve, reject) => { rejectBoundary = reject; });
  const cancel = () => {
    controller.abort();
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined);
  };
  const stop = (error: UpstreamResponseError) => {
    if (stopped) return;
    stopped = true;
    rejectBoundary(error);
    cancel();
  };
  const abort = () => stop(new UpstreamResponseError("UPSTREAM_ABORTED", "AbortError"));
  const timer = setTimeout(() => stop(new UpstreamResponseError("UPSTREAM_TIMEOUT", "TimeoutError")), options.timeoutMs);
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const pending = Promise.resolve().then(() => {
      if (options.signal?.aborted) throw new UpstreamResponseError("UPSTREAM_ABORTED", "AbortError");
      return fetcher(url, { headers: options.headers, redirect: "manual", signal: controller.signal });
    }).then((value) => {
      // A transport that ignores abort can finish after our deadline. Dispose of that body too.
      if (stopped && value.body && !value.body.locked) void value.body.cancel().catch(() => undefined);
      return value;
    });
    response = await Promise.race([pending, boundary]);
    const text = await Promise.race([readBoundedResponseText(response, options.maxBytes, controller.signal), boundary]);
    return { status: response.status, headers: new Headers(response.headers), text: async () => text };
  } catch (error) {
    stopped = true;
    cancel();
    if (error instanceof UpstreamResponseError) throw error;
    throw new UpstreamResponseError("UPSTREAM_READ_FAILED");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
