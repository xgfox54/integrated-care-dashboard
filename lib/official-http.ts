import { COLLECTION_RETRY_POLICY, isRetryableStatus, retryAfterMs, retryDelayMs, sleep, type RetryPolicy } from "./retry-policy.ts";

const FETCH_TIMEOUT_MS = 30_000;

export type OfficialFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface OfficialHtmlResponse {
  readonly text: string;
  readonly finalUrl: string;
}

class OfficialSourceRequestError extends Error {
  readonly url: string;

  constructor(url: string, reason: string, cause?: unknown) {
    super(`보건복지부 자료 요청 실패(${url}): ${reason}`, { cause });
    this.name = "OfficialSourceRequestError";
    this.url = url;
  }
}

export async function fetchOfficialHtml(
  url: string,
  fetcher: OfficialFetch = fetch,
  policy: RetryPolicy = COLLECTION_RETRY_POLICY,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<OfficialHtmlResponse> {
  let attempt = 0;
  while (true) {
    attempt += 1;
    let response: Response;
    try {
      response = await fetcher(url, {
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: "text/html,application/xhtml+xml" },
      });
    } catch (error) {
      const delay = attempt < policy.maxAttempts ? retryDelayMs(attempt, policy, null) : null;
      if (delay !== null) {
        await wait(delay);
        continue;
      }
      const reason = error instanceof Error ? error.message : "알 수 없는 네트워크 오류";
      throw new OfficialSourceRequestError(url, reason, error);
    }

    if (!response.ok) {
      const delay = attempt < policy.maxAttempts && isRetryableStatus(response.status)
        ? retryDelayMs(attempt, policy, retryAfterMs(response.headers.get("retry-after")))
        : null;
      if (delay !== null) {
        await wait(delay);
        continue;
      }
      const deferred = response.status === 429 ? " (재시도 안내 시간이 수집 단위보다 길어 다음 회차로 미룸)" : "";
      throw new OfficialSourceRequestError(url, `HTTP ${response.status}${deferred}`);
    }

    return {
      text: await response.text(),
      finalUrl: response.url || url,
    };
  }
}
