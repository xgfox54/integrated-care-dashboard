// D1 오류를 메시지 원문 없이 종류로만 나눈다. 로그·재시도 판단에 쓰며 질문·SQL·바인딩 값은 남기지 않는다.
export type StoreErrorKind = "D1_OVERLOADED" | "D1_TIMEOUT" | "D1_NETWORK" | "D1_RESET" | "D1_LOCKED" | "D1_OTHER";

const RULES: readonly (readonly [StoreErrorKind, RegExp])[] = [
  ["D1_OVERLOADED", /overloaded|too many requests|queued for too long/i],
  ["D1_TIMEOUT", /timed? ?out|exceeded timeout|deadline/i],
  ["D1_NETWORK", /network connection lost|internal error in D1|connection (?:reset|closed)/i],
  ["D1_RESET", /reset because its code was updated|object .* reset|durable object/i],
  ["D1_LOCKED", /SQLITE_BUSY|database is locked/i],
];

export function storeErrorKind(error: unknown): StoreErrorKind | null {
  if (!(error instanceof Error)) return null;
  const text = error.message + " " + String((error as { cause?: unknown }).cause ?? "");
  const kind = RULES.find(([, pattern]) => pattern.test(text))?.[0];
  if (kind) return kind;
  return /\bD1_/.test(text) ? "D1_OTHER" : null;
}

/** 다시 시도하면 풀릴 수 있는 저장소 오류. 문법·제약 위반 같은 D1_OTHER는 포함하지 않는다. */
export function isTransientStoreError(error: unknown): boolean {
  const kind = storeErrorKind(error);
  return kind !== null && kind !== "D1_OTHER";
}

