// MCP 검색·조회 품질 평가 v2 실행기. 실제 MCP 서버를 호출해 도메인·평가항목별 결과와 원문 인용 정확도·조건 누락률을 낸다.
// AI 모델을 호출하지 않는다(최종 답변 품질은 별도 평가). 실행: node scripts/mcp/run-eval-v2.mjs [--url https://.../claude/mcp] [--out docs/qa/mcp-eval-v2-YYYYMMDD]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { explicitEmptyScope, manualQuoteMatches } from "./eval-checks.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const url = option("--url", "https://integrated-care-national-dashboard.xgfox54.chatgpt.site/claude/mcp");
const out = option("--out", "docs/qa/mcp-eval-v2-" + new Date().toISOString().slice(0, 10).replace(/-/g, ""));
const suite = JSON.parse(readFileSync(option("--suite", "quality/mcp-eval-v2-20261014.json"), "utf8"));
const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
let session = null;
let requestId = 0;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function rpc(method, params) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url, { method: "POST", headers: session ? { ...headers, "mcp-session-id": session } : headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }) });
    session = response.headers.get("mcp-session-id") ?? session;
    if (response.status === 429) { await pause(Number(response.headers.get("retry-after") ?? 5) * 1000); continue; }
    const text = await response.text();
    const line = text.split("\n").find((entry) => entry.startsWith("data:"));
    return JSON.parse(line ? line.slice(5) : text);
  }
  throw new Error("rate limited");
}
async function call(name, argumentsValue) {
  await pause(650);
  const started = Date.now();
  const reply = await rpc("tools/call", { name, arguments: argumentsValue });
  const result = reply.result ?? {};
  const structured = result.structuredContent ?? (() => { try { return JSON.parse(result.content?.map((entry) => entry.text).join("") ?? "null"); } catch { return { text: result.content?.map((entry) => entry.text).join("") ?? "" }; } })();
  return { ms: Date.now() - started, error: reply.error?.message ?? (result.isError ? JSON.stringify(structured).slice(0, 300) : null), body: structured };
}
const norm = (value) => String(value ?? "").normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase();
function itemsOf(body) {
  const data = body?.data ?? body;
  for (const key of ["items", "results", "programs", "services", "datasets", "projects", "news", "matches"]) if (Array.isArray(data?.[key])) return data[key];
  return Array.isArray(data) ? data : [];
}
const titleOf = (item) => [item.title, item.name, item.question, item.document_title, item.heading, item.source?.title, item.manual_title].filter(Boolean).join(" ");
const idOf = (item) => item.id ?? item.faq_id ?? item.evidence_id ?? item.statistics_id ?? "";
const snippetOf = (item) => String(item.snippet ?? item.excerpt ?? item.text ?? item.answer_excerpt ?? "").replace(/…|\.\.\./g, " ");
const UNSURE = /UNSUPPORTED|YEAR_MISMATCH|NOT_FOUND|NO_EVIDENCE|INSUFFICIENT|RELATED|UNAVAILABLE|NOT_AVAILABLE|미확인|찾지 못|없습니다/;
const DATE_KEYS = /written_date|as_of|period|effective_reference_date|year_evidence|published|reference_date|fiscal_year|basis_date|checked_at/;

