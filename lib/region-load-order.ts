export interface RegionTarget {
  readonly sido: string;
  readonly sigungu: string;
}

export type BundleScope = "sido" | "sigungu";

/** 미리받기 한 번에 받는 지역 묶음. */
export interface RegionBundle {
  readonly scope: BundleScope;
  /** 시·군·구 묶음의 순번(0부터). 광역 묶음은 0. */
  readonly part: number;
  /** 시·군·구 묶음 하나에 담는 지역 수. */
  readonly per: number;
  readonly targets: readonly RegionTarget[];
}

const byKoreanName = (left: string, right: string) => left.localeCompare(right, "ko");

/** 광역시·도 목록(가나다). */
export function provinceTargets(sigunguBySido: Readonly<Record<string, readonly string[]>>): RegionTarget[] {
  return Object.keys(sigunguBySido)
    .sort(byKoreanName)
    .map((sido) => ({ sido, sigungu: "" }));
}

/** 기초 시·군·구 목록(가나다, 같은 이름은 광역시·도 이름 순). */
export function districtTargets(sigunguBySido: Readonly<Record<string, readonly string[]>>): RegionTarget[] {
  return Object.keys(sigunguBySido)
    .sort(byKoreanName)
    .flatMap((sido) =>
      (sigunguBySido[sido] ?? [])
        .filter((sigungu) => sigungu && sigungu !== sido)
        .map((sigungu) => ({ sido, sigungu })),
    )
    .sort((left, right) => byKoreanName(left.sigungu, right.sigungu) || byKoreanName(left.sido, right.sido));
}

/**
 * Background loading order for the dashboard: the visitor's 광역시·도 first,
 * then the remaining 광역시·도 in 가나다 order, then every 기초 시·군·구 in
 * 가나다 order (ties broken by 광역시·도 name).
 */
export function buildRegionLoadOrder(
  sigunguBySido: Readonly<Record<string, readonly string[]>>,
  preferredSido: string | null,
): RegionTarget[] {
  const provinces = provinceTargets(sigunguBySido);
  const first = provinces.filter((target) => target.sido === preferredSido);
  return [...first, ...provinces.filter((target) => target.sido !== preferredSido), ...districtTargets(sigunguBySido)];
}

/** 쪽 크기가 클수록 한 묶음에 담는 시·군·구 수를 줄여 응답 크기를 비슷하게 맞춘다. */
export function bundlePerPart(pageSize: number): number {
  if (pageSize <= 30) return 20;
  if (pageSize <= 50) return 12;
  return 6;
}

export const MAX_BUNDLE_PER = 20;

/** 시·군·구 묶음 하나에 들어가는 지역(가나다 순서의 part번째 조각). */
export function sigunguBundleTargets(
  sigunguBySido: Readonly<Record<string, readonly string[]>>,
  part: number,
  per: number,
): RegionTarget[] {
  const size = Math.min(Math.max(1, per), MAX_BUNDLE_PER);
  return districtTargets(sigunguBySido).slice(part * size, part * size + size);
}

/**
 * 미리받기 계획. 접속 지역 광역시·도 한 곳을 먼저 받고, 이어서 광역시·도 전체를 한 번에,
 * 그다음 시·군·구를 가나다 순서대로 묶음 단위로 받는다. 순서는 buildRegionLoadOrder와 같다.
 */
export function planRegionBundles(
  sigunguBySido: Readonly<Record<string, readonly string[]>>,
  preferredSido: string | null,
  pageSize: number,
): { readonly preferred: RegionTarget | null; readonly bundles: RegionBundle[] } {
  const provinces = provinceTargets(sigunguBySido);
  const preferred = provinces.find((target) => target.sido === preferredSido) ?? null;
  const per = bundlePerPart(pageSize);
  const districts = districtTargets(sigunguBySido);
  const bundles: RegionBundle[] = provinces.length > 0 ? [{ scope: "sido", part: 0, per, targets: provinces }] : [];
  for (let part = 0; part * per < districts.length; part += 1) {
    bundles.push({ scope: "sigungu", part, per, targets: districts.slice(part * per, part * per + per) });
  }
  return { preferred, bundles };
}

/** 지역 묶음 API 주소의 질의 문자열(화면과 서버가 함께 쓴다). */
export function bundleQueryString(
  bundle: Pick<RegionBundle, "scope" | "part" | "per">,
  pageSize: number,
  category: string,
): string {
  const params = new URLSearchParams({ scope: bundle.scope });
  if (bundle.scope === "sigungu") {
    params.set("part", String(bundle.part));
    params.set("per", String(bundle.per));
  }
  params.set("size", String(pageSize));
  if (category) params.set("category", category);
  return params.toString();
}
