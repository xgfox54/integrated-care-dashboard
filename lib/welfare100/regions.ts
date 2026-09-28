import type { CatalogEntry } from "./payload";

export type RegionCount = readonly [name: string, count: number];

export interface CatalogRegions {
  /** 지자체 서비스가 있는 광역시·도(가나다순)와 그 제도 수 */
  readonly sidos: readonly RegionCount[];
  /** 그 광역시·도의 기초시·군·구(가나다순)와 제도 수 */
  sigungus(sido: string): readonly RegionCount[];
}

/** 복지제도 대장의 지역 선택지. 목록 화면 필터와 상세 화면 통합검색이 같은 목록을 쓴다. */
export function catalogRegions(entries: readonly Pick<CatalogEntry, "org" | "sido" | "sigungu">[]): CatalogRegions {
  const sidoCounts = new Map<string, number>();
  const sigunguBySido = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    if (entry.org !== "지자체" || !entry.sido) continue;
    sidoCounts.set(entry.sido, (sidoCounts.get(entry.sido) ?? 0) + 1);
    if (entry.sigungu) {
      const map = sigunguBySido.get(entry.sido) ?? new Map<string, number>();
      map.set(entry.sigungu, (map.get(entry.sigungu) ?? 0) + 1);
      sigunguBySido.set(entry.sido, map);
    }
  }
  const byName = (a: RegionCount, b: RegionCount) => a[0].localeCompare(b[0], "ko");
  return {
    sidos: [...sidoCounts].sort(byName),
    sigungus: (sido: string) => [...(sigunguBySido.get(sido) ?? new Map<string, number>())].sort(byName),
  };
}