await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcp-eval-v2", version: "1" } });
await fetch(url, { method: "POST", headers: { ...headers, "mcp-session-id": session }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
const results = [];
for (const entry of suite.cases) {
  const checks = {};
  let detailText = "";
  const response = await call(entry.tool, entry.args);
  const items = itemsOf(response.body);
  const top = items.slice(0, entry.args.limit ?? 10);
  const raw = JSON.stringify(response.body ?? {});
  if (entry.domain === "미확인 정보") {
    checks["미확인 정보"] = !response.error && (top.length === 0 || UNSURE.test(raw));
  } else {
    let hit = null;
    if (entry.gold.faq_id) hit = top.find((item) => idOf(item) === entry.gold.faq_id);
    else if (entry.gold.documents) hit = top.find((item) => entry.gold.documents.some((name) => norm(titleOf(item) + " " + raw.slice(0, 0)).includes(norm(name).slice(0, 18)) || norm(JSON.stringify(item)).includes(norm(name).slice(0, 18))));
    else if (entry.gold.title) hit = top.find((item) => norm(titleOf(item)).includes(norm(entry.gold.title)) || norm(entry.gold.title).includes(norm(titleOf(item))) && norm(titleOf(item)).length >= 4);
    else if (entry.gold.title_contains !== undefined) hit = top.find((item) => !entry.gold.title_contains || norm(titleOf(item)).includes(norm(entry.gold.title_contains))) ?? null;
    checks["검색 적합성"] = Boolean(hit) && !response.error;
    if (explicitEmptyScope(entry, response)) {
      checks["검색 적합성"] = true;
    }
    if (hit && (entry.tool === "search_faq" || entry.tool === "search_manuals")) {
      const detail = entry.tool === "search_faq" ? await call("get_faq", { id: idOf(hit) }) : await call("get_manual_section", { section_id: idOf(hit) });
      detailText = JSON.stringify(detail.body ?? {});
      let manualText = entry.tool === "search_manuals" ? detail.body?.data?.text ?? detail.body?.text ?? "" : "";
      let nextOffset = detail.body?.data?.next_offset;
      let quotePages = 1;
      while (entry.tool === "search_manuals" && !manualQuoteMatches(hit.excerpt ?? hit.snippet ?? "", manualText) && Number.isInteger(nextOffset) && quotePages < 32) {
        const continued = await call("get_manual_section", { section_id: idOf(hit), offset: nextOffset });
        if (continued.error) break;
        manualText += continued.body?.data?.text ?? "";
        nextOffset = continued.body?.data?.next_offset;
        quotePages += 1;
      }
      const original = norm(entry.tool === "search_faq" ? detail.body?.answer ?? detailText : detail.body?.data?.text ?? detail.body?.text ?? detailText);
      const quotes = entry.tool === "search_faq"
        ? (hit.answer_criteria?.requirements ?? []).map((requirement) => norm(requirement.source_quote)).filter((quote) => quote.length >= 6)
        : [norm(snippetOf(hit)).slice(4, 40)].filter((quote) => quote.length >= 8);
      checks["원문 인용 정확도"] = entry.tool === "search_manuals"
        ? manualQuoteMatches(hit.excerpt ?? hit.snippet ?? "", manualText)
        : quotes.length ? quotes.every((quote) => original.includes(quote)) : null;
      if (entry.gold.amounts?.length) checks["금액·단위"] = entry.gold.amounts.every((amount) => norm(detailText).includes(norm(amount)));
      if (entry.gold.exception) checks["예외사항"] = /다만|제외|예외|해당하지 않|불가/.test(detailText);
      if (entry.gold.and_or) checks["AND/OR"] = /및|또는|모두|중 하나|이상/.test(detailText);
      if (entry.criteria.includes("대상자 조건")) checks["대상자 조건"] = detailText.length > 200;
    } else if (hit && entry.tool === "find_programs") {
      const detail = await call("get_eligibility", { implementation_id: hit.implementation_id ?? hit.id });
      const detailBody = JSON.stringify(detail.body ?? {});
      checks["대상자 조건"] = !detail.error && /target|지원대상|unverified|미확인/.test(detailBody);
    } else if (hit && entry.tool === "search_welfare_services") {
      const detail = await call("fetch", { id: idOf(hit) });
      checks["대상자 조건"] = !detail.error && /"target"/.test(JSON.stringify(detail.body ?? {}));
    } else if (entry.criteria.includes("대상자 조건")) {
      checks["대상자 조건"] = false;
    }
    const explicitUnavailable = explicitEmptyScope(entry, response);
    if (entry.criteria.includes("기간·적용연도")) checks["기간·적용연도"] = explicitUnavailable ? null : DATE_KEYS.test(raw + detailText);
    if (entry.domain === "예산·집행액") checks["금액·단위"] = !/\d+\.\d+e\+|NaN/.test(raw) && (top.length === 0 || /"[0-9]{1,15}"|원/.test(raw));
    if (entry.domain === "복지통계" && hit) checks["금액·단위"] = /unit|단위/.test(JSON.stringify(hit) + raw);
  }
  const values = Object.values(checks).filter((value) => value !== null);
  results.push({ id: entry.id, domain: entry.domain, tool: entry.tool, args: entry.args, ms: response.ms, error: response.error, release_bundle_id: response.body?.release_bundle_id ?? null, components: response.body?.components ?? null, returned: top.length, checks, pass: values.length > 0 && values.every(Boolean), top_titles: top.slice(0, 3).map(titleOf) });
  process.stdout.write(results.at(-1).pass ? "." : "x");
}
const rate = (list) => (list.length ? Math.round((list.filter(Boolean).length / list.length) * 1000) / 10 : null);
const byDomain = {};
for (const result of results) (byDomain[result.domain] ??= []).push(result.pass);
const byCriterion = {};
for (const result of results) for (const [criterion, value] of Object.entries(result.checks)) if (value !== null) (byCriterion[criterion] ??= []).push(value);
const conditionChecks = results.flatMap((result) => ["대상자 조건", "예외사항", "AND/OR", "금액·단위"].map((key) => result.checks[key]).filter((value) => value !== undefined && value !== null));
const summary = {
  suite: suite.version, suite_sha256: suite.sha256, server: url, run_at: new Date().toISOString(), cases: results.length,
  overall_pass_rate: rate(results.map((result) => result.pass)),
  by_domain: Object.fromEntries(Object.entries(byDomain).map(([key, list]) => [key, { cases: list.length, pass_rate: rate(list) }])),
  by_criterion: Object.fromEntries(Object.entries(byCriterion).map(([key, list]) => [key, { checks: list.length, pass_rate: rate(list) }])),
  citation_accuracy: rate(byCriterion["원문 인용 정확도"] ?? []),
  condition_omission_rate: conditionChecks.length ? Math.round((conditionChecks.filter((value) => !value).length / conditionChecks.length) * 1000) / 10 : null,
  median_ms: results.map((result) => result.ms).sort((a, b) => a - b)[Math.floor(results.length / 2)],
  layer_note: "MCP 도구가 올바른 원문을 반환하는지만 측정했습니다. AI 모델의 최종 답변 정확도는 측정하지 않았습니다.",
};
mkdirSync(out, { recursive: true });
writeFileSync(out + "/results.json", JSON.stringify({ summary, results }, null, 1) + "\n");
console.log("\n" + JSON.stringify(summary, null, 1));

