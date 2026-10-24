import type { StatisticsDataset, StatisticsPoint, StatisticsSeries } from "./types.ts";

export interface ComparisonRegion {
  readonly name: string;
  readonly series: StatisticsSeries;
}
export interface StatisticsComparisonGroup {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly source_url: string;
  readonly regions: readonly ComparisonRegion[];
}

const SIDO_NAMES = new Set([
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
  "서울특별시", "부산광역시", "대구광역시", "인천광역시", "광주광역시", "대전광역시", "울산광역시", "세종특별자치시", "경기도", "강원특별자치도", "충청북도", "충청남도", "전북특별자치도", "전라남도", "경상북도", "경상남도", "제주특별자치도",
]);
const HEALTH_RESPONSES = new Set(["전혀 좋지 않다", "좋지 않다", "보통이다", "좋다", "매우 좋다", "평균(5점 만점)"]);
type Dimension = { readonly name: string; readonly measure: string };

function kosisDimension(id: string, label: string): Dimension | null {
  const parts = label.split(" / ");
  switch (id) {
    case "kosis:basic-livelihood":
      return parts.length === 2 && (parts[0] === "전국" || SIDO_NAMES.has(parts[0])) && ["계", "일반수급자", "시설수급자"].includes(parts[1])
        ? { name: parts[0], measure: parts[1] } : null;
    case "kosis:disability-health":
      if (label === "전체 / 계 / 수검률") return { name: "전국", measure: "계 / 수검률" };
      return parts.length === 4 && parts[0] === "거주지역별" && SIDO_NAMES.has(parts[1]) && parts[2] === "계" && parts[3] === "수검률"
        ? { name: parts[1], measure: "계 / 수검률" } : null;
    case "kosis:near-poor-families":
      if (parts.length === 2 && parts[0] === "계" && /^(?:[1-9]|1[0-2])월$/.test(parts[1])) return { name: "전국", measure: parts[1] };
      return parts.length === 3 && parts[0] === "3) 시도별" && SIDO_NAMES.has(parts[1]) && /^(?:[1-9]|1[0-2])월$/.test(parts[2])
        ? { name: parts[1], measure: parts[2] } : null;
    case "kosis:disability-sports":
      if (parts.length === 2 && parts[0] === "전체" && HEALTH_RESPONSES.has(parts[1])) return { name: "전국", measure: parts[1] };
      return parts.length === 3 && parts[0] === "거주 지역별" && SIDO_NAMES.has(parts[1]) && HEALTH_RESPONSES.has(parts[2])
        ? { name: parts[1], measure: parts[2] } : null;
    default:
      return null;
  }
}

export function statisticsComparisonGroups(dataset: StatisticsDataset): readonly StatisticsComparisonGroup[] {
  const groups = new Map<string, { label: string; unit: string; source_url: string; regions: ComparisonRegion[] }>();
  for (const series of dataset.series) {
    const source = series.source_url ?? dataset.source_url;
    const table = dataset.kosis?.tables.find(table => table.url === source);
    if (dataset.kosis && (!table || table.national_only)) continue;
    const dimension = dataset.population && series.region && series.region.level !== "sigungu"
      ? { name: series.region.name, measure: dataset.population.age_label }
      : dataset.kosis ? kosisDimension(dataset.id, series.label) : null;
    if (!dimension) continue;
    const key = JSON.stringify([source, series.unit, dimension.measure]);
    const group = groups.get(key) ?? { label: dimension.measure, unit: series.unit, source_url: source, regions: [] };
    group.regions.push({ name: dimension.name, series });
    groups.set(key, group);
  }
  return [...groups].flatMap(([id, group]) => group.regions.length > 1 && new Set(group.regions.map(row => row.name)).size === group.regions.length
    ? [{ id, ...group }] : []);
}

export function defaultComparisonRegions(group: StatisticsComparisonGroup): readonly string[] {
  const regions = group.regions.filter(row => row.name !== "전국" && row.series.region?.level !== "national");
  const jeju = regions.find(row => row.name === "제주" || row.name === "제주특별자치도");
  return [...(jeju ? [jeju.series.id] : []), ...regions.filter(row => row !== jeju).map(row => row.series.id)].slice(0, 2);
}

export function comparisonPeriods(group: StatisticsComparisonGroup, from = "", to = ""): readonly string[] {
  if (from && to && from > to) return [];
  const periods = [...new Set(group.regions.flatMap(row => row.series.points.map(point => point.period)))].sort();
  const first = periods[0], last = periods.at(-1);
  const complete = first && last && periods.every(period => /^(19|20)\d{2}$/.test(period))
    ? Array.from({ length: Number(last) - Number(first) + 1 }, (_, i) => String(Number(first) + i)) : periods;
  return complete.filter(period => (!from || period >= from) && (!to || period <= to));
}

export function comparisonPoint(series: StatisticsSeries, period: string): StatisticsPoint {
  const point = series.points.find(point => point.period === period);
  if (!point) return { period, value: null, raw: "", status: "MISSING" };
  return { ...point, value: point.status === "MISSING" || point.status === "CONFIDENTIAL" || point.value === null || !Number.isFinite(point.value) ? null : point.value };
}
