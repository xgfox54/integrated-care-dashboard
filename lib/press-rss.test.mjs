import assert from "node:assert/strict";
import test from "node:test";

import { FeedFormatError, parseRssItems } from "./press/rss.ts";
import { BODY_MARKER, feedXml, url } from "./press-test-support.mjs";

test("RSS 파서는 제목·링크·GUID·게시시각 네 값만 돌려주고 본문·작성자는 읽지 않는다", () => {
  const items = parseRssItems(feedXml([{ title: "의료&middot;요양 &amp; 돌봄", link: url(1), guid: "g-1" }]));
  assert.equal(items.length, 1);
  assert.deepEqual(Object.keys(items[0]).sort(), ["guid", "link", "pubDate", "title"]);
  assert.equal(items[0].title, "의료·요양 & 돌봄");
  assert.equal(items[0].link, "https://www.mohw.go.kr/board.es?mid=a10503000000&bid=0027&list_no=1&act=view");
  const serialized = JSON.stringify(items);
  assert.ok(!serialized.includes(BODY_MARKER));
  assert.ok(!serialized.includes("담당자이름"));
});

test("description 안의 CDATA에 가짜 link가 있어도 실제 link만 쓴다", () => {
  const xml = '<rss version="2.0"><channel><item><description><![CDATA[<link>https://evil.example/x</link>]]></description><title>제목</title><link>https://www.mohw.go.kr/a</link></item></channel></rss>';
  assert.equal(parseRssItems(xml)[0].link, "https://www.mohw.go.kr/a");
});

test("DOCTYPE·ENTITY, RSS가 아닌 문서, 너무 큰 문서는 거절한다", () => {
  const expectCode = (xml, code) => assert.throws(() => parseRssItems(xml), (error) => error instanceof FeedFormatError && error.code === code);
  expectCode('<!DOCTYPE rss [<!ENTITY x "y">]><rss version="2.0"></rss>', "FEED_FORBIDDEN_MARKUP");
  expectCode("<html><body>오류 페이지</body></html>", "FEED_NOT_RSS");
  expectCode("<rss version=\"2.0\">" + "a".repeat(2_000_001), "FEED_TOO_LARGE");
});

test("원천이 두 번 이스케이프한 따옴표 엔터티도 글자로 풀어 준다", () => {
  const xml = '<rss version="2.0"><channel><item><title><![CDATA[&amp;#x27;창고형 약국&amp;#x27; 점검]]></title><link>https://www.mohw.go.kr/a</link></item></channel></rss>';
  assert.equal(parseRssItems(xml)[0].title, "'창고형 약국' 점검");
});
