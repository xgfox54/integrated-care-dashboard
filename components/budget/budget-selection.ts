import type { BudgetFilters } from "./budget-paths";

export interface BudgetDepartment {
  readonly code: string;
  readonly fiscal_entity_name: string;
  readonly entity_id: string;
  readonly region_code: string;
  readonly project_count: number;
}

export function budgetDepartmentValue(department: BudgetDepartment): string {
  return department.entity_id + "|" + department.code;
}

export function selectBudgetDepartment(current: BudgetFilters, department: BudgetDepartment | undefined): BudgetFilters {
  if (!department) return { ...current, department: "", account: "" };
  return { ...current, region: department.region_code, entity: department.entity_id, department: department.code, account: "" };
}
