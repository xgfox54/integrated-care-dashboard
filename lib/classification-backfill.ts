import backfillSql from "../data/source-classification-backfill.sql?raw";
import { SOURCE_CLASSIFICATION_REVISION } from "./source-classifications";
import type { SqlDatabase } from "./sql-database";

const markerKey = "source-classification-applied:" + SOURCE_CLASSIFICATION_REVISION;
const leaseKey = "source-classification-lease:" + SOURCE_CLASSIFICATION_REVISION;
const statements = backfillSql.split("--> statement-breakpoint").map((sql) => sql.trim()).filter(Boolean);
const LEASE_SECONDS = 120;

type ApplyState = { readonly id: string; readonly applied_run: string | null };

function readApplyState(db: SqlDatabase): Promise<ApplyState | null> {
  return db.prepare(`SELECT id,
    (SELECT value FROM app_setting WHERE key = ?) AS applied_run
    FROM official_sync_run WHERE status = 'succeeded'
    ORDER BY completed_at DESC LIMIT 1`).bind(markerKey).first<ApplyState>();
}

export async function applyReviewedClassifications(db: SqlDatabase, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const state = await readApplyState(db);
  if (!state || state.applied_run === state.id) return false;
  const owner = crypto.randomUUID();
  const lease = await db.prepare(`INSERT INTO app_setting(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    WHERE app_setting.updated_at < ? RETURNING value`)
    .bind(leaseKey, owner, nowSeconds, nowSeconds - LEASE_SECONDS).first<{ readonly value: string }>();
  if (lease?.value !== owner) return false;
  const fresh = await readApplyState(db);
  if (!fresh || fresh.applied_run === fresh.id) {
    await db.prepare("DELETE FROM app_setting WHERE key = ? AND value = ?").bind(leaseKey, owner).run();
    return false;
  }
  await db.batch(statements.map((sql) => db.prepare(sql)));
  await db.prepare("DELETE FROM app_setting WHERE key = ? AND value = ?").bind(leaseKey, owner).run();
  return true;
}
