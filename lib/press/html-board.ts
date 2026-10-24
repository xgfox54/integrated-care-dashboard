import { cleanText, FeedFormatError, type PressFeedItem } from "./rss.ts";

// 공식 보도자료 HTML 게시판 목록에서 게시물 번호·제목·게시일만 뽑는 선언형 Adapter.
// 게시판마다 아래 설정만 다르다. 설정에는 정규식과 주소 틀만 넣고 실행 코드는 넣지 않는다.
// 목록에 함께 실린 요약·본문(.txt, .cont 등)은 제목 위치로 지정하지 않는 한 읽지 않는다.

export interface HtmlBoardProfile {
  /** <a> 태그 속성 문자열에 맞추는 정규식. 이름 붙은 그룹 id 가 게시물 번호다. */
  readonly link: string;
  /** 원문 주소 틀. {id} 자리에 게시물 번호가 들어간다. */
  readonly url: string;
  /** "text", "attr:title", "js-string:wdigm_title"(실행하지 않는 제목 리터럴), 또는 링크 안쪽 HTML 정규식(그룹 1). */
  readonly title: string;
  /** 게시물 구간에서 게시일을 잡는 정규식(그룹 1). 없으면 첫 YYYY-MM-DD 형태 날짜를 쓴다. */
  readonly date?: string;
  /** 긴 표형 목록은 같은 tr 안에서만 게시일을 읽는다. 다음 행 날짜는 사용하지 않는다. */
  readonly dateScope?: "row";
  /** 다음 쪽 목록 주소 틀({page} 자리에 쪽 번호). 공백이 의심될 때만 2~3쪽을 읽는다(제한 backfill). */
  readonly page?: string;
  /**
   * 게시물 링크 요소. 기본 "a". 목록 행을 <button onclick=…>으로 그리는 게시판만 "button".
   * "a-unclosed"는 </a> 없이 칸(</td>·</li>)이 끝나는 게시판(인제군 등): 링크 안쪽을 다음 </a>·</td>·</li>·<a 앞까지로 본다.
   */
  readonly tag?: "a" | "button" | "a-unclosed" | "td" | "form";
  /**
   * "before": 제목·게시일이 링크 앞에 따로 있는 카드형 목록(완주군 등). 직전 게시물 링크부터 이 링크 앞까지에서
   * 제목 정규식의 마지막 일치를 제목으로 쓴다. 제목은 정규식으로만 지정한다.
   */
  readonly titleScope?: "before";
}

const MAX_HTML_CHARS = 2_000_000;
const MAX_ITEMS = 100;
const MAX_TITLE_CHARS = 300;
const SEGMENT_LIMIT = 4000;
const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const ANCHOR_UNCLOSED = /<a\b([^>]*)>([\s\S]*?)(?=<\/a>|<\/td>|<\/li>|<a\b)/gi;
const BUTTON = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
// 표 칸 전체에 onclick이 걸린 목록(새올 보도자료 등)과, 게시물마다 form action에 번호가 있는 목록(증평군 등).
const TABLE_CELL = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
const FORM = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
const TAGS = { a: ANCHOR, button: BUTTON, "a-unclosed": ANCHOR_UNCLOSED, td: TABLE_CELL, form: FORM } as const;
const BEFORE_LIMIT = 16_000;

function isBoardTag(value: unknown): value is keyof typeof TAGS {
  return typeof value === "string" && Object.hasOwn(TAGS, value);
}
const DEFAULT_DATE = /(20\d{2})[-./]\s?(\d{1,2})[-./]\s?(\d{1,2})/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** DB에 저장된 설정을 검사한다. 잘못되면 null. */
export function parseBoardProfile(json: string): HtmlBoardProfile | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!isRecord(value)) return null;
  const { link, url, title, date, dateScope, page, tag, titleScope } = value;
  if (typeof link !== "string" || typeof url !== "string" || typeof title !== "string") return null;
  if (date !== undefined && typeof date !== "string") return null;
  if (dateScope !== undefined && dateScope !== "row") return null;
  if (tag !== undefined && !isBoardTag(tag)) return null;
  if (titleScope !== undefined && (titleScope !== "before" || ["text", "attr:title", "js-string:wdigm_title"].includes(title))) return null;
  if (page !== undefined && (typeof page !== "string" || page.length > 500 || !page.startsWith("https://") || !page.includes("{page}"))) return null;
  if (!link.includes("(?<id>") || !url.startsWith("https://") || !url.includes("{id}")) return null;
  for (const pattern of [link, title === "text" || title === "attr:title" ? "" : title, date ?? ""]) {
    if (pattern.length > 300) return null;
    try {
      new RegExp(pattern);
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }
  return {
    link, url, title, ...(date === undefined ? {} : { date }), ...(dateScope === undefined ? {} : { dateScope }), ...(page === undefined ? {} : { page }),
    ...(tag === undefined ? {} : { tag }), ...(titleScope === undefined ? {} : { titleScope }),
  };
}

