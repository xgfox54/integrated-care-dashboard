// 돌봄자원(장기요양기관·KOSIS 돌봄 수요) 웹 공개 보류. 2026-10-05 운영자 지시: 아직 공개할 때가 아니고 진행 방향이 정해지지 않아 후순위로 보류.
// 2026-10-11 운영자 지시: 웹 화면은 계속 숨기고 공개 MCP 도구 3개만 연다. 도구가 쓸 자료를 위해 배경 수집도 다시 돈다.
// 웹을 다시 열 때는 CARE_RESOURCES_PUBLIC을 true로 바꾸면 메뉴·/care 화면·/api/care·데이터 출처 표시가 돌아온다.
// 이미 받은 자료와 표(ltc_*, kosis_*)는 지우지 않는다. 법정동코드·정부24·법령 연계는 다른 화면이 쓰므로 그대로 둔다.
export const CARE_RESOURCES_PUBLIC: boolean = false;
export const CARE_RESOURCES_MCP: boolean = true;
export const CARE_RESOURCES_COLLECTED: boolean = CARE_RESOURCES_PUBLIC || CARE_RESOURCES_MCP;

/** 돌봄자원 연계. CARE_RESOURCES_COLLECTED가 false이면 배경 수집하지 않는다(관리자 화면의 「한 단계 수집」은 그대로 쓸 수 있다). */
export const CARE_DATASET_KEYS: ReadonlySet<string> = new Set(["nhis.ltc_search", "nhis.ltc_detail", "kosis.stats"]);

/** 돌봄자원 MCP 도구. CARE_RESOURCES_MCP가 false이면 공개 MCP에 등록하지 않는다. */
export const CARE_TOOL_NAMES: ReadonlySet<string> = new Set(["get_care_demand", "find_care_institutions", "get_care_institution"]);
