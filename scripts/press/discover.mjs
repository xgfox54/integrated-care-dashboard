// 시·군·구 보도자료 게시판 탐색·검증 도구(작업지시서 v5 §23.6). 로컬에서만 실행한다.
//   node scripts/press/discover.mjs homepages   시·도 공식 홈페이지 링크에서 시·군·구 홈페이지를 찾는다
//   node scripts/press/discover.mjs boards      각 홈페이지에서 보도자료 게시판 후보를 찾고 자동 검증한다
// 결과는 docs/press/discovery/*.json. 도메인을 추측해 만들지 않고, 공식 페이지의 링크만 따라간다.
// 호스트마다 동시 요청 1개·간격 1.5초, 기관마다 요청 8개, 깊이 2. robots.txt가 막은 경로는 읽지 않는다.
// 자동 검증은 등록 보조일 뿐이며, 수집·공개는 관리자 승인(POLICY_APPROVED) 뒤에만 한다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { parseHtmlBoard } from "../../lib/press/html-board.ts";
import { robotsVerdict } from "../../lib/press/robots.ts";
import { METRO_SOURCES } from "./metro-sources.mjs";

export const UA = "IntegratedCareDashboard-PressArchive/1.0";
const OUT = new URL("../../docs/press/discovery/", import.meta.url);
const HOST_GAP_MS = 1500;
const TIMEOUT_MS = 12_000;
const MAX_BYTES = 3_000_000;
const ORG_BUDGET = 8;
const POOL = 8;
const PRESS_MENU = /보도\s*자료|보도\s*[·ㆍ\/,]?\s*해명|(시정|군정|구정|도정)\s*(뉴스|소식)|뉴스\s*룸|언론\s*보도/;
const STRICT_PRESS = /보도\s*자료/;
const MOIS_DIRECTORY = "https://www.mois.go.kr/frt/sub/a04/localGovernment/screen.do";

/** 0021 시드 마이그레이션의 기관 목록. */
// 0021 시드에서 SEED_UNVERIFIED였으나 뒤에 실재를 확인한 기관(적용된 마이그레이션은 고치지 않고 여기서 보정한다).
// 화성시 일반구: 2026-10-05 시 누리집 첫 화면의 구청 링크(hscity.go.kr/manse/·hyohaeng/·byeongjeom/·dongtan/)와 지방재정365 세출의 구 부서로 확인.
const CONFIRMED_ACTIVE = new Set(["org:경기도:화성시:만세구", "org:경기도:화성시:효행구", "org:경기도:화성시:병점구", "org:경기도:화성시:동탄구"]);
export function organizations() {
  const sql = readFileSync(new URL("../../drizzle/0021_press_registry_seed.sql", import.meta.url), "utf8");
  const pattern = /INSERT INTO press_organization \([^)]*\) VALUES \('([^']*)', '([^']*)', '([^']*)', '([^']*)', '([^']*)', (NULL|'[^']*'), '([^']*)', '([^']*)'/g;
  return [...sql.matchAll(pattern)].map((match) => ({
    id: match[1], name: match[2], type: match[3], sido: match[4], sigungu: match[5],
    parent: match[6] === "NULL" ? null : match[6].slice(1, -1), lifecycle: CONFIRMED_ACTIVE.has(match[1]) ? "ACTIVE" : match[7], origin: match[8],
  }));
}

const hostQueues = new Map();
function hostTurn(host) {
  const previous = hostQueues.get(host) ?? Promise.resolve();
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  hostQueues.set(host, previous.then(() => next));
  return previous.then(() => () => setTimeout(release, HOST_GAP_MS));
}

function decode(bytes, contentType) {
  const head = Buffer.from(bytes.subarray(0, 4096)).toString("latin1");
  const charset = (/charset=([\w-]+)/i.exec(contentType ?? "") ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head))?.[1]?.toLowerCase();
  const label = charset && /euc-kr|ks_c_5601|cp949|x-windows-949/.test(charset) ? "euc-kr" : "utf-8";
  return new TextDecoder(label).decode(bytes);
}

