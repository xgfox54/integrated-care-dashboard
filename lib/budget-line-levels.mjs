/** Fixed source hierarchy shared by extraction, archive validation and display. */
export const BUDGET_LINE_DEPTH = Object.freeze({
  department: 0, policy: 1, unit: 2, detail_project: 3,
  object_group: 4, object: 5, item: 6, sub_item: 7, sub_item_detail: 8,
});
export const BUDGET_LEVEL_LABELS = Object.freeze({
  department: '부서', policy: '정책사업', unit: '단위사업', detail_project: '세부사업',
  object_group: '편성목', object: '통계목', item: '부기', sub_item: '하위 산출항목',
  sub_item_detail: '세부 산출항목',
});
/** @param {string} level */
export function budgetLineDepth(level) {
  return Object.entries(BUDGET_LINE_DEPTH).find(([key]) => key === level)?.[1] ?? null;
}
