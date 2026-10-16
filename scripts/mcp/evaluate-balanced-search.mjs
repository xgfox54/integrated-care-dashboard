import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const JEJU = "region:제주특별자치도";
const SGW = JEJU + "|서귀포시";
const GANGNAM = "region:서울특별시|강남구";
const normal = (value) => String(value ?? "").normalize("NFKC").replace(/[\p{P}\p{S}\s]+/gu, "").toLowerCase();
const contains = (text, term) => normal(text).includes(normal(term));
const titles = (items) => items.map((item) => [item.title, item.name, item.question, ...(item.sources ?? []).map((source) => source.document_title)].filter(Boolean).join(" "));
const positive = (title) => ({ nonempty: true, title });
const empty = { empty: true };

export const CASES = [
  ["search", { query: "서귀포시 복지사업" }, { nonempty: true, region: SGW }],
  ["search", { query: "부산 해운대구 복지사업" }, { nonempty: true, region: "region:부산광역시|해운대구" }],
  ["search", { query: "제주시 온정가게" }, { unsupported: true, absentTitle: "서귀포 온정가게" }],
  ["search", { query: "2030년 기초연금 월 지급액 얼마인가요?" }, { unsupported: true, reason: "YEAR_" }],
  ["search", { query: "기초연금 지급액과 구비서류 알려줘" }, { facts: ["amount", "document"] }],

  ["search_welfare_services", { query: "온정가게", region_id: SGW }, positive("서귀포 온정가게")],
  ["search_welfare_services", { query: "취업준비 청년", region_id: SGW }, positive("취업준비 청년")],
  ["search_welfare_services", { query: "100세 장수축하금", region_id: SGW }, positive("100세 장수축하금")],
  ["search_welfare_services", { query: "온정가게", region_id: JEJU + "|제주시", include_ancestor_scope: false }, empty],
  ["search_welfare_services", { query: "존재하지않는우주여행지원금", region_id: SGW }, empty],

  ["find_programs", { query: "119안심콜서비스", region_id: JEJU }, positive("119안심콜서비스")],
  ["find_programs", { query: "119 안심콜 서비스", region_id: JEJU }, positive("119안심콜서비스")],
  ["find_programs", { query: "ICT", region_id: JEJU }, positive("ICT")],
  ["find_programs", { query: "존재하지않는우주여행지원금", region_id: JEJU }, empty],
  ["find_programs", { query: "119안심콜서비스%_", region_id: JEJU }, empty],

  ["search_manuals", { query: "기초연금 선정기준액", limit: 5 }, positive("기초연금")],
  ["search_manuals", { query: "장애인활동지원 신청", limit: 5 }, positive("장애인")],
  ["search_manuals", { query: "긴급복지 생계지원", limit: 5 }, positive("긴급")],
  ["search_manuals", { query: "제주시만 온정가게", limit: 5 }, { absentTitle: "서귀포 온정가게", region: JEJU + "|제주시" }],
  ["search_manuals", { query: "2025년 자료는 제외하고 2026년 생계급여 금액", limit: 10 }, { nonempty: true, absentTitle: "25년 국민기초생활보장" }],

  ["search_faq", { query: "기초연금 신청", limit: 5 }, positive("기초연금")],
  ["search_faq", { query: "재난적의료비 지급결정 소요기간", limit: 5 }, positive("재난적의료비")],
  ["search_faq", { query: "2021년 기초연금 선정기준액", limit: 5 }, { yearScope: "YEAR_MISMATCH" }],
  ["search_faq", { query: "2030년 기초연금 선정기준액", limit: 5 }, { yearScope: "YEAR_MISMATCH" }],
  ["search_faq", { query: "기초연금 우주여행지원금", limit: 5 }, empty],

  ["search_news", { query: "노인 맞춤 돌봄", region_ids: [SGW], limit: 5 }, positive("노인맞춤돌봄서비스 수행기관 모집 공고")],
  ["search_news", { query: "노인 맞춤 돌봄", region_ids: [SGW], date_from: "2026-10-02", limit: 5 }, empty],
  ["search_news", { query: "통합돌봄", limit: 5 }, positive("돌봄")],
  ["search_news", { query: "복지", date_from: "2030-01-01", date_to: "2030-12-31", limit: 5 }, empty],
  ["search_news", { query: "존재하지않는우주여행지원금", limit: 5 }, empty],

  ["search_statistics", { query: "합계 출산율", limit: 10 }, positive("합계출산율")],
  ["search_statistics", { query: "노년부양비", data_only: true, limit: 10 }, { ...positive("노년부양비"), dataOnly: true }],
  ["search_statistics", { query: "기초생활보장", limit: 10 }, positive("기초생활보장")],
  ["search_statistics", { query: "정신장애 유병률", limit: 10 }, empty],
  ["search_statistics", { query: "존재하지않는우주여행지원금", limit: 10 }, empty],

  ["find_budget_projects", { fiscal_year: 2026, mode: "integrated_care", region_id: JEJU, query: "통합돌봄", limit: 5 }, { ...positive("통합돌봄"), safeAmounts: true }],
  ["find_budget_projects", { fiscal_year: 2026, mode: "integrated_care", region_id: SGW, limit: 5 }, { nonempty: true, safeAmounts: true, scopeNote: "부서코드 앞자리" }],
  ["find_budget_projects", { fiscal_year: 2030, mode: "integrated_care", region_id: JEJU, limit: 5 }, { unavailable: true }],
  ["find_budget_projects", { fiscal_year: 2026, mode: "integrated_care", region_id: JEJU, query: "존재하지않는우주여행지원금", limit: 5 }, empty],
  ["find_budget_projects", { fiscal_year: 2026, mode: "integrated_care", region_id: JEJU, query: "통합돌봄", include_summary: true, limit: 2 }, { ...positive("통합돌봄"), safeAmounts: true }],

  ["search_budget_lines", { fiscal_year: 2026, issuer_sigungu: "금정구", query: "노인복지정책 업무추진", limit: 5 }, { ...positive("노인복지정책 업무추진"), budgetId: "bl-4ae144ae288ae247162d080e" }],
  ["search_budget_lines", { fiscal_year: 2026, issuer_sigungu: "금정구", query: "노인 복지 정책 업무 추진 우주여행", limit: 5 }, empty],
  ["search_budget_lines", { fiscal_year: 2026, issuer_sigungu: "금정구", query: "노인 복지 정책 업무 추진 %_", limit: 5 }, empty],
  ["search_budget_lines", { fiscal_year: 2030, issuer_sigungu: "금정구", query: "노인복지정책 업무추진", limit: 5 }, empty],
  ["search_budget_lines", { fiscal_year: 2026, issuer_sigungu: "금정구", query: "존재하지않는우주여행지원금", limit: 5 }, empty],

  ["find_care_institutions", { region_id: GANGNAM, query: "강남세곡 행복케어", limit: 5 }, positive("강남세곡 행복케어")],
  ["find_care_institutions", { region_id: GANGNAM, query: "강남세곡행복케어", limit: 5 }, positive("강남세곡 행복케어")],
  ["find_care_institutions", { region_id: GANGNAM, query: "강남세곡 행복케어", service_group: "RESIDENTIAL", limit: 5 }, empty],
  ["find_care_institutions", { region_id: GANGNAM, query: "존재하지않는우주여행지원금", limit: 5 }, empty],
  ["find_care_institutions", { region_id: SGW, limit: 5 }, { state: "LINK_UNVERIFIED", unknownTotal: true }],
].map(([tool, args, expect], index) => ({ id: "BAL-" + String(index + 1).padStart(3, "0"), tool, args, expect }));

