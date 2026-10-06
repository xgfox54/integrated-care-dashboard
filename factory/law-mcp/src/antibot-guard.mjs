// 법제처(law.go.kr)가 자동화 요청에 보내는 JS 차단 페이지를 판정한다.
// korean-law-mcp 4.15.5의 law-antibot 모듈은 이 페이지를 해석해 우회 요청을 보낸다. 이 수집기는 우회하지 않는다.
// 판정 기준은 같은 모듈이 쓰는 표지(location.assign이 문서 앞 4KB 안에 있는 HTML)와 같게 둔다.
export const ANTIBOT_PROBE_BYTES = 4096;
export const ANTIBOT_BLOCK_CODE = "LAW_ANTIBOT_CHALLENGE_BLOCKED";

export function isLawHost(url) {
  try {
    const host = new URL(String(url)).hostname.toLowerCase();
    return host === "law.go.kr" || host.endsWith(".law.go.kr");
  } catch {
    return false;
  }
}

export function looksLikeAntibot(contentType, prefix) {
  return /html/i.test(contentType ?? "") && /location\.assign\s*\(/.test(prefix);
}

/** fetch를 감싸 차단 페이지를 403 응답으로 바꾼다. 요청 주소(인증값 OC 포함)는 기록하지 않는다. */
export function guardFetch(original, onBlocked = () => {}) {
  return async function guardedFetch(input, init) {
    const response = await original(input, init);
    const url = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
    if (!response.ok || !isLawHost(url)) return response;
    const contentType = response.headers.get("content-type") ?? "";
    if (!/html/i.test(contentType)) return response;
    const prefix = (await response.clone().text()).slice(0, ANTIBOT_PROBE_BYTES);
    if (!looksLikeAntibot(contentType, prefix)) return response;
    onBlocked();
    return new Response(JSON.stringify({ error: ANTIBOT_BLOCK_CODE }), { status: 403, headers: { "content-type": "application/json", "x-welfare-guard": ANTIBOT_BLOCK_CODE } });
  };
}
