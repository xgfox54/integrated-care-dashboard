import { budgetDepartmentName } from "../../components/budget/budget-departments.ts";
import departmentNames from "../../components/budget/budget-department-names.json" with { type: "json" };

// 전남광주 통합 기관의 지방재정365 사업명 끝 「(전남)」「(광주)」는 옛 시·도 구분 표시라 예산서 원문 사업명에는 없다.
// 같은 부서코드 안에서는 이 표시가 모두 같으므로 이름 대조에서만 뗀다.
import departmentUmbrellas from "../../components/budget/budget-department-umbrellas.json" with { type: "json" };
const FORMER_REGION_TAG = /\s*[(（](전남|광주)[)）]\s*$/u;
export const squashName = (text: string) => text.replace(FORMER_REGION_TAG, "").replace(/[\s·ㆍ()（）\[\]「」『』<>]/g, "");
const departmentNameKey = (name: string) => name.normalize("NFC").replace(/\s/g, "");

export type BudgetIdentityLine = {
  readonly line_no: number;
  readonly parent_line_no: number | null;
  readonly level: string;
  readonly name: string;
  readonly annotations: readonly string[];
};

export type BudgetProjectIdentity = {
  readonly fiscal_project_id: string;
  readonly name: string;
  readonly department_code: string;
  readonly dbiz_code: string;
};

export type BudgetMatchBasis = "department_and_project_code" | "department_and_name" | "name_only" | "identity_conflict";
export type BudgetProjectMatches<T> = { readonly basis: BudgetMatchBasis; readonly candidates: readonly T[] };

/** 사업코드는 전역 고유값이 아니다. 호출부는 공개된 같은 재정주체·연도·회계의 행만 전달해야 한다. */
export function budgetDocumentMatcher(entityName: string | null, lines: readonly BudgetIdentityLine[]) {
  const byLine = new Map(lines.map((line) => [line.line_no, line]));
  const knownDepartments = new Map<string, Set<string>>();
  const remember = (name: string, code: string) => {
    const key = departmentNameKey(name);
    const codes = knownDepartments.get(key) ?? new Set<string>();
    codes.add(code);
    knownDepartments.set(key, codes);
  };
  for (const entry of departmentNames.mappings) {
    if (entry.fiscal_entity_name !== entityName || entry.status !== "verified_exact") continue;
    const name = budgetDepartmentName(entry.fiscal_entity_name, entry.department_code);
    if (name === null) continue;
    remember(name, entry.department_code);
    // 같은 부서코드는 같은 부서다. 예산서가 개편 전 이름을 쓰면 등록부가 기록한 옛 이름으로도 찾는다.
    const previous = (entry as { supersedes?: { department_name?: string } }).supersedes?.department_name;
    if (previous) remember(previous, entry.department_code);
  }
  // 예산서가 보건소 전체를 한 부서 머리로 묶는 경우: 공식 조직도와 확인된 현행 부서 등록부로만 하위 과를 인정한다.
  for (const entry of departmentUmbrellas.mappings) {
    if (entry.fiscal_entity_name !== entityName || entry.fiscal_year !== "2026" || entry.status !== "verified_exact") continue;
    if (entry.basis !== "official_organization_and_verified_department_registry" || !entry.organization_source.sha256) continue;
    const allVerified = entry.children.length > 0 && entry.children.every(child => knownDepartments.get(departmentNameKey(child.department_name))?.has(child.department_code));
    if (!allVerified) continue;
    for (const child of entry.children) remember(entry.source_department_name, child.department_code);
  }
  return <T extends BudgetProjectIdentity>(line: BudgetIdentityLine, candidates: readonly T[]): BudgetProjectMatches<T> => {
    let ancestor: BudgetIdentityLine | undefined = line;
    while (ancestor && ancestor.level !== "department") {
      ancestor = ancestor.parent_line_no === null ? undefined : byLine.get(ancestor.parent_line_no);
    }
    const departments = ancestor ? knownDepartments.get(departmentNameKey(ancestor.name)) : undefined;
    const hints = line.annotations.filter((annotation) => annotation.includes("부서코드") || annotation.includes("세부사업코드"));
    const named = candidates.filter((project) => squashName(project.name) === squashName(line.name));
    if (hints.length) {
      const hint = hints.length === 1 ? /^부서코드 (\d+) · 세부사업코드 ([A-Za-z0-9]+)$/.exec(hints[0]) : null;
      if (!hint || !departments?.has(hint[1])) return { basis: "identity_conflict", candidates: [] };
      return { basis: "department_and_project_code", candidates: named.filter((project) => project.department_code === hint[1] && project.dbiz_code === hint[2]) };
    }
    return departments
      ? { basis: "department_and_name", candidates: named.filter((project) => departments.has(project.department_code)) }
      : { basis: "name_only", candidates: named };
  };
}