export function evaluateCase(testCase, envelope) {
  const raw = envelope?.result ?? envelope;
  let value = raw?.structuredContent;
  if (value === undefined) {
    try { value = JSON.parse(raw?.content?.find((entry) => entry.type === "text")?.text ?? "null"); } catch { value = null; }
  }
  const error = envelope?.error ?? value?.error;
  const payload = value?.data ?? value;
  const recognizedItems = Array.isArray(payload) || [payload?.results, payload?.items, payload?.institutions].some(Array.isArray);
  const items = Array.isArray(payload) ? payload : payload?.results ?? payload?.items ?? payload?.institutions ?? [];
  const checks = [];
  const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });
  const expected = testCase.expect;
  if (expected.error) check("expected_error", error?.code === expected.error);
  else if (expected.unavailable) check("unavailable_source", !error && !raw?.isError && recognizedItems && items.length === 0 && payload?.status === "UNAVAILABLE" && payload?.reason_code === "NO_PUBLISHED_SNAPSHOT");
  else check("successful_response", recognizedItems && !raw?.isError && !error);
  if (expected.nonempty) check("positive_retrieval", items.length > 0);
  if (expected.empty) check("no_false_positive", items.length === 0);
  if (expected.title) check("expected_subject", titles(items).some((title) => contains(title, expected.title)));
  if (expected.absentTitle) check("incompatible_source_excluded", !titles(items).some((title) => contains(title, expected.absentTitle)));
  if (expected.region) check("query_region", (payload?.query_plan ?? value?.coverage?.query_plan)?.region_id === expected.region);
  if (expected.unsupported) check("no_unsupported_answer", payload?.answerability !== "SUPPORTED");
  if (expected.reason) check("explicit_evidence_gap", payload?.reason_codes?.some((reason) => reason.startsWith(expected.reason)));
  if (expected.facts) check("all_requested_facts", expected.facts.every((fact) => payload?.query_plan?.fact_types?.includes(fact)));
  if (expected.yearScope) check("year_scope", items.length > 0 && items.every((item) => item.scope_flags?.includes(expected.yearScope) && item.freshness?.status !== "CURRENT"));
  if (expected.dataOnly) check("connected_numeric_source", items.every((item) => item.data_available && item.dataset_id));
  if (expected.safeAmounts) check("unverified_amounts_not_asserted", items.length > 0 && items.every((item) => item.unit_verification === "VERIFIED" || item.amount_status === "NOT_VERIFIED" && item.current_budget_krw === null && item.public_expenditure_krw === null));
  if (expected.scopeNote) check("admin_unit_scope_disclosed", (value?.warnings ?? []).some((warning) => String(warning).includes(expected.scopeNote)));
  if (expected.budgetId) check("source_record", items.some((item) => (item.budget_line_id ?? item.line_id ?? item.id) === expected.budgetId));
  if (expected.state) check("availability_state", payload?.state === expected.state);
  if (expected.unknownTotal) check("unknown_not_zero", payload?.total === null || payload?.total_count === null);
  if (testCase.tool === 'search_faq' && items.length) check('condition_paragraphs_preserved', items.every(item =>
    item.structured_conditions?.condition_fields?.extraction_status === 'PARAGRAPH_ROUTING_ONLY'
    && ['eligibility', 'income_assets', 'documents', 'period', 'overlap_restrictions', 'exceptions'].every(field => Array.isArray(item.structured_conditions.condition_fields.fields[field]))));
  return { id: testCase.id, tool: testCase.tool, args: testCase.args, pass: checks.every((entry) => entry.pass), checks, observations: { count: items.length, answerability: payload?.answerability, reason_codes: payload?.reason_codes, error, titles: titles(items).slice(0, 5) } };
}

