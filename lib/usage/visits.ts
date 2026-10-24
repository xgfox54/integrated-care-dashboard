import type { SqlDatabase } from "../sql-database.ts";
import { TAB_CODES, shiftDay } from "./codes.ts";
import type { ReportMeta, VisitsReport } from "./report-types.ts";

export async function readVisitSummary(db: SqlDatabase) {
  const row = await db.prepare("SELECT COALESCE(SUM(initial_views), 0) AS visits, MIN(day) AS since FROM usage_daily_tab WHERE initial_views > 0")
    .first<{ visits: number; since: string | null }>();
  return { visits: Number(row?.visits ?? 0), since: row?.since ?? null };
}

export async function buildVisitsReport(db: SqlDatabase, meta: ReportMeta): Promise<VisitsReport> {
  const [summary, totals, daily, entries] = await Promise.all([
    readVisitSummary(db),
    db.prepare("SELECT COALESCE(SUM(CASE WHEN day < ?1 THEN initial_views ELSE 0 END), 0) AS before, COALESCE(SUM(CASE WHEN day BETWEEN ?2 AND ?3 THEN initial_views ELSE 0 END), 0) AS previous FROM usage_daily_tab")
      .bind(meta.from, meta.prevFrom, meta.prevTo).first<{ before: number; previous: number }>(),
    db.prepare("SELECT day, SUM(initial_views) AS visits FROM usage_daily_tab WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day")
      .bind(meta.from, meta.to).all<{ day: string; visits: number }>(),
    db.prepare("SELECT tab, SUM(initial_views) AS visits FROM usage_daily_tab WHERE day BETWEEN ? AND ? GROUP BY tab HAVING SUM(initial_views) > 0 ORDER BY visits DESC")
      .bind(meta.from, meta.to).all<{ tab: string; visits: number }>(),
  ]);
  const byDay = new Map(daily.results.map(row => [row.day, Number(row.visits)]));
  let cumulative = Number(totals?.before ?? 0);
  const series: { day: string; visits: number; cumulative: number }[] = [];
  for (let day = meta.from; day <= meta.to; day = shiftDay(day, 1)) {
    const visits = byDay.get(day) ?? 0;
    cumulative += visits;
    series.push({ day, visits, cumulative });
  }
  return {
    view: "visits", meta, total: summary.visits, since: summary.since,
    current: series.reduce((sum, row) => sum + row.visits, 0), previous: Number(totals?.previous ?? 0),
    before: Number(totals?.before ?? 0), throughEnd: cumulative, series,
    entries: entries.results.flatMap(row => {
      const tab = TAB_CODES.find(code => code === row.tab);
      return tab ? [{ tab, visits: Number(row.visits) }] : [];
    }),
  };
}
