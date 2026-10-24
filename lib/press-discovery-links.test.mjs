import assert from "node:assert/strict";
import test from "node:test";

import { detailPattern } from "../scripts/press/discover.mjs";
import { parseHtmlBoard } from "./press/html-board.ts";

const BASE = "https://www.seocho.go.kr/site/seocho/ex/bbs/List.do?cbIdx=61";
const article = (board, id, title = `서초구 보도자료 제목 ${id}`) => `<li><a href="/site/seocho/ex/bbs/View.do?cbIdx=${board}&amp;bcIdx=${id}">${title}</a><span>2026-10-02</span></li>`;

test("다른 게시판의 첫 링크가 보도자료 주소 틀과 게시판 번호를 바꾸지 않는다", () => {
  const sidebar = '<a href="/site/seocho/ex/bbs/View.do?cbIdx=57&amp;bcIdx=399631">「서리풀 커뮤니티 활성화 사업」 공지사항</a>';
  const html = sidebar + Array.from({ length: 10 }, (_, i) => article(61, 411653 - i)).join("");
  const pattern = detailPattern(html, BASE);
  assert.ok(pattern);
  assert.equal(new URL(pattern.profile.url).searchParams.get("cbIdx"), "61");
  const items = parseHtmlBoard(html, pattern.profile);
  assert.equal(items.length, 10);
  assert.ok(items.every(item => new URL(item.link).searchParams.get("cbIdx") === "61"));
  assert.ok(items.every(item => item.guid !== "399631"));
});

test("날짜가 있는 다른 게시판 링크가 더 많아도 목록의 게시판 번호와 일치하는 묶음을 선택한다", () => {
  const html = Array.from({ length: 12 }, (_, i) => article(57, 399631 - i)).join("") +
    Array.from({ length: 6 }, (_, i) => article(61, 411653 - i)).join("");
  const pattern = detailPattern(html, BASE);
  assert.ok(pattern);
  assert.equal(pattern.count, 6);
  assert.equal(new URL(pattern.profile.url).searchParams.get("cbIdx"), "61");
  assert.equal(parseHtmlBoard(html, pattern.profile).length, 6);
});

test("한 게시판의 기존 상세 주소 형식은 유지한다", () => {
  const html = Array.from({ length: 6 }, (_, i) => `<a href="/press/view?seq=${100 + i}">노인 돌봄 지원 보도자료 ${i}</a><span>2026-10-02</span>`).join("");
  const pattern = detailPattern(html, "https://www.example.go.kr/press/list");
  assert.ok(pattern);
  assert.equal(pattern.idParam, "seq");
  assert.equal(pattern.profile.url, "https://www.example.go.kr/press/view?seq={id}");
  assert.equal(parseHtmlBoard(html, pattern.profile).length, 6);
});