export function summarize(results) {
  const completeCases = results.length === CASES.length && new Set(results.map(item => item.id)).size === CASES.length
    && CASES.every(expected => results.some(actual => actual.id === expected.id && actual.tool === expected.tool));
  const dimensions = ['positive_retrieval', 'query_region', 'year_scope', 'condition_paragraphs_preserved', 'connected_numeric_source', 'unverified_amounts_not_asserted', 'unknown_not_zero'].map(name => {
    const checks = results.flatMap(result => result.checks ?? []).filter(check => check.name === name);
    return { name, tested: checks.length, passed: checks.filter(check => check.pass).length };
  });
  const domains = [...new Set(CASES.map((item) => item.tool))].map((tool) => {
    const rows = results.filter((item) => item.tool === tool);
    return { tool, tested: rows.length, passed: rows.filter((item) => item.pass).length, percent: rows.length ? rows.filter((item) => item.pass).length / rows.length * 100 : 0 };
  });
  const positiveIds = new Set(CASES.filter((item) => item.expect.nonempty).map((item) => item.id));
  const positiveResults = results.filter((item) => positiveIds.has(item.id));
  return { evaluation: "BALANCED_SEARCH_CONTRACT_REGRESSION", final_answer_accuracy: "NOT_EVALUATED", threshold_percent: 95, total: results.length, passed: results.filter((item) => item.pass).length, positive_retrieval: { tested: positiveResults.length, passed: positiveResults.filter((item) => item.pass).length }, macro_percent: domains.reduce((total, domain) => total + domain.percent, 0) / domains.length, gate_passed: completeCases && domains.every((domain) => domain.percent >= 95), domains, dimensions };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [endpoint, outputDirectory, observationPath] = process.argv.slice(2);
  if (!endpoint || !outputDirectory) throw new Error("Usage: node evaluate-balanced-search.mjs MCP_URL OUTPUT_DIRECTORY [RECORDED_RESPONSES_JSON]");
  const recorded = observationPath ? JSON.parse(await readFile(observationPath, "utf8")) : null;
  const responses = [];
  const results = [];
  for (const item of CASES) {
    let response = recorded?.find((row) => row.id === item.id)?.response;
    if (!recorded) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const request = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: item.id, method: "tools/call", params: { name: item.tool, arguments: item.args } }), signal: AbortSignal.timeout(90000) });
        const text = await request.text();
        try { response = JSON.parse(text); } catch { response = { error: { code: "HTTP_" + request.status } }; }
        const busy = request.status === 429 || /DATA_SOURCE_BUSY/.test(text);
        if (!busy || attempt === 3) break;
        console.log(JSON.stringify({ retry: item.id, attempt: attempt + 1 }));
        await new Promise((done) => setTimeout(done, Math.min(60000, Math.max(5000, Number(request.headers.get("retry-after") ?? 15) * 1000))));
      }
    }
    responses.push({ id: item.id, response });
    const result = evaluateCase(item, response);
    results.push(result);
    console.log(JSON.stringify({ id: item.id, tool: item.tool, pass: result.pass, failed: result.checks.filter((check) => !check.pass).map((check) => check.name) }));
  }
  const summary = summarize(results);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, "responses.json"), JSON.stringify(responses));
  await writeFile(resolve(outputDirectory, "evaluation.json"), JSON.stringify({ generated_at: new Date().toISOString(), endpoint, summary, results }, null, 2));
  console.log(JSON.stringify(summary));
  process.exitCode = summary.gate_passed ? 0 : 1;
}
