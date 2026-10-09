import { budgetLineDepth } from "../../lib/budget-line-levels.mjs";

export interface BudgetDocumentLine {
  readonly budget_line_id: string;
  readonly line_no: number;
  readonly parent_line_no: number | null;
  readonly level: string;
  readonly level_label: string;
  readonly code: string | null;
  readonly name: string;
  readonly formula_text: string | null;
  readonly amount_thousand_krw: string | null;
  readonly amount_krw: string | null;
  readonly previous_amount_thousand_krw: string | null;
  readonly change_amount_thousand_krw: string | null;
  readonly funding: readonly { readonly label: string; readonly amount_thousand_krw: string }[];
  readonly evidence: { readonly page: number | null };
  readonly annotations: readonly string[];
  readonly api_comparison?: null | { readonly relation: string; readonly relation_label: string; readonly api: null | { readonly current_budget_krw: string | null; readonly reference_date: string; readonly department_code: string } };
}

export const RELATION_TONE: Readonly<Record<string, "success" | "warning" | "neutral" | "info">> = {
  same_within_display_rounding: "success", api_current_higher: "info", api_current_lower: "warning", not_found_in_api: "neutral", ambiguous_name_in_api: "neutral", api_amount_missing: "neutral",
};

export const budgetDocumentIndent = (level: string) => ({ paddingLeft: 0.75 + (budgetLineDepth(level) ?? 0) * 0.85 + "rem" });
