import { REGION_DEFINITIONS } from "../region-statistics.ts";

const PROVINCE_NAMES: ReadonlySet<string> = new Set(REGION_DEFINITIONS.map((region) => region.fullName));
const PROVINCE_NAMES_SQL = [...PROVINCE_NAMES].map((name) => "'" + name.replaceAll("'", "''") + "'").join(", ");

/**
 * 보건복지부 제주·세종 광역 메뉴판은 원본 식별 필드에 시·도 이름을 시·군·구에도 적는다.
 * 이 중복은 광역 범위로 읽되 원자료와 serviceWikiKey는 바꾸지 않는다. 시·군·구 이름이나
 * 다른 시·도 이름은 추측해서 바꾸지 않는다(통합 이전 지역을 전체 통합지역으로 확장하지 않음).
 */
export function canonicalProgramRegion(sido: string, sigungu: string): { sido: string; sigungu: string } {
  return { sido, sigungu: PROVINCE_NAMES.has(sido) && sigungu === sido ? "" : sigungu };
}

/** 화면·도구 응답용 지역 표기. 광역 사업의 "제주특별자치도 제주특별자치도" 같은 중복을 한 번만 적는다. */
export function regionLabel(sido: string | null | undefined, sigungu: string | null | undefined): string {
  const province = sido ?? "";
  const municipality = sigungu && sigungu !== province ? sigungu : "";
  return [province, municipality].filter(Boolean).join(" ");
}

/** SQL의 검색·집계가 공개 지역 DTO와 같은 규칙을 쓰게 한다. 인수는 코드 내 SQL 식만 허용한다. */
export function canonicalMunicipalitySql(sidoExpression: string, sigunguExpression: string): string {
  return `CASE WHEN ${sigunguExpression} = (${sidoExpression}) AND (${sidoExpression}) IN (${PROVINCE_NAMES_SQL}) THEN '' ELSE ${sigunguExpression} END`;
}
