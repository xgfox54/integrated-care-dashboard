import type { PressFetcher } from "./collect.ts";
import { readBoundedResponseText } from "../upstream-response.ts";

export const MAX_PRESS_RESPONSE_BYTES = 2_000_000;

class PressCancellationError extends Error {
  constructor(name: "AbortError" | "TimeoutError") {
    super("Press request canceled or timed out");
    this.name = name;
  }
}

/** 호스팅 취소 객체의 prototype에 의존하지 않는다. 다른 오류는 원래대로 전달한다. */
function isCancellation(error: unknown): error is { readonly name: "AbortError" | "TimeoutError" } {
  return typeof error === "object" && error !== null && "name" in error && (error.name === "AbortError" || error.name === "TimeoutError");
}

/** 취소 객체는 호출 측 실행 영역의 Error 생성자와 달라도 식별한다. */
export function isPressFetchFailure(error: unknown): boolean {
  return error instanceof Error || isCancellation(error);
}

function rethrowFetchError(error: unknown): never {
  if (isCancellation(error)) {
    throw new PressCancellationError(error.name);
  }
  throw error;
}

/** 기관 응답 시간 제한. 수집과 robots.txt 점검에서 같은 정책을 쓴다. */
export function timedPressFetcher(timeoutMs: number, deadlineAt?: number): PressFetcher {
  return async (url, headers) => {
    const remainingMs = deadlineAt === undefined ? timeoutMs : Math.min(timeoutMs, deadlineAt * 1000 - Date.now());
    if (remainingMs <= 0) throw new PressCancellationError("TimeoutError");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new PressCancellationError("TimeoutError")), remainingMs);
    try {
      const response = await fetch(url, { headers, redirect: "manual", signal: controller.signal });
      if (response.body === null) clearTimeout(timer);
      return {
        status: response.status,
        headers: response.headers,
        discard() {
          clearTimeout(timer);
          controller.abort();
          if (response.body && !response.body.locked) void response.body.cancel().catch(() => undefined);
        },
        async text() {
          try {
            return await readBoundedResponseText(response, MAX_PRESS_RESPONSE_BYTES, controller.signal);
          } catch (error) {
            controller.abort();
            rethrowFetchError(error);
          } finally {
            clearTimeout(timer);
          }
        },
      };
    } catch (error) {
      clearTimeout(timer);
      rethrowFetchError(error);
    }
  };
}
