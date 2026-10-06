// 예산서(편성 단계 문서) 세부사업 금액과 지방재정365 「세부사업별 세출현황」(QWGJK) 예산현액을 대조한다(작업지시서 v5 T104).
// 두 값은 뜻이 다르다: 예산서는 그 단계(예: 본예산) 의결 금액(천원 표시), API 예산현액은 기준일의 현액(추경·이월·전용 반영 가능, 원).
// 그래서 어느 쪽도 다른 쪽을 덮어쓰지 않고, 회계·단계·단위·기준일을 먼저 적은 뒤 차이를 분류만 한다.
import { readFileSync, writeFileSync } from "node:fs";

const squash = (text) => (text ?? "").replace(/[\s·ㆍ()（）\[\]「」『』<>]/g, "");
const toWon = (thousand) => BigInt(thousand.replace(/[△,]/g, "")) * 1000n * (thousand.startsWith("△") ? -1n : 1n);

export function compareWithApi(document, apiRows, options = {}) {
  const account = options.accountCode ?? "100";
  const api = apiRows.filter((row) => row.account.startsWith(account + " "));
  const byName = new Map();
  for (const row of api) (byName.get(squash(row.name)) ?? byName.set(squash(row.name), []).get(squash(row.name))).push(row);
  const results = [];
  for (const line of document.lines.filter((l) => l.level === "detail_project" && l.amount_thousand_krw !== null)) {
    const matches = byName.get(squash(line.name)) ?? [];
    const entry = { line_no: line.line_no, name: line.name, document_amount_thousand_krw: line.amount_thousand_krw, document_amount_krw: toWon(line.amount_thousand_krw).toString(), page: line.evidence.page };
    if (!matches.length) { results.push({ ...entry, relation: "not_found_in_api" }); continue; }
    if (matches.length > 1) { results.push({ ...entry, relation: "ambiguous_name_in_api", api_candidates: matches.map((m) => ({ id: m.id, dept: m.dept, current_budget_krw: m.current_budget_krw })) }); continue; }
    const match = matches[0];
    const docWon = toWon(line.amount_thousand_krw);
    const apiWon = match.current_budget_krw === null ? null : BigInt(match.current_budget_krw);
    const diff = apiWon === null ? null : apiWon - docWon;
    const abs = diff === null ? null : diff < 0n ? -diff : diff;
    const relation = apiWon === null ? "api_amount_missing" : abs < 1000n ? "same_within_display_rounding" : diff > 0n ? "api_current_higher" : "api_current_lower";
    results.push({ ...entry, relation, api: { fiscal_project_id: match.id, department_code: match.dept, source_project_code: match.code, reference_date: match.reference_date, current_budget_krw: match.current_budget_krw, public_expenditure_krw: match.public_expenditure_krw, field: match.field + " · " + match.part }, difference_krw: diff === null ? null : diff.toString() });
  }
  const counts = results.reduce((acc, r) => ((acc[r.relation] = (acc[r.relation] ?? 0) + 1), acc), {});
  return {
    basis: {
      document: { stage: options.documentStage ?? "unknown", account: options.accountName ?? "일반회계", unit: "천원(원문 표시)", fiscal_year: options.fiscalYear ?? null },
      api: { measure: "예산현액(bdg_cash_amt, 기준일 현액)", unit: "원", reference_dates: [...new Set(api.map((row) => row.reference_date))].sort() },
      rule: "문서 금액과 API 예산현액을 서로 덮어쓰지 않는다. 1,000원 미만 차이는 문서의 천원 표시 반올림으로 본다. 차이는 추경·이월·전용 등으로 생길 수 있으나 이 대조만으로 원인을 정하지 않는다.",
    },
    counts, results,
  };
}

if (process.argv[1] && process.argv[1].endsWith("compare-api.mjs")) {
  const [docPath, apiPath, outPath] = process.argv.slice(2);
  const document = JSON.parse(readFileSync(docPath, "utf8"));
  const api = JSON.parse(readFileSync(apiPath, "utf8"));
  const result = compareWithApi(document, api.rows, { documentStage: "adopted_initial", fiscalYear: "2026" });
  result.basis.api.snapshot = api.meta?.snapshot ?? null;
  if (outPath) writeFileSync(outPath, JSON.stringify(result, null, 1));
  console.log(JSON.stringify({ basis: result.basis, counts: result.counts }, null, 1));
}
