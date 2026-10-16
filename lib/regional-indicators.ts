import { SIGUNGU_ELDERLY_SNAPSHOT } from "./statistics/sigungu-elderly-verified.ts";
import { JEJU_PROVINCE, adminCityScope, isAdminCity, type AdminCityScope } from "./admin-city.ts";
import { displayBusinessType } from "./business-type.ts";

export interface IndicatorRow {
  readonly sido: string; readonly sigungu: string; readonly name: string; readonly description: string;
  readonly provider: string; readonly category: string; readonly type: string;
}

export interface ElderlyFigure { readonly value: number; readonly total: number; readonly code: string; readonly period: string; readonly level: "sido" | "sigungu" }

export function elderlyFor(sido: string, sigungu: string): ElderlyFigure | null {
  const records = SIGUNGU_ELDERLY_SNAPSHOT.records;
  const province = sido === "광주광역시" || sido === "전라남도" ? "전남광주통합특별시" : sido;
  const exact = records.find((record) => record.sido === province && record.sigungu === sigungu && record.level === "sigungu");
  const fallback = !exact && sigungu === province ? records.find((record) => record.sido === province && record.level === "sido") : undefined;
  const match = exact ?? fallback;
  return match ? { value: match.elderly, total: match.total, code: match.code, period: SIGUNGU_ELDERLY_SNAPSHOT.period, level: match.level } : null;
}

export function perThousand(count: number | null, elderly: number | null): number | null {
  if (count === null || !elderly) return null;
  return Math.round((count / elderly) * 1000 * 100) / 100;
}

export function institutionsForCode(code: string, counts: Readonly<Record<string, number>>): number {
  let sum = 0;
  for (const [key, value] of Object.entries(counts)) {
    const sameDistrict = key.slice(0, 5) === code.slice(0, 5);
    const generalDistrict = code[4] === "0" && key.slice(0, 4) === code.slice(0, 4) && key[4] !== "0";
    if (sameDistrict || generalDistrict) sum += value;
  }
  return sum;
}

export interface RegionProfile {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly IndicatorRow[];
  readonly scopeCounts: Readonly<Record<AdminCityScope, number>> | null;
  readonly typeCounts: readonly (readonly [string, number])[];
  readonly categoryShares: readonly (readonly [string, number, number])[];
  readonly elderly: ElderlyFigure | null;
}

export function regionRows<T extends IndicatorRow>(rows: readonly T[], key: string): T[] {
  const [sido, sigungu] = key.split("|");
  if (isAdminCity(sido, sigungu)) return rows.filter((row) => row.sido === JEJU_PROVINCE && (row.sigungu === sigungu || row.sigungu === JEJU_PROVINCE));
  return rows.filter((row) => row.sido === sido && row.sigungu === sigungu);
}

export function buildRegionProfile(rows: readonly IndicatorRow[], key: string): RegionProfile {
  const [sido, sigungu] = key.split("|");
  const selected = regionRows(rows, key);
  const scopeCounts = isAdminCity(sido, sigungu)
    ? selected.reduce<Record<AdminCityScope, number>>((counts, row) => {
        const scope = adminCityScope(row, sigungu);
        if (scope) counts[scope] += 1;
        return counts;
      }, { "행정시 전용": 0, "도 공통": 0, "적용범위 미확인": 0 })
    : null;
  const tally = (pick: (row: IndicatorRow) => string) => {
    const map = new Map<string, number>();
    for (const row of selected) map.set(pick(row), (map.get(pick(row)) ?? 0) + 1);
    return [...map.entries()].sort((left, right) => right[1] - left[1]);
  };
  const total = selected.length;
  return {
    key,
    label: sido === sigungu ? sido : sido + " " + sigungu,
    rows: selected,
    scopeCounts,
    typeCounts: tally((row) => displayBusinessType(row.type)),
    categoryShares: tally((row) => row.category || "미분류").map(([label, count]) => [label, count, total ? Math.round((count / total) * 1000) / 10 : 0] as const),
    elderly: elderlyFor(sido, sigungu),
  };
}

export const INDICATOR_DEFINITIONS = [
  { id: "elderly", label: "65세 이상 인구", formula: "행정안전부 주민등록인구 지역별 고령 인구현황의 65세 이상 값" },
  { id: "services_per_1000", label: "고령인구 1천 명당 통합돌봄 사업 수", formula: "해당 지역 사업 수 ÷ 65세 이상 인구 × 1,000" },
  { id: "institutions_per_1000", label: "고령인구 1천 명당 장기요양기관 수", formula: "장기요양기관 수(기관기호 기준, 중복 제외) ÷ 65세 이상 인구 × 1,000" },
  { id: "workforce_per_1000", label: "고령인구 1천 명당 서비스 제공인력 수", formula: "공식 제공인력 통계가 연결되지 않아 산출하지 않습니다(0으로 표시하지 않음)" },
  { id: "category_share", label: "지역별 사업 구성비", formula: "해당 분야 사업 수 ÷ 지역 전체 사업 수 × 100" },
] as const;

