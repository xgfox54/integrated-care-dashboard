import { KOSIS_SNAPSHOT } from "./kosis-data.ts";
import type { KosisMetadata, StatisticsDataset, StatisticsPoint, ValueStatus } from "./types.ts";

export interface KosisCompactSeries { readonly id: string; readonly label: string; readonly unit: string; readonly table: number; readonly points: readonly (readonly [string, string, ValueStatus])[] }
export interface KosisCompactDataset extends Omit<StatisticsDataset, "series" | "kosis"> { readonly kosis: KosisMetadata; readonly series: readonly KosisCompactSeries[] }
export interface KosisSnapshot { readonly checked_at: string; readonly datasets: readonly KosisCompactDataset[] }

function point([period, raw, status]: readonly [string, string, ValueStatus]): StatisticsPoint {
  return { period, raw, status, value: status === "MISSING" || status === "CONFIDENTIAL" ? null : Number(raw.replace(/[^\d.-]/g, "")) };
}

/** Public KOSIS table values observed on the KOSIS web viewer; see scripts/statistics/build-kosis-snapshot.mjs. */
export const KOSIS_CHECKED_AT = KOSIS_SNAPSHOT.checked_at;
export const KOSIS_DATASETS: readonly StatisticsDataset[] = KOSIS_SNAPSHOT.datasets.map(dataset => ({
  ...dataset,
  series: dataset.series.map(({ table, points, ...series }) => ({ ...series, source_label: dataset.kosis.tables[table]?.title ?? dataset.table_title, points: points.map(point) })),
}));