/** 정중한 GET. 리다이렉트는 3번까지 http(s)·.kr 호스트만 따라간다. */
export async function politeFetch(url, accept = "text/html,application/xhtml+xml") {
  let current = url;
  for (let hop = 0; hop < 4; hop += 1) {
    const parsed = new URL(current);
    if (!/^https?:$/.test(parsed.protocol) || !/\.kr$/.test(parsed.hostname)) return { ok: false, error: "HOST_NOT_ALLOWED", url: current };
    const done = await hostTurn(parsed.host);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const response = await fetch(current, { redirect: "manual", signal: controller.signal, headers: { "user-agent": UA, accept } });
      clearTimeout(timer);
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        current = new URL(response.headers.get("location"), current).toString();
        continue;
      }
      const reader = response.body?.getReader();
      const chunks = [];
      let size = 0;
      if (reader) {
        for (;;) {
          const { done: end, value } = await reader.read();
          if (end) break;
          size += value.length;
          if (size > MAX_BYTES) { await reader.cancel(); break; }
          chunks.push(value);
        }
      }
      const bytes = Buffer.concat(chunks);
      return { ok: response.ok, status: response.status, url: current, text: decode(bytes, response.headers.get("content-type")), contentType: response.headers.get("content-type") ?? "" };
    } catch (error) {
      return { ok: false, error: error.name === "AbortError" ? "TIMEOUT" : String(error.cause?.code ?? error.message ?? "FETCH_ERROR").slice(0, 60), url: current };
    } finally {
      done();
    }
  }
  return { ok: false, error: "TOO_MANY_REDIRECTS", url: current };
}

const robotsCache = new Map();
// 운영자 robots 예외(scripts/press/robots-exempt.mjs): 행정안전부 「전자정부 웹사이트 품질관리 가이드」 웹 개방성 기준과 운영자 지시(2026-10-06)로
// robots.txt가 막은 기관도 보도자료 목록을 찾는다. 이 스위치를 켠 실행에서만 robots.txt를 묻지 않는다.
let ignoreRobots = false;
export function setIgnoreRobots(value) {
  ignoreRobots = value;
}
export async function robotsFor(url) {
  if (ignoreRobots) return "ALLOWED";
  const origin = new URL(url).origin;
  // robots.txt는 운영 수집기(auto-approve.ts)와 같이 text/plain으로 요청한다. text/html을 보내면 HTML 화면을 주는 서버가 있다(도봉구: 금지 규칙을 못 읽고 지나침).
  if (!robotsCache.has(origin)) robotsCache.set(origin, politeFetch(origin + "/robots.txt", "text/plain"));
  const response = await robotsCache.get(origin);
  const target = new URL(url);
  if (!response.status) return "UNREADABLE";
  return robotsVerdict(response.status, response.text ?? "", UA, target.pathname + target.search);
}

function cleanText(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}

