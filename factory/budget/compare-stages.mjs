// 같은 기관·회계연도의 두 편성 단계 예산서를 세부사업 단위로 대조한다(작업지시서 v5 §22.7, T90).
// 추경 문서의 「기정예산액」은 그 추경 직전까지 확정된 금액이다. 제1회 추경이면 원칙적으로 본예산 의결액과 같아야 하고,
// 다르면(성립전 예산·이전 변경 등) 그 사업을 따로 보고한다. 금액을 서로 덮어쓰지 않고, 세부사업명+부서로만 짝을 짓는다.
import { readFileSync, writeFileSync } from "node:fs";

const squash = (text) => (text ?? "").replace(/[\s·ㆍ()（）\[\]「」『』<>]/g, "");
const value = (text) => (text === null || text === undefined ? null : Number(String(text).replace(/[△,-]/g, "")) * (/^[△-]/.test(String(text)) ? -1 : 1));

/** 세부사업을 「부서|세부사업명」과 「부서|단위사업|세부사업명」 두 열쇠로 묶는다(같은 부서에 같은 이름이 여럿이면 단위사업으로 가린다). */
function detailIndex(document) {
  const byNo = new Map(document.lines.map((line) => [line.line_no, line]));
  const up = (line, level) => { let at = line; while (at && at.level !== level) at = byNo.get(at.parent_line_no); return at?.name ?? ""; };
  const map = new Map();
  const put = (key, line) => (map.get(key) ?? map.set(key, []).get(key)).push(line);
  for (const line of document.lines.filter((item) => item.level === "detail_project")) {
    put(squash(up(line, "department")) + "|" + squash(line.name), line);
    put(squash(up(line, "department")) + "|" + squash(up(line, "unit")) + "|" + squash(line.name), line);
  }
  return map;
}

export function compareStages(base, revised) {
  const left = detailIndex(base);
  const right = detailIndex(revised);
  const results = [];
  for (const [key, lines] of right) {
    const parts = key.split("|");
    if (parts.length !== 2) continue;
    const [dept, name] = parts;
    for (const revisedLine of lines) {
      let candidates = left.get(key) ?? [];
      let matchedBy = "department_name";
      if (lines.length > 1 || candidates.length > 1) {
        // 같은 부서에 같은 이름이 여럿: 단위사업까지 같은 짝만 쓴다.
        const unitKey = [...right.entries()].find(([other, rows]) => other.split("|").length === 3 && other.startsWith(dept + "|") && rows.includes(revisedLine))?.[0];
        candidates = unitKey ? left.get(unitKey) ?? [] : [];
        matchedBy = "department_unit_name";
        if (candidates.length !== 1) { results.push({ department: dept, name, relation: "ambiguous_name", page: revisedLine.evidence.page }); continue; }
      }
      if (!candidates.length) {
        const pre = value(revisedLine.previous_amount_thousand_krw);
        // 기정예산액 0이고 본예산에 없으면 이번 추경에서 새로 편성한 사업과 맞는다. 0이 아닌데 없으면 이름이 바뀌었거나 성립전 예산 등이라 사람이 본다.
        results.push({ department: dept, name, relation: pre === 0 ? "new_in_revision" : "not_in_base_document_with_pre_revision", revised_amount: revisedLine.amount_thousand_krw, pre_revision: revisedLine.previous_amount_thousand_krw, page: revisedLine.evidence.page });
        continue;
      }
      const baseLine = candidates[0];
    const pre = value(revisedLine.previous_amount_thousand_krw);
    const baseAmount = value(baseLine.amount_thousand_krw);
    results.push({
      department: dept, name, relation: pre === null ? "pre_revision_missing" : pre === baseAmount ? "pre_revision_equals_base" : "pre_revision_differs",
      base_amount: baseLine.amount_thousand_krw, pre_revision: revisedLine.previous_amount_thousand_krw, revised_amount: revisedLine.amount_thousand_krw, change: revisedLine.change_amount_thousand_krw,
      base_page: baseLine.evidence.page, revised_page: revisedLine.evidence.page, matched_by: matchedBy,
    });
    }
  }
  const counts = results.reduce((acc, row) => ((acc[row.relation] = (acc[row.relation] ?? 0) + 1), acc), {});
  return { counts, results };
}

if (process.argv[1] && process.argv[1].endsWith("compare-stages.mjs")) {
  const [basePath, revisedPath, outPath] = process.argv.slice(2);
  const result = compareStages(JSON.parse(readFileSync(basePath, "utf8")), JSON.parse(readFileSync(revisedPath, "utf8")));
  if (outPath) writeFileSync(outPath, JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result.counts));
  for (const row of result.results.filter((item) => item.relation !== "pre_revision_equals_base")) console.log(JSON.stringify(row));
}
