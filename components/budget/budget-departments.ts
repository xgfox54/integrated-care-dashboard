import labels from "./budget-department-labels.json" with { type: "json" };

// 검증된 원본에서 생성한 표시명. 갱신: node scripts/build-budget-department-labels.mjs
const departmentLabels: Readonly<Record<string, string>> = labels;

export function budgetDepartmentName(entityName: string, code: string): string | null {
  return departmentLabels[entityName + "|" + code] ?? null;
}

export function budgetDepartmentLabel(entityName: string, code: string): string {
  const name = budgetDepartmentName(entityName, code);
  return name ? `${name} (${code})` : `부서코드 ${code} (명칭 미확인)`;
}

export function formatBudgetLocalTitle(regionName: string, departmentName: string): string {
  if (!departmentName) return regionName;
  const suffix = departmentName.startsWith(regionName) ? departmentName.slice(regionName.length).trim() : departmentName;
  return [regionName, suffix].filter(Boolean).join(" ");
}
