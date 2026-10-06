// korean-law-mcp 4.15.5 도구 출력(텍스트)에서 식별자·시점을 읽는다. 형식 근거: build/tools/search-hits.js formatHit,
// build/tools/law-text.js(법령명·공포일·시행일·시행예정 표시, [NOT_FOUND]). 읽지 못한 값은 null/UNKNOWN으로 두고 추정하지 않는다.

/** 「노인복지법 제27조의2, 같은 법 시행령 제18조」 같은 인용 글에서 (법령명, 조문) 목록을 뽑는다. 「같은 법·동법」은 바로 앞 법령으로 바꾼다. */
export function parseCitations(text) {
  const out = [];
  const seen = new Set();
  let lastBase = null;
  const lawPattern = /^(.*(?:법률|법|시행령|시행규칙|조례|규칙|규정|고시|훈령|예규|지침))/;
  const articlePattern = /제\s*\d+\s*조(?:\s*의\s*\d+)?/;
  for (const raw of String(text).split(/[,;\n\/]|\s및\s|ㆍ/)) {
    let segment = raw.replace(/\s+/g, " ").trim();
    if (lastBase) segment = segment.replace(/^(같은 ?법|동법)/, lastBase);
    const articleMatch = articlePattern.exec(segment);
    const match = lawPattern.exec(articleMatch ? segment.slice(0, articleMatch.index).trim() : segment);
    if (!match) continue;
    const law = match[1].trim();
    if (law.length < 2 || law.length > 80) continue;
    lastBase = law.replace(/ ?(시행령|시행규칙)$/, "");
    const article = articleMatch ? articleMatch[0].replace(/\s+/g, "") : null;
    const key = law + "|" + (article ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ lawName: law, article });
  }
  return out.slice(0, 10);
}

export function isoFromCompact(value) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value ?? "").trim());
  return match ? match[1] + "-" + match[2] + "-" + match[3] : null;
}

/** search_law 결과의 법령 항목(formatHit 형식). */
export function parseSearchHits(text) {
  const hits = [];
  const blocks = String(text).split(/\n(?=\d+\. )/);
  for (const block of blocks) {
    const head = /^(\d+)\. (.+?)( ⚠️\[연혁-과거버전\]| \[현행\])?\n/.exec(block.trimStart() + "\n");
    const lawId = /- 법령ID: (\S+)/.exec(block);
    const mst = /- MST: (\S+)/.exec(block);
    if (!head || !lawId || !mst) continue;
    const dates = /- 공포일: (\d{8})?(?: \/ 시행일: (\d{8}))?/.exec(block);
    const kind = /- 구분: (.+)/.exec(block);
    hits.push({
      name: head[2].trim(),
      status: head[3]?.includes("현행") ? "현행" : head[3]?.includes("연혁") ? "연혁" : null,
      lawId: lawId[1], mst: mst[1],
      promulgatedOn: isoFromCompact(dates?.[1]), effectiveOn: isoFromCompact(dates?.[2]),
      kind: kind ? kind[1].trim() : null,
    });
  }
  return hits;
}

export function upcomingNote(text) {
  const lines = String(text).split("\n").filter((line) => /시행예정|시행 예정/.test(line));
  return lines.length ? lines.join(" ").replace(/\s+/g, " ").slice(0, 590) : null;
}

/** 검색 결과에서 정확히 같은 이름의 항목을 고른다(현행 우선). 같은 이름이 없으면 null(비슷한 이름으로 확정하지 않음). */
export function pickExact(hits, lawName) {
  const want = lawName.replace(/\s+/g, "");
  const same = hits.filter((hit) => hit.name.replace(/\s+/g, "") === want);
  return same.find((hit) => hit.status === "현행") ?? same[0] ?? null;
}

export function versionStatus(hit, queryDate, text = "") {
  if (!hit) return "UNKNOWN";
  if (new RegExp(hit.name + "[^\n]{0,40}폐지").test(text)) return "REPEALED";
  if (hit.status === "연혁") return "PAST";
  if (hit.status === "현행") return hit.effectiveOn && hit.effectiveOn > queryDate ? "FUTURE" : "CURRENT";
  return "UNKNOWN";
}

/** get_law_text 결과에서 조문 존재 여부. 도구 오류의 [NOT_FOUND]만 NOT_FOUND로 본다. */
export function articleStatus(result) {
  const text = (result?.content ?? []).map((part) => part.text ?? "").join("\n");
  if (result?.isError) return /\[NOT_FOUND\]/.test(text) ? "NOT_FOUND" : "UNKNOWN";
  return /법령명:/.test(text) ? "EXISTS" : "UNKNOWN";
}

export function officialUrl(name, article, kind) {
  const base = /조례|규칙$/.test(name) && !/^(법률|대통령령|총리령|부령)/.test(kind ?? "") && !/시행규칙$/.test(name) ? "https://www.law.go.kr/자치법규/" : "https://www.law.go.kr/법령/";
  return base + encodeURIComponent(name) + (article ? "/" + encodeURIComponent(article) : "");
}

export function resultText(result) {
  return (result?.content ?? []).map((part) => part.text ?? "").join("\n");
}

/** 도구 오류 글로 수집 상태를 정한다. 인증값 누락은 AUTH_MISSING, 그 밖은 ERROR. */
export function failureKind(text) {
  if (/API 키가 필요합니다|인증키|OC/.test(text) && /필요|누락|없/.test(text)) return "AUTH_MISSING";
  if (/LAW_ANTIBOT_CHALLENGE_BLOCKED|API 오류 \(403\)/.test(text)) return "BLOCKED";
  return "ERROR";
}
