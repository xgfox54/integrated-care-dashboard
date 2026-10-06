// 링크·게시일·식별자를 정규화한다. 게시일은 RSS가 준 의미(pubDate)를 그대로 기록하고 발견일로 대체하지 않는다.

const TRACKING_PARAM = /^(?:utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid)$/i;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;
const EARLIEST_PLAUSIBLE_MS = Date.UTC(2000, 0, 1);

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 허용 호스트의 https 주소만 통과시킨다. 허용 호스트의 http 링크는 https로 올린다. 사용자 정보·비표준 포트·추적 파라미터는 걸러낸다. */
export function canonicalizeUrl(raw: string, allowedHosts: readonly string[]): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol === "http:" && !url.port) url.protocol = "https:";
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  if (!allowedHosts.includes(host)) return null;
  const kept = [...url.searchParams.entries()].filter(([key]) => !TRACKING_PARAM.test(key));
  url.hash = "";
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);
  return url.toString();
}

/** 게시물 번호(list_no 등)가 있으면 그것을, 없으면 GUID, 그도 없으면 주소 해시를 원천 식별자로 쓴다. */
export async function originIdOf(canonicalUrl: string, guid: string): Promise<string> {
  const listNo = new URL(canonicalUrl).searchParams.get("list_no");
  if (listNo && /^[\w-]{1,40}$/.test(listNo)) return listNo;
  if (guid) return guid;
  return (await sha256Hex(canonicalUrl)).slice(0, 24);
}

export interface PublicationDate {
  readonly epoch: number | null;
  readonly date: string;
  readonly precision: "datetime" | "date" | "unknown";
}

/** RFC 822 날짜는 KST 기준 날짜로, 게시판의 YYYY-MM-DD는 날짜만 있는 값으로 둔다. 읽을 수 없거나 미래·너무 오래된 값은 날짜 미확인이다. */
export function parsePublicationDate(input: string, nowSeconds: number): PublicationDate {
  const unknown: PublicationDate = { epoch: null, date: "", precision: "unknown" };
  // 시간대 표시가 없는 국내 기관 날짜(2026/10/02, 2026.10.02, 2026-10-02 16:20:35.0)는 한국시간으로 읽는다.
  let raw = input;
  const local = /^(\d{4})[-./](\d{2})[-./](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/.exec(input.trim());
  if (local) {
    const [, year, month, day, hour, minute, second] = local;
    if (hour === undefined) raw = `${year}-${month}-${day}`;
    else raw = `${year}-${month}-${day}T${hour}:${minute}:${second ?? "00"}+09:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const midnight = Date.parse(`${raw}T00:00:00+09:00`);
    const valid = !Number.isNaN(midnight) && new Date(midnight + KST_OFFSET_MS).toISOString().slice(0, 10) === raw;
    if (!valid || midnight < EARLIEST_PLAUSIBLE_MS || midnight > nowSeconds * 1000 + FUTURE_TOLERANCE_MS) return unknown;
    return { epoch: null, date: raw, precision: "date" };
  }
  const milliseconds = raw ? Date.parse(raw) : Number.NaN;
  if (Number.isNaN(milliseconds)) return unknown;
  if (milliseconds < EARLIEST_PLAUSIBLE_MS || milliseconds > nowSeconds * 1000 + FUTURE_TOLERANCE_MS) return unknown;
  return {
    epoch: Math.floor(milliseconds / 1000),
    date: new Date(milliseconds + KST_OFFSET_MS).toISOString().slice(0, 10),
    precision: "datetime",
  };
}
