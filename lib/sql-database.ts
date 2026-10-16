// D1과 테스트용 SQLite가 함께 따르는 최소 인터페이스. 수집 단계 모듈은 이 인터페이스만 쓴다.
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ readonly results: T[] }>;
  run(): Promise<unknown>;
}

export interface SqlDatabase {
  prepare(query: string): SqlStatement;
  batch(statements: SqlStatement[]): Promise<unknown[]>;
}

/** 계측용 래퍼가 원래 데이터베이스 객체를 알려 줄 때 쓰는 키. 실행 환경 캐시는 이 원본을 기준으로 한다. */
export const UNDERLYING_DATABASE: unique symbol = Symbol.for("welfare.underlyingDatabase");

export function databaseIdentity(db: object): object {
  return ((db as Record<symbol, unknown>)[UNDERLYING_DATABASE] as object | undefined) ?? db;
}
