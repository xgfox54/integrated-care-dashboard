import type { SqlDatabase } from "./sql-database.ts";

/** A committed timestamp coordinates visit starts across Worker instances. */
export async function claimVisitBackground(db: SqlDatabase, nowSeconds: number): Promise<boolean> {
  const claimed = await db.prepare(
    "INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at " +
    "WHERE app_setting.updated_at <= ? RETURNING key",
  ).bind("visit-background-last-start-v1", "1", nowSeconds, nowSeconds - 60).first<{ key: string }>();
  return claimed !== null;
}
