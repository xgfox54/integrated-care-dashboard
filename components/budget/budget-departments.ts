import names from "./budget-department-names.json" with { type: "json" };

/** 예산서 대조가 끝난 기관·연도·기준일만 사용한다. 다른 날짜나 미확인 코드는 원천 코드로 남긴다. */
export function budgetDepartmentLabel(entityName: string, code: string, year?: string, referenceDate?: string): string {
  const matches = names.mappings.filter((entry) => entry.status === "verified_exact" && entry.fiscal_entity_name === entityName && entry.department_code === code && entry.fiscal_year === year && entry.reference_date === referenceDate);
  if (matches.length !== 1) return `부서코드 ${code} (명칭 미확인)`;
  return `${matches[0].department_name} (${code})`;
}

export function budgetDepartmentFilterLabel(entityName: string, code: string, items: readonly { fiscal_entity: { name: string }; fiscal_year: string; reference_date: string }[]): string {
  const contexts = new Map(items.filter((item) => item.fiscal_entity.name === entityName).map((item) => [item.fiscal_year + "|" + item.reference_date, item]));
  const context = contexts.size === 1 ? contexts.values().next().value : undefined;
  return budgetDepartmentLabel(entityName, code, context?.fiscal_year, context?.reference_date);
}
