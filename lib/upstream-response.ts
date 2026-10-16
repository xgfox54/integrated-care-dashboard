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
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let stopped = false;
  let rejectBoundary!: (reason: UpstreamResponseError) => void;
  const boundary = new Promise<never>((_resolve, reject) => { rejectBoundary = reject; });
  const cancel = () => {
    controller.abort();
    if (reader) void reader.cancel().catch(() => undefined);
    else if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined);
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
    const declared = response.headers.get("content-length");
    if (declared && /^\d+$/.test(declared) && Number(declared) > options.maxBytes) {
      throw new UpstreamResponseError("UPSTREAM_BODY_TOO_LARGE");
    }
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let received = 0;
    if (response.body) {
      reader = response.body.getReader();
      while (true) {
        const item = await Promise.race([reader.read(), boundary]);
        if (stopped) throw new UpstreamResponseError("UPSTREAM_INTERRUPTED");
        if (item.done) break;
        received += item.value.byteLength;
        if (received > options.maxBytes) throw new UpstreamResponseError("UPSTREAM_BODY_TOO_LARGE");
        chunks.push(decoder.decode(item.value, { stream: true }));
      }
    }
    chunks.push(decoder.decode());
    const text = chunks.join("");
    return { status: response.status, headers: new Headers(response.headers), text: async () => text };
  } catch (error) {
    stopped = true;
    cancel();
    if (error instanceof UpstreamResponseError) throw error;
    throw new UpstreamResponseError("UPSTREAM_READ_FAILED");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    reader?.releaseLock();
  }
}
