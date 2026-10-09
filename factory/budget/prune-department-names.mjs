import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { outOfScope } from "./ledger-departments.mjs";

// 부서명은 사회복지·보건 분야 세부사업이 있는 부서코드만 둔다(2026-10-06 운영자 지시).
// 총무과·체육진흥과처럼 이 화면에 나오지 않는 부서와 읍·면·동·의회·단독 보건소·도서관은 지운다.
export function pruneDepartmentNames(names, relevantKeys) {
  const relevant = new Set(relevantKeys);
  const kept = names.mappings.filter((entry) => relevant.has(entry.fiscal_entity_name + "|" + entry.department_code) && !outOfScope(entry.department_name));
  return { kept: { ...names, mappings: kept }, removed: names.mappings.length - kept.length };
}

export async function relevantDepartmentKeys(publicApi) {
  const keys = new Set();
  for (const mode of ["social_welfare", "health"]) {
    const response = await fetch(publicApi + "?" + new URLSearchParams({ mode, view: "filters" }), { signal: AbortSignal.timeout(60000), redirect: "error" });
    if (!response.ok) throw Error("HTTP_" + response.status);
    const departments = (await response.json()).filters?.departments;
    if (!Array.isArray(departments) || !departments.length) throw Error("DEPARTMENT_FACETS_MISSING");
    for (const department of departments) keys.add(department.fiscal_entity_name + "|" + department.code);
  }
  return [...keys];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = fileURLToPath(new URL("../../components/budget/budget-department-names.json", import.meta.url));
  const keys = await relevantDepartmentKeys(process.argv[2] ?? "https://integrated-care-national-dashboard.xgfox54.chatgpt.site/api/budget");
  const { kept, removed } = pruneDepartmentNames(JSON.parse(readFileSync(file, "utf8")), keys);
  writeFileSync(file, JSON.stringify(kept, null, 2) + "\n");
  console.log(JSON.stringify({ relevant_codes: keys.length, kept: kept.mappings.length, removed }));
}

