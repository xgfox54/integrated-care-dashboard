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
