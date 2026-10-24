import type { StatisticsCatalogItem } from "./types.ts";

export type StatisticsProvider = "" | "kosis" | "index" | "population";
export interface StatisticsComparisonChoice {
  readonly dataset: string;
  readonly group: string;
  readonly regions: readonly string[] | null;
  readonly from: string;
  readonly to: string;
}
export interface StatisticsViewState {
  readonly provider: StatisticsProvider;
  readonly regional: boolean;
  readonly series: string;
  readonly from: string;
  readonly to: string;
  readonly comparison: StatisticsComparisonChoice | null;
}
export interface StatisticsFilterGroup {
  readonly item: StatisticsCatalogItem;
  readonly sources: readonly StatisticsCatalogItem[];
  readonly comparison_available?: boolean;
}

function identifier(value: string | null): string { return value && /^[\w:.-]{1,120}$/.test(value) ? value : ""; }
function period(value: string | null): string { return value && /^(19|20)\d{2}(?:-(?:0[1-9]|1[0-2]))?$/.test(value) ? value : ""; }
function normalized(value: string): string { return value.normalize("NFKC").toLowerCase().replace(/\s/g, ""); }
export function statisticsProvider(value: string | null): StatisticsProvider { return value === "kosis" || value === "index" || value === "population" ? value : ""; }

export function readStatisticsView(params: URLSearchParams): StatisticsViewState {
  const dataset = identifier(params.get("compare_dataset"));
  return {
    provider: statisticsProvider(params.get("provider")), regional: params.get("regional") === "1",
    series: identifier(params.get("series")), from: period(params.get("from")), to: period(params.get("to")),
    comparison: dataset ? {
      dataset, group: identifier(params.get("compare")),
      regions: params.has("compare_regions") ? [...new Set((params.get("compare_regions") ?? "").slice(0, 500).split(",").map(identifier).filter(Boolean))].slice(0, 4) : null,
      from: period(params.get("compare_from")), to: period(params.get("compare_to")),
    } : null,
  };
}

export function writeStatisticsView(params: URLSearchParams, state: StatisticsViewState): void {
  const values = [
    ["provider", state.provider], ["regional", state.regional ? "1" : ""], ["series", state.series], ["from", state.from], ["to", state.to],
    ["compare_dataset", state.comparison?.dataset ?? ""], ["compare", state.comparison?.group ?? ""],
    ["compare_from", state.comparison?.from ?? ""], ["compare_to", state.comparison?.to ?? ""],
  ];
  for (const [key, value] of values) if (value) params.set(key, value); else params.delete(key);
  if (state.comparison?.regions !== null && state.comparison?.regions !== undefined) params.set("compare_regions", state.comparison.regions.join(","));
  else params.delete("compare_regions");
}

export function filterStatisticsGroups<T extends StatisticsFilterGroup>(groups: readonly T[], query: string, category: string, provider: StatisticsProvider = "", regional = false): T[] {
  const words = query.trim().split(/\s+/).map(normalized).filter(Boolean);
  return groups.filter(group => (!category || group.item.category === category)
    && (!regional || group.comparison_available === true)
    && (!provider || group.sources.some(row => provider === "kosis" ? row.dataset_id?.startsWith("kosis:") || row.kind === "kosis" || row.data_provider === "kosis" : provider === "index" ? row.data_provider === "index" : row.kind === "population"))
    && words.every(word => normalized(group.sources.map(row => [row.title, row.description, row.category,
      row.data_provider === "index" ? "지표누리 API e-나라지표" : row.dataset_id?.startsWith("kosis:") || row.kind === "kosis" || row.data_provider === "kosis" ? "KOSIS 국가통계포털" : row.kind === "population" ? "공식 인구통계" : ""].join(" ")).join(" ")).includes(word)));
}