/** <a href>와 <option value>를 모두 링크로 본다(관련 사이트 선택 상자). */
export function links(html, base) {
  const found = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1];
    const title = /title\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1] ?? "";
    if (href) found.push({ href, text: cleanText(match[2]) || cleanText(title), attrs: match[1], index: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  for (const match of html.matchAll(/<option\b[^>]*value\s*=\s*["'](https?:[^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi)) found.push({ href: match[1], text: cleanText(match[2]), attrs: "" });
  return found.flatMap((link) => {
    if (/^(javascript:|mailto:|tel:|#)/i.test(link.href)) return [{ ...link, absolute: null }];
    try {
      return [{ ...link, absolute: new URL(link.href.replace(/&amp;/g, "&"), base).toString() }];
    } catch {
      return [];
    }
  });
}

function siteKey(hostname) {
  return hostname.split(".").slice(-3).join(".");
}

async function pool(items, size, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  }));
  return results;
}

// ---------- 1단계: 시·도 홈페이지에서 시·군·구 홈페이지 링크 찾기 ----------
function nameKey(text) {
  return text.replace(/\s+/g, "").replace(/(홈페이지|바로가기|새창|열림|이동)$/g, "").replace(/청$/, "");
}

async function discoverHomepages() {
  const orgs = organizations();
  const children = orgs.filter((org) => ["BASIC_CITY", "BASIC_COUNTY", "AUTONOMOUS_DISTRICT", "ADMINISTRATIVE_CITY"].includes(org.type));
  const found = {};
  const evidence = [];
  // 1차: 행정안전부 「지자체 누리집」 공식 목록(시·도별 묶음). 2차: 시·도 홈페이지·보도자료 화면의 바로가기 링크.
  if ((await robotsFor(MOIS_DIRECTORY)) !== "DISALLOWED") {
    const directory = await politeFetch(MOIS_DIRECTORY);
    evidence.push({ sido: "*", url: MOIS_DIRECTORY, result: directory.ok ? "OK" : directory.error ?? "HTTP_" + directory.status });
    if (directory.ok) {
      for (const section of directory.text.split(/class="location_title"/).slice(1)) {
        const sido = cleanText(/<a[^>]*>([\s\S]*?)<\/a>/.exec(section)?.[1] ?? "");
        for (const link of links(section, directory.url)) {
          if (!link.absolute) continue;
          const org = children.find((candidate) => candidate.sido === sido && nameKey(link.text) === candidate.name);
          if (org && /\.kr$/.test(new URL(link.absolute).hostname) && !found[org.id]) found[org.id] = { homepage: new URL(link.absolute).origin + "/", via: directory.url, link_text: link.text, source: "MOIS_DIRECTORY" };
        }
      }
    }
  }
  for (const metro of METRO_SOURCES) {
    const sidoChildren = children.filter((org) => org.sido === metro.org);
    const short = metro.org.replace(/(특별시|광역시|특별자치시|특별자치도|통합특별시|도)$/, "");
    // JS로 메뉴를 그리는 홈페이지는 링크가 없으므로, robots가 허용한 확인 게시판 목록 화면(꼬리말 바로가기)도 본다.
    const pages = [metro.homepage, metro.endpoint];
    const visited = new Set();
    for (let index = 0; index < pages.length && index < 7; index += 1) {
      const url = pages[index];
      if (visited.has(url)) continue;
      visited.add(url);
      const verdict = await robotsFor(url);
      if (verdict === "DISALLOWED") {
        evidence.push({ sido: metro.org, url, result: "BLOCKED_ROBOTS" });
        continue;
      }
      const response = await politeFetch(url);
      evidence.push({ sido: metro.org, url, result: response.ok ? "OK" : response.error ?? "HTTP_" + response.status });
      if (!response.ok) continue;
      for (const link of links(response.text, response.url)) {
        if (!link.absolute) continue;
        const key = nameKey(link.text);
        const org = sidoChildren.find((candidate) => key === candidate.name || key === short + candidate.name);
        const host = new URL(link.absolute).hostname;
        if (org && /\.kr$/.test(host) && !found[org.id] && siteKey(host) !== siteKey(new URL(metro.homepage).hostname)) {
          found[org.id] = { homepage: new URL(link.absolute).origin + "/", via: response.url, link_text: link.text, source: "METRO_LINK" };
        } else if (org && found[org.id] && found[org.id].source === "MOIS_DIRECTORY" && /\.kr$/.test(host) && siteKey(host) === siteKey(new URL(found[org.id].homepage).hostname)) {
          found[org.id].confirmed_by_metro = response.url;
        }
        if (index < 2 && pages.length < 7 && /(시군구|시·군·구|시\s*·?\s*군|구\s*·?\s*군|자치구|구청|관련\s*사이트|유관\s*기관|기초\s*자치)/.test(link.text) && new URL(link.absolute).hostname === new URL(response.url).hostname && !pages.includes(link.absolute)) pages.push(link.absolute);
      }
    }
    console.log(metro.org, sidoChildren.filter((org) => found[org.id]).length + "/" + sidoChildren.length);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(new URL("homepages.json", OUT), JSON.stringify({ checked_at: new Date().toISOString(), found, evidence }, null, 2));
  console.log("homepages", Object.keys(found).length + "/" + children.length);
}

// ---------- 2단계: 보도자료 게시판 후보 찾기·자동 검증 ----------
function escapeRegex(text) {
  return text.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
}

/** 목록 페이지에서 상세 링크 묶음(같은 경로·바뀌는 번호 파라미터)을 찾는다. */
export function detailPattern(html, base) {
  const groups = new Map();
  for (const link of links(html, base)) {
    if (!link.absolute || link.text.length < 6) continue;
    const url = new URL(link.absolute);
    if (!url.search) continue;
    const key = url.host + url.pathname + "?" + [...url.searchParams.keys()].sort().join("&");
    const group = groups.get(key) ?? [];
    group.push({ url, text: link.text, href: link.href, index: link.index, end: link.end });
    groups.set(key, group);
  }
  let best = null;
  for (const group of groups.values()) {
    if (group.length < 5) continue;
    // 게시물 묶음은 링크 바로 뒤(다음 같은 묶음 링크 전, 800자 안)에 게시일이 있다. 메뉴 링크 묶음은 날짜가 없다.
    const dated = group.filter((item, position) => {
      const stop = Math.min(group[position + 1]?.index ?? html.length, item.end + 800);
      // 카드형 목록은 날짜가 링크 안에 있다. 링크 시작부터 다음 같은 묶음 링크 전까지 본다.
      return /(20\d{2})[-./]\s?(\d{1,2})[-./]\s?(\d{1,2})/.test(html.slice(item.index, stop));
    }).length;
    if (dated < 3) continue;
    const params = [...group[0].url.searchParams.keys()];
    const varying = params.filter((param) => new Set(group.map((item) => item.url.searchParams.get(param))).size >= Math.min(group.length, 5));
    const idParam = varying.find((param) => /^(ntt|seq|idx|no|id|num|bid|data|board|article|list|art|bbs|sn|key|repSeq)/i.test(param) && !/page|pg|cpage|offset/i.test(param)) ?? varying.find((param) => !/page|pg|cpage|offset/i.test(param));
    if (!idParam) continue;
    if (!best || dated > best.dated) best = { idParam, items: group, dated };
  }
  if (!best) return null;
  const sample = best.items[0];
  // 경로에 붙은 세션 ID(;jsessionid=…)는 접속마다 바뀌므로 링크 패턴·원문 주소 틀에서 뺀다(곡성·청양·태안에서 0건 수집의 원인).
  const segment = (sample.url.pathname.split("/").filter(Boolean).pop() ?? "").replace(/;jsessionid=[^/]*/i, "");
  const template = new URL(sample.url.toString());
  template.pathname = template.pathname.replace(/;jsessionid=[^/]*/i, "");
  template.searchParams.set(best.idParam, "__ID__");
  // 링크 안에 제목 요소(strong 등)와 요약 문장이 함께 있으면, 요약(본문 일부)이 제목에 섞이지 않게 첫 제목 요소의 글자만 읽는다.
  const inner = html.slice(sample.index, sample.end);
  const structured = /<(strong|b|em|h\d)\b/i.exec(inner);
  const title = structured ? "<" + structured[1].toLowerCase() + "[^>]*>\\s*([^<]+)" : "text";
  return {
    idParam: best.idParam,
    count: best.items.length,
    profile: {
      // 상대 주소("?idx=…")처럼 href에 경로가 없으면 경로 대신 href 시작을 기준으로 맞춘다.
      link: (sample.href.includes(segment) ? escapeRegex(segment) : "href=[\"']") + "[^\"']*?[?&](?:amp;)?" + escapeRegex(best.idParam) + "=(?<id>[\\w-]+)",
      url: template.toString().replace("__ID__", "{id}"),
      title,
    },
    samples: best.items.slice(0, 3).map((item) => ({ url: item.url.toString(), text: item.text.slice(0, 80) })),
  };
}

function compact(text) {
  // 글자·숫자만 비교한다(목록은 엔티티를 풀어 쓰고 원문은 그대로 두는 차이, 문장부호 차이를 없앰). script-profiles.mjs와 같은 기준.
  return text.replace(/&[a-z#0-9]+;/gi, "").replace(/[^\p{L}\p{N}]/gu, "");
}

export async function verifyBoard(candidate, listResponse, spend) {
  const pattern = detailPattern(listResponse.text, listResponse.url);
  if (!pattern) return { status: "CANDIDATE_NEEDS_REVIEW", reason: "상세 링크 묶음(5개 이상)을 찾지 못함(스크립트 링크·POST 폼 가능)" };
  let items = [];
  try {
    items = parseHtmlBoard(listResponse.text, pattern.profile);
  } catch {
    return { status: "CANDIDATE_NEEDS_REVIEW", reason: "목록 파싱 실패", pattern };
  }
  const dated = items.filter((item) => item.pubDate).length;
  const titles = new Set(items.map((item) => item.title));
  if (items.some((item) => item.title.length > 150)) {
    return { status: "CANDIDATE_NEEDS_REVIEW", reason: "제목이 150자를 넘음(요약·본문이 섞였을 수 있어 자동 확정하지 않음)", pattern };
  }
  if (items.length < 5 || titles.size < Math.min(5, items.length) || dated < 3) {
    return { status: "CANDIDATE_NEEDS_REVIEW", reason: "목록 항목 " + items.length + "건, 날짜 " + dated + "건(기준 미달)", pattern };
  }
  if (!STRICT_PRESS.test(candidate.text)) return { status: "CANDIDATE_NEEDS_REVIEW", reason: "메뉴명이 '보도자료'가 아님(" + candidate.text + "). 민간 기사 모음일 수 있어 자동 확정하지 않음", pattern, items: items.length };
  // 지난 자료 보관 게시판(예: '09.01.11이전 보도자료')을 현재 게시판으로 확정하지 않는다. 최근 1년 안 게시물이 있어야 한다.
  const newest = items.map((item) => item.pubDate).filter(Boolean).sort().pop() ?? "";
  if (newest < new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10)) return { status: "CANDIDATE_NEEDS_REVIEW", reason: "최근 1년 안 게시물이 없음(가장 최근 " + (newest || "날짜 없음") + "). 지난 자료 보관 게시판일 수 있음", pattern, items: items.length };
  const detailUrl = items[0].link;
  if ((await robotsFor(detailUrl)) === "DISALLOWED") return { status: "BLOCKED_ROBOTS", reason: "상세 원문 경로를 robots.txt가 막음", pattern };
  if (!spend()) return { status: "CANDIDATE_NEEDS_REVIEW", reason: "요청 예산 소진(상세 확인 못함)", pattern };
  const detail = await politeFetch(detailUrl);
  if (!detail.ok) return { status: "CANDIDATE_NEEDS_REVIEW", reason: "상세 원문 열람 실패(" + (detail.error ?? detail.status) + ")", pattern };
  const probe = compact(items[0].title).slice(0, 12);
  if (!compact(detail.text).includes(probe)) return { status: "CANDIDATE_NEEDS_REVIEW", reason: "상세 원문에서 목록 제목을 찾지 못함(주소 틀 불일치 가능)", pattern };
  return {
    status: "AUTO_VERIFIED",
    reason: "목록 " + items.length + "건·날짜 " + dated + "건 확인, 첫 게시물 원문 주소에서 제목 일치",
    pattern,
    items: items.length,
    latest: items.map((item) => item.pubDate).filter(Boolean).sort().pop() ?? null,
  };
}

export async function discoverBoard(homepage) {
  let used = 0;
  const spend = () => (used < ORG_BUDGET ? (used += 1, true) : false);
  const home = homepage.homepage;
  if ((await robotsFor(home)) === "DISALLOWED") return { status: "BLOCKED_ROBOTS", reason: "홈페이지를 robots.txt가 막음", homepage: home };
  spend();
  let front = await politeFetch(home);
  if (!front.ok) return { status: "ACCESS_ERROR", reason: front.error ?? "HTTP_" + front.status, homepage: home };
  const site = siteKey(new URL(front.url).hostname);
  // 첫 화면이 안내·이동 페이지(meta refresh, location 이동, 인트로)면 같은 사이트 안의 본 화면으로 옮긴다.
  // 링크가 적거나(30개 미만) 보도자료류 메뉴가 없을 때만 옮긴다.
  const hasPressMenu = (page) => links(page.text, page.url).some((link) => link.absolute && PRESS_MENU.test(link.text) && link.text.length <= 30);
  for (let hop = 0; hop < 2 && (links(front.text, front.url).length < 30 || !hasPressMenu(front)); hop += 1) {
    // 주석 처리된 이동 코드는 따르지 않는다.
    const code = front.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
    const refresh = /http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>\s]+)/i.exec(code)?.[1]
      ?? /location(?:\.href)?\s*(?:=|\.replace\()\s*["']((?:https?:\/\/|\/)[^"']+)["']/i.exec(code)?.[1];
    // 스크립트 안 문자열 경로는 이동 코드도 본 화면 링크도 없을 때만 쓴다(팝업 주소를 따라가지 않게).
    const scriptPath = /<script[\s\S]*?["'](\/[\w/.-]+\.(?:jsp|do|html?|asp|aspx|php|ac|web))["']/i.exec(code)?.[1];
    const here = front.url.split("#")[0];
    const usable = links(front.text, front.url).filter((link) => link.absolute && !link.href.startsWith("#") && link.absolute.split("#")[0] !== here && siteKey(new URL(link.absolute).hostname) === site);
    // 글자로 본 화면임을 밝힌 링크(누리집·홈페이지·메인 바로가기)를 주소 모양만 맞는 링크보다 먼저 고른다.
    const intro = usable.find((link) => /(누리집|홈페이지|메인)/.test(link.text))
      ?? usable.find((link) => /(바로\s*가기|입장|들어가기)/.test(link.text))
      ?? usable.find((link) => /(portal|main|index)/i.test(link.href));
    let target = null;
    try {
      // 자기 자신으로 가는 이동(예: https 고정 스크립트)은 건너뛴다.
      const same = (value) => value.replace(/[#?].*$/, "").replace(/\/$/, "") === here.replace(/[#?].*$/, "").replace(/\/$/, "");
      const candidates = [refresh ? new URL(refresh, front.url).toString() : null, intro?.absolute ?? null, scriptPath ? new URL(scriptPath, front.url).toString() : null];
      target = candidates.find((value) => value && !same(value)) ?? null;
    } catch {
      target = null;
    }
    if (!target || siteKey(new URL(target).hostname) !== site || (await robotsFor(target)) === "DISALLOWED" || !spend()) break;
    const next = await politeFetch(target);
    if (!next.ok) break;
    front = next;
  }
  const seen = new Set();
  const queue = [];
  const enqueue = (response, depth) => {
    for (const link of links(response.text, response.url)) {
      if (!link.absolute || !PRESS_MENU.test(link.text) || link.text.length > 30) continue;
      const host = new URL(link.absolute).hostname;
      if (siteKey(host) !== site || seen.has(link.absolute)) continue;
      seen.add(link.absolute);
      queue.push({ url: link.absolute, text: link.text, depth, strict: STRICT_PRESS.test(link.text) });
    }
    queue.sort((a, b) => Number(b.strict) - Number(a.strict) || a.depth - b.depth);
  };
  enqueue(front, 1);
  if (!queue.length) {
    // 메뉴를 스크립트로 그리는 누리집: 같은 사이트의 사이트맵·전체메뉴 화면에서 다시 찾는다.
    // 글자가 정확히 '사이트맵'이 아니어도(예: '사이트맵 바로가기', 아이콘 링크의 주소만 sitemap) 같은 사이트의 사이트맵이면 쓴다.
    const mapLinks = links(front.text, front.url).filter((link) => link.absolute && siteKey(new URL(link.absolute).hostname) === site);
    const sitemap = mapLinks.find((link) => /^(사이트\s*맵|전체\s*메뉴|sitemap)$/i.test(link.text))
      ?? mapLinks.find((link) => /(사이트\s*맵|전체\s*메뉴)/.test(link.text) && link.text.length <= 20)
      ?? mapLinks.find((link) => /site_?map/i.test(link.href));
    if (sitemap && (await robotsFor(sitemap.absolute)) !== "DISALLOWED" && spend()) {
      const map = await politeFetch(sitemap.absolute);
      if (map.ok) enqueue(map, 1);
    }
  }
  if (!queue.length) return { status: "NO_BOARD_FOUND", reason: "홈페이지 첫 화면에서 보도자료류 메뉴를 찾지 못함(스크립트 메뉴 가능)", homepage: front.url };
  let lastReview = null;
  while (queue.length) {
    const candidate = queue.shift();
    if ((await robotsFor(candidate.url)) === "DISALLOWED") {
      lastReview = { status: "BLOCKED_ROBOTS", reason: "후보 게시판 경로를 robots.txt가 막음", homepage: front.url, endpoint: candidate.url, menu_text: candidate.text };
      continue;
    }
    if (!spend()) break;
    const page = await politeFetch(candidate.url);
    if (!page.ok) {
      lastReview ??= { status: "ACCESS_ERROR", reason: page.error ?? "HTTP_" + page.status, homepage: front.url, endpoint: candidate.url, menu_text: candidate.text };
      continue;
    }
    const result = await verifyBoard(candidate, page, spend);
    if (result.status === "AUTO_VERIFIED" || result.status === "BLOCKED_ROBOTS") return { ...result, homepage: front.url, endpoint: page.url, menu_text: candidate.text };
    if (!lastReview || lastReview.status !== "CANDIDATE_NEEDS_REVIEW" || (candidate.strict && result.pattern)) lastReview = { ...result, homepage: front.url, endpoint: page.url, menu_text: candidate.text };
    if (candidate.depth < 2) enqueue(page, 2);
  }
  return lastReview ?? { status: "NO_BOARD_FOUND", reason: "예산 안에서 게시판을 찾지 못함", homepage: front.url };
}

async function discoverBoards() {
  const homepages = JSON.parse(readFileSync(new URL("homepages.json", OUT), "utf8")).found;
  // --retry: 앞선 결과에서 자동 검증·robots 차단으로 확정된 기관은 다시 묻지 않는다.
  // --only로 일부만 다시 볼 때도 다른 기관의 앞선 결과를 읽어 그대로 남긴다(앞선 결과를 지우지 않음).
  const partial = process.argv.includes("--only");
  const previous = process.argv.includes("--retry") || partial ? JSON.parse(readFileSync(new URL("boards.json", OUT), "utf8")).boards : {};
  const settled = (id) => ["AUTO_VERIFIED", "BLOCKED_ROBOTS"].includes(previous[id]?.status);
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
  // --only 는 기관 ID 또는 누리집 주소의 일부(영문, 예: cheongju)로 고른다(Windows 명령행에서 한글 인자가 깨질 수 있어서).
  // --only로 고른 기관은 앞서 확정된 기관이라도 다시 본다.
  const orgs = organizations().filter((org) => homepages[org.id] && (only ? org.id === only || homepages[org.id].homepage.includes(only) : !settled(org.id)));
  let done = 0;
  const results = await pool(orgs, POOL, async (org) => {
    const result = await discoverBoard(homepages[org.id]).catch((error) => ({ status: "ACCESS_ERROR", reason: String(error.message ?? error).slice(0, 80) }));
    done += 1;
    if (done % 20 === 0) console.log(done + "/" + orgs.length);
    return [org.id, { ...result, checked_at: new Date().toISOString() }];
  });
  const kept = only ? previous : Object.fromEntries(Object.entries(previous).filter(([id]) => settled(id)));
  const boards = { ...kept, ...Object.fromEntries(results) };
  writeFileSync(new URL("boards.json", OUT), JSON.stringify({ checked_at: new Date().toISOString(), boards }, null, 2));
  const counts = Object.values(boards).reduce((acc, board) => ({ ...acc, [board.status]: (acc[board.status] ?? 0) + 1 }), {});
  console.log(JSON.stringify(counts));
}

// 다른 스크립트가 organizations() 등을 가져다 쓸 때는 명령을 실행하지 않는다.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  if (command === "homepages") await discoverHomepages();
  else if (command === "boards") await discoverBoards();
  else {
    console.error("명령: homepages | boards");
    process.exitCode = 2;
  }
}
