// robots.txt 해석(RFC 9309): 가장 구체적인 user-agent 묶음을 고르고, 경로에 가장 길게 맞는 규칙을 따른다.
// 길이가 같으면 Allow가 이긴다. 읽지 못한 robots.txt는 허용으로 바꾸지 않는다.

export type RobotsVerdict = "ALLOWED" | "DISALLOWED" | "NO_ROBOTS" | "UNREADABLE";

interface Rule {
  readonly allow: boolean;
  readonly path: string;
}

interface Group {
  readonly agents: string[];
  readonly rules: Rule[];
}

function parseGroups(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let previousWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = (match[1] ?? "").toLowerCase();
    const value = (match[2] ?? "").trim();
    if (key === "user-agent") {
      if (!previousWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      previousWasAgent = true;
      continue;
    }
    previousWasAgent = false;
    if (current && (key === "allow" || key === "disallow")) current.rules.push({ allow: key === "allow", path: value });
  }
  return groups;
}

function rulesFor(groups: readonly Group[], userAgent: string): readonly Rule[] {
  const agent = userAgent.toLowerCase();
  const named = groups.filter((group) => group.agents.some((name) => name !== "*" && agent.includes(name)));
  if (named.length > 0) return named.flatMap((group) => group.rules);
  return groups.filter((group) => group.agents.includes("*")).flatMap((group) => group.rules);
}

function escapeRegex(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, (char) => `\\${char}`);
}

/** 규칙이 경로에 맞으면 규칙 길이를, 맞지 않으면 -1을 돌려준다. 빈 Disallow는 아무것도 막지 않는다. */
function matchLength(pattern: string, path: string): number {
  if (!pattern) return -1;
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).split("*").map(escapeRegex).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path) ? pattern.length : -1;
}

/** 경로에 가장 길게 맞는 규칙과 허용 여부. 맞는 규칙이 없으면 허용(rule=null). */
function bestMatch(rules: readonly Rule[], pathWithQuery: string): { readonly allow: boolean; readonly rule: Rule | null } {
  let best: { length: number; allow: boolean; rule: Rule | null } = { length: -1, allow: true, rule: null };
  for (const rule of rules) {
    const length = matchLength(rule.path, pathWithQuery);
    if (length > best.length || (length === best.length && length >= 0 && rule.allow)) best = { length, allow: rule.allow, rule: length >= 0 ? rule : null };
  }
  return best;
}

/** pathWithQuery 는 "/board/list.do?id=1" 처럼 경로와 쿼리를 함께 준다. */
export function robotsAllows(robotsText: string, userAgent: string, pathWithQuery: string): boolean {
  return bestMatch(rulesFor(parseGroups(robotsText), userAgent), pathWithQuery).allow;
}

/** robots.txt 응답 하나를 판정한다. 404·410은 정책 없음, 그 밖의 오류·HTML 차단 페이지는 읽지 못함이다. */
export function robotsVerdict(status: number, body: string, userAgent: string, pathWithQuery: string): RobotsVerdict {
  if (status === 404 || status === 410) return "NO_ROBOTS";
  if (status !== 200 || /<html|<body/i.test(body.slice(0, 500))) return "UNREADABLE";
  return robotsAllows(body, userAgent, pathWithQuery) ? "ALLOWED" : "DISALLOWED";
}

/**
 * 수집 지침(2026-10-05) 6종 분류. 수집 가능 여부를 이것만으로 정하지 않는 운영 참고값이다.
 * ALLOW_ALL: 우리 User-agent에 적용되는 금지 규칙이 없음 / ALLOW_PARTIAL: 관리자·검색 등 일부만 금지하고 수집 경로는 허용
 * TARGET_BLOCKED: 수집 경로를 금지 / BLOCK_ALL: 사이트 첫 경로(/)까지 금지 / NO_ROBOTS: 404·410 / CHECK_ERROR: 읽지 못함(5xx·401·차단 화면·시간 초과)
 */
export type RobotsDecision = "ALLOW_ALL" | "ALLOW_PARTIAL" | "TARGET_BLOCKED" | "BLOCK_ALL" | "NO_ROBOTS" | "CHECK_ERROR";

export interface RobotsAnalysis {
  readonly decision: RobotsDecision;
  readonly verdict: RobotsVerdict;
  /** 판정에 쓴 규칙(예: "Disallow: /press/"). 없으면 빈 문자열. */
  readonly rule: string;
  readonly reason: string;
}

export function analyzeRobots(status: number | null, body: string, userAgent: string, pathWithQuery: string): RobotsAnalysis {
  if (status === null) return { decision: "CHECK_ERROR", verdict: "UNREADABLE", rule: "", reason: "robots.txt 요청이 시간 초과되거나 연결되지 않았습니다." };
  if (status === 404 || status === 410) return { decision: "NO_ROBOTS", verdict: "NO_ROBOTS", rule: "", reason: "robots.txt가 없습니다(HTTP " + status + "). 저부하 정책으로 수집합니다." };
  // robots.txt 자리에 HTML(차단·오류 화면 등, <html> 없이 <br>·<center>로 시작하는 웹방화벽 화면 포함)이 오면 읽지 못한 것으로 본다.
  if (status !== 200 || /<html|<body|<br\s*\/?>|<center|<h[1-6][\s>]|<table|<div/i.test(body.slice(0, 500))) {
    return { decision: "CHECK_ERROR", verdict: "UNREADABLE", rule: "", reason: status === 200 ? "robots.txt 자리에 HTML 화면이 왔습니다." : "robots.txt를 읽지 못했습니다(HTTP " + status + ")." };
  }
  const rules = rulesFor(parseGroups(body), userAgent);
  const target = bestMatch(rules, pathWithQuery);
  const text = (rule: Rule | null) => (rule ? (rule.allow ? "Allow: " : "Disallow: ") + rule.path : "");
  if (!target.allow) {
    const root = bestMatch(rules, "/");
    return root.allow
      ? { decision: "TARGET_BLOCKED", verdict: "DISALLOWED", rule: text(target.rule), reason: "수집 경로를 robots.txt가 금지합니다. 공식 RSS·API 등 다른 공개 경로를 확인합니다." }
      : { decision: "BLOCK_ALL", verdict: "DISALLOWED", rule: text(root.rule), reason: "robots.txt가 사이트 전체를 금지합니다. 자동 수집하지 않고 수동 검토(MANUAL_REVIEW)로 둡니다." };
  }
  const restricted = rules.filter((rule) => !rule.allow && rule.path);
  return restricted.length
    ? { decision: "ALLOW_PARTIAL", verdict: "ALLOWED", rule: text(target.rule), reason: "일부 경로(" + restricted.slice(0, 3).map((rule) => rule.path).join(", ") + (restricted.length > 3 ? " 등" : "") + ")만 금지하고 수집 경로는 허용합니다." }
    : { decision: "ALLOW_ALL", verdict: "ALLOWED", rule: text(target.rule), reason: "우리 User-agent에 적용되는 금지 규칙이 없습니다." };
}
