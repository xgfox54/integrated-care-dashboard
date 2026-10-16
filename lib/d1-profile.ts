// /mcp 요청의 D1 문장별 비용을 모은다. D1은 한 데이터베이스의 쿼리를 차례로 처리하므로
// 병렬 대기 시간이 섞인 wall 시간 대신 D1이 보고하는 실제 실행 시간(meta.duration)과 읽은 행 수를 함께 기록한다.
// SQL 원문은 앞부분만 남기며 바인딩 값(사용자 질문)은 기록하지 않는다.

import { UNDERLYING_DATABASE } from "./sql-database.ts";

export interface StatementProfile {
  readonly sql: string;
  calls: number;
  wall_ms: number;
  d1_ms: number;
  rows_read: number;
}

export interface DatabaseProfile {
  readonly statements: number;
  readonly wall_ms: number;
  readonly d1_ms: number;
  readonly rows_read: number;
  readonly top: StatementProfile[];
}

interface Meta { duration?: number; rows_read?: number }
type Statement = { bind(...values: unknown[]): Statement; all(): Promise<{ results: unknown[]; meta?: Meta }>; first(): Promise<unknown>; run(): Promise<{ meta?: Meta }> };

export function sqlFingerprint(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().slice(0, 120);
}

export function profileDatabase<T extends { prepare(sql: string): unknown; batch?(statements: unknown[]): Promise<unknown[]> }>(db: T): { db: T; report(limit?: number): DatabaseProfile } {
  const stats = new Map<string, StatementProfile>();
  const real = new WeakMap<object, unknown>();
  const record = (sql: string, started: number, meta?: Meta) => {
    const key = sqlFingerprint(sql);
    const entry = stats.get(key) ?? { sql: key, calls: 0, wall_ms: 0, d1_ms: 0, rows_read: 0 };
    entry.calls += 1;
    entry.wall_ms += Date.now() - started;
    entry.d1_ms += Number(meta?.duration ?? 0);
    entry.rows_read += Number(meta?.rows_read ?? 0);
    stats.set(key, entry);
  };
  const wrap = (statement: Statement, sql: string): Statement => {
    const wrapped: Statement = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values), sql),
      all: async () => { const started = Date.now(); const result = await statement.all(); record(sql, started, result?.meta); return result; },
      // first()는 meta를 주지 않으므로 all()로 실행해 첫 행만 돌려준다(D1의 first도 전체 쿼리를 실행한다).
      first: async () => { const started = Date.now(); const result = await statement.all(); record(sql, started, result?.meta); return result?.results?.[0] ?? null; },
      run: async () => { const started = Date.now(); const result = await statement.run(); record(sql, started, result?.meta); return result; },
    };
    real.set(wrapped, statement);
    return wrapped;
  };
  const proxy = new Proxy(db, {
    get(target, property, receiver) {
      if (property === UNDERLYING_DATABASE) return target;
      if (property === "prepare") return (sql: string) => wrap(target.prepare(sql) as Statement, sql);
      if (property === "batch" && target.batch) {
        return async (statements: unknown[]) => {
          const started = Date.now();
          // D1 batch는 원래 문장 객체만 받는다.
          const results = await target.batch!(statements.map((statement) => real.get(statement as object) ?? statement));
          record("BATCH x" + statements.length, started, { duration: (results as { meta?: Meta }[]).reduce((sum, item) => sum + Number(item?.meta?.duration ?? 0), 0) });
          return results;
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
  return {
    db: proxy,
    report(limit = 6) {
      const all = [...stats.values()];
      const sum = (key: "wall_ms" | "d1_ms" | "rows_read") => all.reduce((total, item) => total + item[key], 0);
      return {
        statements: all.reduce((total, item) => total + item.calls, 0), wall_ms: sum("wall_ms"), d1_ms: Math.round(sum("d1_ms")), rows_read: sum("rows_read"),
        top: all.sort((a, b) => b.d1_ms - a.d1_ms || b.wall_ms - a.wall_ms).slice(0, limit).map((item) => ({ ...item, d1_ms: Math.round(item.d1_ms) })),
      };
    },
  };
}

