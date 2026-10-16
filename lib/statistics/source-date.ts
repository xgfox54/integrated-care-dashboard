import type { StatisticsDataset } from "./types.ts";

export interface StatisticsSourceDate { readonly kind: "updated" | "published" | "reference"; readonly label: string; readonly date: string }

const INDEX_UPDATED_AT: Readonly<Record<string, string>> = {
  "stat:2760": "2026-07-31", "stat:1406": "2025-09-17", "stat:3053": "2026-01-07", "stat:2709": "2026-04-06",
  "stat:2766": "2026-06-25", "stat:1431": "2026-08-31", "stat:2767": "2026-05-18",
};
const REFERENCE_DATES: Readonly<Record<string, string>> = { "city:seogwipo-population": "2026-09-30" };
const LABELS = { updated: "원자료 갱신", published: "원자료 공표", reference: "자료 기준일" } as const;

function isoDate(value: string | null | undefined): string | null {
  const match = value?.trim().match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}
function entry(kind: StatisticsSourceDate["kind"], date: string | null): StatisticsSourceDate | null {
  return date ? { kind, label: LABELS[kind], date } : null;
}

export function statisticsSourceDate(dataset: StatisticsDataset): StatisticsSourceDate | null {
  if (dataset.index_api) return entry("updated", isoDate(dataset.index_api.updated_at));
  if (Object.hasOwn(INDEX_UPDATED_AT, dataset.id)) return entry("updated", INDEX_UPDATED_AT[dataset.id]);
  if (dataset.kosis) return entry("updated", dataset.kosis.tables.map(table => isoDate(table.updated_at)).filter(value => value !== null).sort().at(-1) ?? null);
  if (dataset.official_report?.published_at) return entry("published", isoDate(dataset.official_report.published_at));
  if (dataset.population) return entry("reference", isoDate(dataset.population.reference_date));
  return Object.hasOwn(REFERENCE_DATES, dataset.id) ? entry("reference", REFERENCE_DATES[dataset.id]) : null;
}
