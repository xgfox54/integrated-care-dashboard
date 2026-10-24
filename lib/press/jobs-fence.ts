import type { SqlDatabase, SqlStatement } from "../sql-database.ts";

export interface PressLease {
  readonly sourceId: string;
  readonly host: string;
  readonly token: string;
  readonly now: () => number;
}

export class PressLeaseLostError extends Error {
  constructor() { super("Press collection lease expired or was replaced"); this.name = "PressLeaseLostError"; }
}

/** Every mutation shares a transaction with its SQL lease predicate, including auxiliary title/audit writes. */
export function fencePressWrites(db: SqlDatabase, lease: PressLease): SqlDatabase {
  const underlying = new WeakMap<SqlStatement, SqlStatement>();
  const guardedBatch = async (statements: SqlStatement[]): Promise<unknown[]> => {
    const now = lease.now();
    const guard = db.prepare(
      "INSERT OR REPLACE INTO press_write_fence (id, valid) SELECT 1, EXISTS (" +
      "SELECT 1 FROM press_crawl_state c JOIN press_host_lease h ON h.host = ? " +
      "WHERE c.source_id = ? AND c.lease_token = ? AND h.lease_token = ? AND c.lease_expires_at > ? AND h.lease_expires_at > ?)",
    ).bind(lease.host, lease.sourceId, lease.token, lease.token, now, now);
    try {
      return (await db.batch([guard, ...statements.map((statement) => underlying.get(statement) ?? statement)])).slice(1);
    } catch (error) {
      if (error instanceof Error && /press_lease_fence_live/.test(error.message)) throw new PressLeaseLostError();
      throw error;
    }
  };
  const wrap = (statement: SqlStatement, readOnly: boolean): SqlStatement => {
    const wrapped: SqlStatement = {
      bind: (...values) => wrap(statement.bind(...values), readOnly),
      first: <T>() => {
        if (!readOnly) throw new TypeError('Fenced mutations must use run() or batch()');
        return statement.first<T>();
      },
      all: <T>() => {
        if (!readOnly) throw new TypeError('Fenced mutations must use run() or batch()');
        return statement.all<T>();
      },
      run: async () => (await guardedBatch([statement]))[0],
    };
    underlying.set(wrapped, statement);
    return wrapped;
  };
  return { prepare: (sql) => wrap(db.prepare(sql), /^\s*SELECT\b/i.test(sql)), batch: guardedBatch };
}
