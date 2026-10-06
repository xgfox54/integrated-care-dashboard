// 복지예산 화면의 조회 주소. 서버 페이지(첫 조회 미리 받기)와 화면이 같은 주소를 쓰도록 한곳에 둔다.

export interface BudgetFilters { readonly mode: string; readonly date: string; readonly region: string; readonly entity: string; readonly department: string; readonly account: string; readonly q: string; readonly page: number }

export const EMPTY_BUDGET_FILTERS: BudgetFilters = { mode: "social_welfare", date: "", region: "", entity: "", department: "", account: "", q: "", page: 1 };

/** 조회 결과(합계·지도·목록). 큰 조건 목록은 빼고 받는다. */
export function budgetResultPath(filters: BudgetFilters): string {
  const params = new URLSearchParams({ mode: filters.mode, page: String(filters.page) });
  for (const key of ["date", "region", "entity", "department", "account", "q"] as const) if (filters[key]) params.set(key, filters[key]);
  params.set("view", "main");
  return "/api/budget?" + params.toString();
}

/** 조건 목록(지역·기관·부서·회계). 모드·기준일·지역·기관이 같으면 쪽·검색어가 바뀌어도 다시 받지 않는다. */
export function budgetFiltersPath(filters: BudgetFilters): string {
  const params = new URLSearchParams({ mode: filters.mode });
  for (const key of ["date", "region", "entity"] as const) if (filters[key]) params.set(key, filters[key]);
  params.set("view", "filters");
  return "/api/budget?" + params.toString();
}

/** 처음 화면(사회복지 전국 1쪽) 조회 주소: HTML과 함께 내려받기 시작한다. */
export const FIRST_BUDGET_RESULT_PATH = budgetResultPath(EMPTY_BUDGET_FILTERS);
