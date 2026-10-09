// 복지예산 세부 예산분야(지방재정365 부문코드). 사회복지(080)·보건(090) 분야 아래 부문만 고른다(2026-10-09 운영자 지시).
// 이름은 운영자가 정한 표시 이름이며, 조회는 원천 부문코드(fiscal_project.part_code) 그대로 고른다.

export type BudgetPartMode = "social_welfare" | "health";

export interface BudgetPart {
  readonly code: string;
  readonly name: string;
  readonly mode: BudgetPartMode;
}

export const BUDGET_PARTS: readonly BudgetPart[] = [
  { code: "081", name: "기초생활보장", mode: "social_welfare" },
  { code: "082", name: "취약계층지원", mode: "social_welfare" },
  { code: "086", name: "노동", mode: "social_welfare" },
  { code: "087", name: "보훈", mode: "social_welfare" },
  { code: "088", name: "주택", mode: "social_welfare" },
  { code: "089", name: "사회복지일반", mode: "social_welfare" },
  { code: "08A", name: "보육", mode: "social_welfare" },
  { code: "08B", name: "가족및여성", mode: "social_welfare" },
  { code: "08C", name: "노인", mode: "social_welfare" },
  { code: "08D", name: "청소년", mode: "social_welfare" },
  { code: "091", name: "보건의료", mode: "health" },
];

const BY_CODE: ReadonlyMap<string, BudgetPart> = new Map(BUDGET_PARTS.map((part) => [part.code, part]));

export function budgetPartOf(code: string): BudgetPart | undefined {
  return BY_CODE.get(code.trim().toUpperCase());
}

/** 조회 범위에 사업이 있는 부문만, 정한 순서대로. 목록에 없는 원천 부문(옛 084·085 등)은 고르지 않는다. */
export function availableBudgetParts(counts: ReadonlyMap<string, number>): readonly (BudgetPart & { readonly project_count: number })[] {
  return BUDGET_PARTS.flatMap((part) => {
    const count = counts.get(part.code) ?? 0;
    return count > 0 ? [{ ...part, project_count: count }] : [];
  });
}
