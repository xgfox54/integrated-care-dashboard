import names from "./budget-department-names.json" with { type: "json" };

// 부서명은 기관과 부서코드로만 찾는다. 부서명은 거의 바뀌지 않으므로 지방재정365 기준일·연도가 달라도
// 같은 기관의 같은 부서코드는 같은 부서로 본다(2026-10-06 운영 결정). 근거끼리 이름이 엇갈리면 표시하지 않는다.
const known = new Map<string, Set<string>>();
// 보건소처럼 지방재정365에서 부서코드 하나로 묶였지만 행정표준코드상 아래에 과가 있는 부서는 과 이름을 함께 보여 준다.
const subunits = new Map<string, readonly string[]>();
// 원문 부서명과 별도로, 공식 조직상 소속을 드러내는 표시명(예: 서귀포시건강증진과 → 서귀포보건소 건강증진과).
const displayNames = new Map<string, string>();
for (const entry of names.mappings) {
  if (entry.status !== "verified_exact") continue;
  const key = entry.fiscal_entity_name + "|" + entry.department_code;
  known.set(key, (known.get(key) ?? new Set<string>()).add(entry.department_name));
  const sub = (entry as { sub_departments?: readonly string[] }).sub_departments;
  if (sub?.length) subunits.set(key, sub);
  const display = (entry as { display_name?: string }).display_name;
  if (display) displayNames.set(key, display);
}

export function budgetDepartmentName(entityName: string, code: string): string | null {
  const found = known.get(entityName + "|" + code);
  if (found?.size !== 1) return null;
  const name = displayNames.get(entityName + "|" + code) ?? [...found][0];
  const sub = subunits.get(entityName + "|" + code);
  return sub?.length ? name + "(" + sub.join("·") + ")" : name;
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