function stripTags(html: string): string {
  // 실제 태그(<a …>, </span> 등 영문으로 시작)만 지운다. 제목 속 '<제2회 행사>' 같은 꺾쇠 글자는 남긴다(노원구에서 제목 일부가 사라지던 문제).
  const withoutBadges = html.replace(/<(span|i)\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:new|p-icon__new|sr_only)[^"']*["'][^>]*>\s*(?:새글|new|N)\s*<\/\1>/gi, " ");
  return cleanText(withoutBadges.replace(/<\/?[A-Za-z!][^>]*>/g, " "));
}

function readTitle(profile: HtmlBoardProfile, attrs: string, inner: string): string {
  if (profile.title === "js-string:wdigm_title") {
    // 양천 공개 목록의 제목 리터럴만 해석한다. JS 표현식이나 함수는 실행하지 않는다.
    const literal = /\bwdigm_title\(\s*'((?:\\.|[^'\\])*)'\s*\)/.exec(inner)?.[1];
    return literal === undefined ? "" : cleanText(literal.replace(/\\(['"\\nrt])/g, (_, char: string) =>
      char === "n" || char === "r" || char === "t" ? " " : char));
  }
  if (profile.title === "text") return stripTags(inner);
  if (profile.title === "attr:title") {
    const match = /\btitle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    return match ? cleanText(match[2] ?? match[3] ?? "") : "";
  }
  const match = new RegExp(profile.title).exec(inner);
  return match ? stripTags(match[1] ?? "") : "";
}

/** 목록이 제목 끝을 줄였을 때만 같은 링크의 전체 title 속성으로 보완한다. 메뉴·요약은 쓰지 않는다. */
function completeTitle(title: string, candidate: Candidate): string {
  const ending = /(?:\.{3}|…|⋯)\s*$/;
  if (!ending.test(title)) return title;
  const prefix = title.replace(ending, "").trimEnd();
  if (!prefix) return title;
  const attributes = [candidate.attrs, ...[...candidate.inner.matchAll(/<(?:span|strong|em|b)\b([^>]*)>/gi)].map((match) => match[1] ?? "")];
  for (const attrs of attributes) {
    const match = /(?:^|\s)title\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const full = match ? cleanText(match[1] ?? match[2] ?? "") : "";
    if (full.length > prefix.length && full.length <= MAX_TITLE_CHARS && full.startsWith(prefix) && !ending.test(full)) return full;
  }
  return title;
}

function readDate(profile: HtmlBoardProfile, segment: string): string {
  const pattern = profile.date ? new RegExp(profile.date) : DEFAULT_DATE;
  const match = pattern.exec(segment);
  const text = profile.date ? (match?.[1] ?? "") : (match?.[0] ?? "");
  const parts = /(20\d{2})(?:[-./]|년)\s?(\d{1,2})(?:[-./]|월)\s?(\d{1,2})/.exec(text);
  // 날짜 칸을 따로 지정한 게시판만 '26.10.02.' 같은 두 자리 연도를 20yy로 읽는다(본문 속 숫자 오인 방지).
  const short = !parts && profile.date ? /^\s*(\d{2})[-./]\s?(\d{1,2})[-./]\s?(\d{1,2})\.?\s*$/.exec(text) : null;
  const year = parts?.[1] ?? (short ? "20" + short[1] : null);
  const rest = parts ?? short;
  return year && rest ? `${year}-${(rest[2] ?? "").padStart(2, "0")}-${(rest[3] ?? "").padStart(2, "0")}` : "";
}

interface Candidate {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly attrs: string;
  readonly inner: string;
}

/** 같은 공식 상세 경로와 게시물 번호가 확인된 실제 링크의 게시판·분류 조건을 보존한다. */
function candidateUrl(profile: HtmlBoardProfile, candidate: Candidate): string {
  const fallback = profile.url.replace("{id}", encodeURIComponent(candidate.id));
  const href = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(candidate.attrs);
  if (!href) return fallback;
  const raw = cleanText(href[1] ?? href[2] ?? "");
  if (!raw || raw.startsWith("#") || /^(?:javascript|data):/i.test(raw)) return fallback;
  try {
    const expected = new URL(fallback);
    const actual = new URL(raw, expected);
    if (actual.origin !== expected.origin || actual.pathname !== expected.pathname || actual.username || actual.password) return fallback;
    const marker = "PRESS_ARTICLE_ID";
    const template = new URL(profile.url.replace("{id}", marker));
    const idKey = [...template.searchParams].find(([, value]) => value === marker)?.[0];
    if (idKey && actual.searchParams.get(idKey) !== candidate.id) return fallback;
    let corrected = false;
    for (const [key, value] of expected.searchParams) {
      if (key === idKey || !/^(?:cbIdx|bbsNo|boardId|board_id|bbsId|bid|a_no|key|menuNo|menuId|menu_id|mid)$/i.test(key)) continue;
      const original = actual.searchParams.get(key);
      if (original !== null && original !== value) {
        expected.searchParams.set(key, original);
        corrected = true;
      }
    }
    return corrected ? expected.toString() : fallback;
  } catch (error) {
    if (error instanceof TypeError) return fallback;
    throw error;
  }
}

/** titleScope "before": 직전 게시물 링크 뒤부터 이 링크 앞까지에서 제목 정규식의 마지막 일치. */
function titleBefore(html: string, profile: HtmlBoardProfile, from: number, to: number): { readonly title: string; readonly segment: string } {
  const segment = html.slice(Math.max(from, to - BEFORE_LIMIT), to);
  const last = [...segment.matchAll(new RegExp(profile.title, "g"))].at(-1);
  return { title: last ? stripTags(last[1] ?? "") : "", segment: last ? segment.slice(last.index) : "" };
}

export function parseHtmlBoard(html: string, profile: HtmlBoardProfile): PressFeedItem[] {
  if (html.length > MAX_HTML_CHARS) throw new FeedFormatError("FEED_TOO_LARGE");
  const link = new RegExp(profile.link);
  const candidates: Candidate[] = [];
  for (const match of html.matchAll(TAGS[profile.tag ?? "a"])) {
    const attrs = match[1] ?? "";
    const id = link.exec(attrs)?.groups?.["id"];
    // 게시물 번호는 영문·숫자·_- 기본, 암호화 번호(base64: = + /)도 받는다. 주소에 넣을 때는 encodeURIComponent로 감싼다.
    const start = match.index ?? 0;
    if (id && /^[\w=+/-]{1,80}$/.test(id)) candidates.push({ id, start, end: start + match[0].length, attrs, inner: match[2] ?? "" });
  }
  const items = new Map<string, PressFeedItem>();
  const tableRows = profile.dateScope === "row" ? [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)] : [];
  candidates.forEach((candidate, index) => {
    if (items.size >= MAX_ITEMS) return;
    if (profile.titleScope === "before") {
      if (items.has(candidate.id)) return;
      const before = titleBefore(html, profile, candidates[index - 1]?.end ?? 0, candidate.start);
      const title = before.title.slice(0, MAX_TITLE_CHARS);
      if (title) items.set(candidate.id, { title, link: candidateUrl(profile, candidate), guid: candidate.id, pubDate: readDate(profile, before.segment) });
      return;
    }
    const title = completeTitle(readTitle(profile, candidate.attrs, candidate.inner), candidate).slice(0, MAX_TITLE_CHARS);
    if (!title || items.get(candidate.id)?.title) return;
    // 한 게시물에 링크가 여럿(사진·제목·요약)이면 다음 '다른' 게시물 링크까지를 이 게시물 구간으로 본다(게시일이 마지막 링크 뒤에 있는 게시판).
    const next = candidates.slice(index + 1).find((other) => other.id !== candidate.id);
    const end = Math.min(next?.start ?? html.length, candidate.start + SEGMENT_LIMIT);
    const tableRow = tableRows.find((row) => row.index <= candidate.start && row.index + row[0].length > candidate.start);
    items.set(candidate.id, {
      title,
      link: candidateUrl(profile, candidate),
      guid: candidate.id,
      // 링크(또는 button) 안에 게시일이 있으면 그것을 먼저 쓴다. 들여쓰기가 긴 카드형 목록은 날짜가 구간 상한(4000자) 밖에 있을 수 있다.
      pubDate: profile.dateScope === "row"
        ? readDate(profile, tableRow && tableRow[0].length <= 32_000 ? tableRow[0] : "")
        : readDate(profile, candidate.inner) || readDate(profile, html.slice(candidate.start, end)),
    });
  });
  return [...items.values()];
}
