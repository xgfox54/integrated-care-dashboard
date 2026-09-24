const FETCH_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 2;

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
      if (attempt < MAX_ATTEMPTS) continue;
      const reason = error instanceof Error ? error.message : "알 수 없는 네트워크 오류";
      throw new OfficialSourceRequestError(url, reason, error);
    }

    if (!response.ok) {
      if (attempt < MAX_ATTEMPTS && response.status >= 500) continue;
      throw new OfficialSourceRequestError(url, `HTTP ${response.status}`);
    }

    return {
      text: await response.text(),
      finalUrl: response.url || url,
    };
  }
}
