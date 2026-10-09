import { BUDGET_LINE_DEPTH, BUDGET_LEVEL_LABELS } from '../budget-line-levels.mjs';

export { BUDGET_LEVEL_LABELS };
export const BUDGET_LEVELS = Object.keys(BUDGET_LINE_DEPTH);
export type BudgetLevel = keyof typeof BUDGET_LINE_DEPTH;
export const DEPTH = BUDGET_LINE_DEPTH;

export function isBudgetLevel(value: unknown): value is BudgetLevel {
  return typeof value === 'string' && Object.hasOwn(BUDGET_LINE_DEPTH, value);
}
