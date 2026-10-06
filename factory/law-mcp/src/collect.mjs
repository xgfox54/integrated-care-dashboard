// 법령 근거 후보 수집(로컬 전용). 관리자 화면에서 내려받은 후보 목록(정부24 상세의 법령·자치법규·행정규칙 인용)을
// korean-law-mcp 4.15.5로 법제처에 대조해 welfare-law-bundle-1 묶음을 만든다. 조문 본문은 저장하지 않고 해시만 남긴다.
// 사용: LAW_OC=<발급 인증값> node src/collect.mjs --candidates <후보.json> --out <폴더> [--query-date YYYY-MM-DD] [--limit 50]
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { articleStatus, failureKind, officialUrl, parseCitations, parseSearchHits, pickExact, resultText, upcomingNote, versionStatus } from "./parse.mjs";
import { installedVersion, openLawSession, PINNED_VERSION } from "./session.mjs";

export const COLLECTOR_VERSION = "1.0.0";
const sha = (text) => createHash("sha256").update(text).digest("hex");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function arg(name, fallback = null) {
  const index = process.argv.indexOf("--" + name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function todayKst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 한 후보를 대조한다. callTool은 MCP 클라이언트 호출(시험에서는 가짜). */
export async function collectItem(candidate, queryDate, callTool) {
  const base = { candidate_id: candidate.candidate_id, target_kind: candidate.target_kind, target_id: candidate.target_id, target_label: candidate.target_label ?? "", citation_text: candidate.citation_text, source: { kind: candidate.source.kind, id: candidate.source.id, field: candidate.source.field } };
  const citations = parseCitations(candidate.citation_text);
  if (!citations.length) return { ...base, status: "NO_CITATION", message: "인용 글에서 법령명을 찾지 못했습니다.", verify_summary: null, references: [] };
  const references = [];
  for (const citation of citations) {
    const search = await callTool("search_law", { query: citation.lawName, display: 10 });
    const searchText = resultText(search);
    if (search.isError) return { ...base, status: failureKind(searchText), message: searchText.split("\n")[0].slice(0, 300), verify_summary: null, references: [] };
    const hit = pickExact(parseSearchHits(searchText), citation.lawName);
    let status = "NOT_CHECKED";
    let textSha = null;
    if (hit && citation.article) {
      const lawText = await callTool("get_law_text", { mst: hit.mst, jo: citation.article });
      status = articleStatus(lawText);
      const body = resultText(lawText);
      if (lawText.isError && failureKind(body) !== "ERROR") return { ...base, status: failureKind(body), message: body.split("\n")[0].slice(0, 300), verify_summary: null, references: [] };
      textSha = status === "EXISTS" ? sha(body) : null;
    }
    references.push({
      law_name: hit?.name ?? citation.lawName, law_kind: hit?.kind ?? null, law_id: hit?.lawId ?? null, mst: hit?.mst ?? null, article: citation.article,
      promulgated_on: hit?.promulgatedOn ?? null, effective_on: hit?.effectiveOn ?? null, version_status: versionStatus(hit, queryDate, searchText),
      article_status: hit ? status : "UNKNOWN", upcoming_note: hit ? upcomingNote(searchText) : null, official_url: officialUrl(hit?.name ?? citation.lawName, citation.article, hit?.kind), text_sha256: textSha,
    });
  }
  const verify = await callTool("legal_analysis", { mode: "verify_citations", text: candidate.citation_text.slice(0, 2000) });
  const verifyText = resultText(verify);
  return { ...base, status: "OK", message: null, verify_summary: verify.isError ? "검증 도구 오류: " + verifyText.split("\n")[0].slice(0, 200) : verifyText.replace(/\s+/g, " ").slice(0, 590), references };
}

export function buildBundle(items, { queryDate, server, protocolSha, blockedCount }) {
  const bundle = { schema: "welfare-law-bundle-1", created_at: new Date().toISOString(), query_date: queryDate, package: "korean-law-mcp@" + PINNED_VERSION, server, collector_version: COLLECTOR_VERSION, protocol_sha256: protocolSha, blocked_count: blockedCount, items };
  return { ...bundle, items_sha256: sha(JSON.stringify(items)) };
}

async function main() {
  const candidatesPath = arg("candidates");
  const outDir = arg("out", "var/law-bundles");
  const queryDate = arg("query-date", todayKst());
  const limit = Number(arg("limit", "50"));
  if (!candidatesPath) throw new Error("--candidates <후보.json> 이 필요합니다.");
  const candidates = JSON.parse(readFileSync(candidatesPath, "utf8")).items.slice(0, limit);
  const session = await openLawSession();
  try {
    const { tools } = await session.client.listTools();
    const required = ["search_law", "get_law_text", "legal_analysis"];
    const missing = required.filter((name) => !tools.some((tool) => tool.name === name));
    if (missing.length) throw new Error("tools/list에 필요한 도구가 없습니다: " + missing.join(", "));
    const protocolSha = sha(JSON.stringify(tools.map((tool) => [tool.name, tool.inputSchema])));
    const callTool = async (name, args) => {
      await wait(500);
      return session.client.callTool({ name, arguments: args });
    };
    const items = [];
    for (const candidate of candidates) {
      const item = await collectItem(candidate, queryDate, callTool);
      items.push(session.blocked.count ? { ...item, status: "BLOCKED", message: "법제처 차단 페이지를 받아 우회하지 않고 멈췄습니다.", references: [] } : item);
      if (item.status === "AUTH_MISSING" || session.blocked.count) break;
    }
    const server = session.client.getServerVersion();
    const bundle = buildBundle(items, { queryDate, server: { name: server.name, version: server.version }, protocolSha, blockedCount: session.blocked.count });
    mkdirSync(outDir, { recursive: true });
    const target = path.join(outDir, "law-bundle-" + queryDate + "-" + bundle.items_sha256.slice(0, 8) + ".json");
    writeFileSync(target, JSON.stringify(bundle, null, 1) + "\n");
    const counts = items.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] ?? 0) + 1 }), {});
    console.log(JSON.stringify({ bundle: target, package: "korean-law-mcp@" + installedVersion(), items: items.length, counts, blocked: session.blocked.count }));
  } finally {
    await session.close();
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
