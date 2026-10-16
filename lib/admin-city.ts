// 제주특별자치도는 기초자치단체가 없고 행정시(제주시·서귀포시)를 둔다. 보건복지부 원자료는 도 단위 메뉴판 하나로 실려 있어
// 사업을 행정시에 나누어 배분하지 않는다. 행정시를 고르면 행정시 전용 행과 도 공통 행을 함께 보이고 적용범위를 따로 표시한다.
export const JEJU_PROVINCE = "제주특별자치도";
export const JEJU_ADMIN_CITIES = ["제주시", "서귀포시"] as const;
export type AdminCityScope = "행정시 전용" | "도 공통" | "적용범위 미확인";

export function isAdminCity(sido: string, sigungu: string): boolean {
  return sido === JEJU_PROVINCE && (JEJU_ADMIN_CITIES as readonly string[]).includes(sigungu);
}

export function adminCitySigunguValues(sido: string, sigungu: string): readonly string[] {
  return isAdminCity(sido, sigungu) ? [sigungu, JEJU_PROVINCE] : [sigungu];
}

const CITY_MENTION = /제주시|서귀포/;

export function adminCityScope(row: { readonly sigungu: string; readonly name: string; readonly description: string; readonly provider: string }, city: string): AdminCityScope | null {
  if (row.sigungu === city) return "행정시 전용";
  if (row.sigungu !== JEJU_PROVINCE) return null;
  return CITY_MENTION.test(row.name + " " + row.description + " " + row.provider) ? "적용범위 미확인" : "도 공통";
}

export const ADMIN_CITY_SCOPE_NOTE =
  "보건복지부 원자료는 제주특별자치도 메뉴판 하나로 실려 있어 행정시별로 나누지 않았습니다. '도 공통'은 도 단위 메뉴판의 사업, '적용범위 미확인'은 설명에 특정 행정시가 언급되었으나 공식 적용범위를 확인하지 못한 사업입니다.";

