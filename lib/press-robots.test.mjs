import assert from "node:assert/strict";
import test from "node:test";

import { robotsAllows, robotsVerdict } from "./press/robots.ts";

const UA = "IntegratedCareDashboard-PressArchive/1.0";

test("가장 길게 맞는 규칙을 따르고, 길이가 같으면 Allow가 이긴다", () => {
  const text = "User-agent: *\nDisallow: /\nAllow: /news\nDisallow: /news/private\nAllow: /$\n";
  assert.equal(robotsAllows(text, UA, "/news/news_report.do"), true);
  assert.equal(robotsAllows(text, UA, "/news/private/a"), false);
  assert.equal(robotsAllows(text, UA, "/board/list.do"), false);
  assert.equal(robotsAllows(text, UA, "/"), true);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /a\nAllow: /a\n", UA, "/a/b"), true);
});

test("쿼리와 와일드카드·끝 표시($)를 처리한다", () => {
  const text = "User-agent: *\nDisallow: /board.es\nAllow: /board.es?mid=a10503010100&bid=0027\nDisallow: /*.pdf$\n";
  assert.equal(robotsAllows(text, UA, "/board.es?mid=a10503010100&bid=0027&list_no=1"), true);
  assert.equal(robotsAllows(text, UA, "/board.es?mid=other"), false);
  assert.equal(robotsAllows(text, UA, "/files/a.pdf"), false);
  assert.equal(robotsAllows(text, UA, "/files/a.pdf?x=1"), true);
});

test("이름이 맞는 user-agent 묶음이 있으면 * 묶음 대신 그것을 쓴다", () => {
  const text = "User-agent: *\nDisallow: /\n\nUser-agent: integratedcaredashboard\nAllow: /\n";
  assert.equal(robotsAllows(text, UA, "/x"), true);
  assert.equal(robotsAllows(text, "OtherBot", "/x"), false);
});

test("규칙이 없거나 빈 Disallow면 허용한다", () => {
  assert.equal(robotsAllows("", UA, "/x"), true);
  assert.equal(robotsAllows("User-agent: *\nDisallow:\n", UA, "/x"), true);
});

test("404는 정책 없음, 401·5xx·HTML 차단 페이지는 읽지 못함으로 판정하고 허용으로 바꾸지 않는다", () => {
  assert.equal(robotsVerdict(404, "", UA, "/x"), "NO_ROBOTS");
  assert.equal(robotsVerdict(401, "보안 차단", UA, "/x"), "UNREADABLE");
  assert.equal(robotsVerdict(503, "", UA, "/x"), "UNREADABLE");
  assert.equal(robotsVerdict(200, "<html><body>점검</body></html>", UA, "/x"), "UNREADABLE");
  assert.equal(robotsVerdict(200, "User-agent: *\nDisallow: /\n", UA, "/x"), "DISALLOWED");
});
