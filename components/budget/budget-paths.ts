// 복지예산 화면의 조회 주소. 서버 페이지(첫 조회 미리 받기)와 화면이 같은 주소를 쓰도록 한곳에 둔다.

export interface BudgetFilters { readonly mode: string; readonly date: string; readonly region: string; readonly entity: string; readonly department: string; readonly account: string; readonly q: string; readonly page: number; readonly targetGroup?: string; readonly part?: string }

export const EMPTY_BUDGET_FILTERS: BudgetFilters = { mode: "social_welfare", date: "", region: "", entity: "", department: "", account: "", q: "", page: 1, part: "" };

/** 조회 결과(합계·지도·목록). 큰 조건 목록은 빼고 받는다. */
export function budgetResultPath(filters: BudgetFilters): string {
  const params = new URLSearchParams({ mode: filters.mode, page: String(filters.page) });
  for (const key of ["date", "region", "entity", "department", "account", "part", "q"] as const) if (filters[key]) params.set(key, filters[key]);
  // 대상자 묶음(관계성 지도에서 연 목록): 세부사업명에 묶음 낱말 중 하나가 들어간 사업. 지도 집계와 같은 조건이다.
  if (filters.targetGroup) params.set("target_group", filters.targetGroup);
  params.set("view", "main");
  return "/api/budget?" + params.toString();
}

export function budgetFiltersPath(filters: BudgetFilters): string {
  // 조건 목록(부서·회계·세부 예산분야)은 고른 세부 예산분야와 무관하다. 분야를 바꿔도 목록을 다시 받지 않는다.
  const params = new URLSearchParams({ mode: filters.mode });
  for (const key of ["date", "region", "entity", "department"] as const) if (filters[key]) params.set(key, filters[key]);
  params.set("view", "filters");
  return "/api/budget?" + params.toString();
}

/** 처음 화면(사회복지 전국 1쪽) 조회 주소: HTML과 함께 내려받기 시작한다. */
export const FIRST_BUDGET_RESULT_PATH = budgetResultPath(EMPTY_BUDGET_FILTERS);

export function budgetNationalPath(filters: BudgetFilters): string {
  return budgetResultPath({ ...EMPTY_BUDGET_FILTERS, mode: filters.mode });
}
