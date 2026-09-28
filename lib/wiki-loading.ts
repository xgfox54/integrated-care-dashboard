// 통합돌봄 WIKI 사업 목록 불러오기 규칙(검색 API가 받는 쪽 크기는 20·30·50·100이다).
// - 보통: 50개씩 차례로 받아 100개까지 채운 뒤 멈춘다. 목록을 80% 이상 내리거나 「더 보기」를 누르면 50개씩 더 받는다.
// - 데이터 절약 모드: 미리 채우지 않는다. 20개를 받은 뒤 내릴 때마다 20개씩 받는다.

export interface WikiLoadPlan {
  readonly pageSize: number;
  readonly firstTarget: number;
  readonly step: number;
}

export const WIKI_LOAD_PLAN: WikiLoadPlan = { pageSize: 50, firstTarget: 100, step: 50 };
export const WIKI_SAVER_PLAN: WikiLoadPlan = { pageSize: 20, firstTarget: 20, step: 20 };
/** 목록을 이만큼(전체 높이 대비) 내리면 다음 묶음을 받는다. */
export const WIKI_SCROLL_THRESHOLD = 0.8;

/** 다음에 받을 쪽 번호. 목표 수만큼 받았거나 더 받을 것이 없으면 null. */
export function nextCatalogPage(loadedPages: number, pageSize: number, totalCount: number, target: number): number | null {
  return loadedPages * pageSize < Math.min(target, totalCount) ? loadedPages + 1 : null;
}

/** 다음 묶음까지 포함한 목표 수. 이미 받는 중이면 목표를 더 늘리지 않는다. */
export function extendTarget(currentTarget: number, loadedCount: number, step: number): number {
  return Math.max(currentTarget, loadedCount + step);
}

/** 스크롤 상자를 threshold 이상 내렸는지. 내릴 것이 없는 짧은 목록도 참이다. */
export function scrolledPast(
  box: { readonly scrollTop: number; readonly clientHeight: number; readonly scrollHeight: number },
  threshold = WIKI_SCROLL_THRESHOLD,
): boolean {
  return box.scrollTop + box.clientHeight >= box.scrollHeight * threshold;
}
