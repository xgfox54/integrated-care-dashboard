// 공식 보도자료 RSS 2.0에서 제목·링크·GUID·게시시각만 뽑는 제한된 파서.
// description·content·author·enclosure는 읽지도 반환하지도 않는다(본문·작성자 비수집 원칙).

export interface PressFeedItem {
  readonly title: string;
  readonly link: string;
  readonly guid: string;
  readonly pubDate: string;
}

export type FeedFormatCode = "FEED_TOO_LARGE" | "FEED_FORBIDDEN_MARKUP" | "FEED_NOT_RSS" | "PROFILE_INVALID" | "API_ERROR" | "API_KEY_INVALID";

export class FeedFormatError extends Error {
  readonly code: FeedFormatCode;

  constructor(code: FeedFormatCode) {
    super(code);
    this.name = "FeedFormatError";
    this.code = code;
  }
}

const MAX_FEED_CHARS = 2_000_000;
export const MAX_FEED_ITEMS = 500;
const MAX_TITLE_CHARS = 300;
const CDATA_OPEN = "<![CDATA[";
const CDATA_CLOSE = "]]>";
const WANTED_TAGS: ReadonlySet<string> = new Set(["title", "link", "guid", "pubDate"]);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", ndash: "–", mdash: "—",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

// 원천이 &amp;#x27;처럼 두 번 이스케이프하는 경우가 있어 엔터티는 두 번까지 푼다.
export function cleanText(raw: string): string {
  const trimmed = raw.trim();
  const inner = trimmed.startsWith(CDATA_OPEN) && trimmed.endsWith(CDATA_CLOSE)
    ? trimmed.slice(CDATA_OPEN.length, -CDATA_CLOSE.length)
    : trimmed;
  return decodeEntities(decodeEntities(inner)).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

/** CDATA 안의 꺾쇠를 건너뛰며 닫는 태그 위치를 찾는다. 없으면 -1. */
function findClose(source: string, name: string, from: number): number {
  const closing = `</${name}>`;
  let position = from;
  while (position < source.length) {
    const close = source.indexOf(closing, position);
    if (close < 0) return -1;
    const cdata = source.indexOf(CDATA_OPEN, position);
    if (cdata < 0 || cdata > close) return close;
    const cdataEnd = source.indexOf(CDATA_CLOSE, cdata);
    if (cdataEnd < 0) return -1;
    position = cdataEnd + CDATA_CLOSE.length;
  }
  return -1;
}

/** item 한 개의 직계 자식 중 필요한 태그의 첫 값만 모은다. */
function readWantedChildren(block: string): Record<string, string> {
  const found: Record<string, string> = {};
  let index = 0;
  while (index < block.length) {
    const open = block.indexOf("<", index);
    if (open < 0) break;
    if (block.startsWith("<!--", open)) {
      const end = block.indexOf("-->", open + 4);
      index = end < 0 ? block.length : end + 3;
      continue;
    }
    if (block.startsWith(CDATA_OPEN, open)) {
      const end = block.indexOf(CDATA_CLOSE, open);
      index = end < 0 ? block.length : end + CDATA_CLOSE.length;
      continue;
    }
    const tag = /^<([A-Za-z][\w:.-]*)[^>]*?(\/?)>/.exec(block.slice(open, open + 400));
    if (!tag) {
      index = open + 1;
      continue;
    }
    const name = tag[1] ?? "";
    const bodyStart = open + tag[0].length;
    if (tag[2] === "/") {
      index = bodyStart;
      continue;
    }
    const close = findClose(block, name, bodyStart);
    if (close < 0) break;
    if (WANTED_TAGS.has(name) && !(name in found)) found[name] = cleanText(block.slice(bodyStart, close));
    index = close + name.length + 3;
  }
  return found;
}

export function parseRssItems(xml: string): PressFeedItem[] {
  if (xml.length > MAX_FEED_CHARS) throw new FeedFormatError("FEED_TOO_LARGE");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new FeedFormatError("FEED_FORBIDDEN_MARKUP");
  if (!/<rss[\s>]/.test(xml)) throw new FeedFormatError("FEED_NOT_RSS");
  const items: PressFeedItem[] = [];
  const opening = /<item(?:\s[^>]*)?>/g;
  for (let match = opening.exec(xml); match && items.length < MAX_FEED_ITEMS; match = opening.exec(xml)) {
    const start = match.index + match[0].length;
    const close = findClose(xml, "item", start);
    if (close < 0) break;
    const fields = readWantedChildren(xml.slice(start, close));
    items.push({
      title: (fields["title"] ?? "").slice(0, MAX_TITLE_CHARS),
      link: fields["link"] ?? "",
      guid: (fields["guid"] ?? "").slice(0, 200),
      pubDate: fields["pubDate"] ?? "",
    });
    opening.lastIndex = close + "</item>".length;
  }
  return items;
}
