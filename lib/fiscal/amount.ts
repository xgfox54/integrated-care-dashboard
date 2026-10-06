// 재정 금액 계약: 원 단위 정수만 10진 문자열로 다루고(BigInt 계산), 소수·결측을 추정해 채우지 않는다.
// 비율은 마지막에 한 번만 반올림하며, 분모가 0이거나 미확인이면 null과 사유를 돌려준다.

export type AmountProblem = "MISSING" | "NON_INTEGER" | "UNSAFE_NUMBER" | "NOT_NUMERIC";

export interface NormalizedAmount {
  /** 원 단위 정수의 10진 문자열. 정규화할 수 없으면 null. */
  readonly value: string | null;
  readonly precision: "integer_krw" | "unknown";
  readonly problem?: AmountProblem;
}

export const NORMALIZATION_RULE_ID = "krw-integer-v1";
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);
const HUNDRED = BigInt(100);

export function normalizeWon(raw: unknown): NormalizedAmount {
  if (raw === null || raw === undefined || raw === "") return { value: null, precision: "unknown", problem: "MISSING" };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { value: null, precision: "unknown", problem: "NOT_NUMERIC" };
    if (!Number.isInteger(raw)) return { value: null, precision: "unknown", problem: "NON_INTEGER" };
    if (!Number.isSafeInteger(raw)) return { value: null, precision: "unknown", problem: "UNSAFE_NUMBER" };
    return { value: String(raw), precision: "integer_krw" };
  }
  if (typeof raw === "string") {
    const text = raw.trim().replace(/,/g, "");
    if (/^-?\d+$/.test(text)) return { value: BigInt(text).toString(), precision: "integer_krw" };
    if (/^-?\d+\.\d+$/.test(text)) return { value: null, precision: "unknown", problem: "NON_INTEGER" };
    return { value: null, precision: "unknown", problem: "NOT_NUMERIC" };
  }
  return { value: null, precision: "unknown", problem: "NOT_NUMERIC" };
}

export function subtractWon(left: string | null, right: string | null): string | null {
  if (left === null || right === null) return null;
  return (BigInt(left) - BigInt(right)).toString();
}

/**
 * 재원 대조(작업지시서 v5 §22·T92): 원천의 국비·시도비·시군구비·기타 칸만 쓰고, 합계를 예산현액과 대조한다.
 * 칸이 하나라도 없거나 합계가 다르면 완전하지 않음으로 두고 차액을 어느 재원에도 배분하지 않는다. 「기타」는 더 나누지 않는다.
 */
export function reconcileFunding(budget: string | null, parts: { readonly national: string | null; readonly province: string | null; readonly municipal: string | null; readonly other: string | null }) {
  const values = [parts.national, parts.province, parts.municipal, parts.other];
  if (budget === null || values.some((value) => value === null)) {
    return { funding_sum_krw: null, unallocated_difference_krw: null, funding_breakdown_complete: false, reconciliation: "SOURCE_FIELD_MISSING" as const };
  }
  const sum = values.reduce((total, value) => total + BigInt(value as string), BigInt(0));
  const difference = BigInt(budget) - sum;
  return {
    funding_sum_krw: sum.toString(),
    unallocated_difference_krw: difference.toString(),
    funding_breakdown_complete: difference === BigInt(0),
    reconciliation: difference === BigInt(0) ? "SUM_MATCHES_CURRENT_BUDGET" as const : "SUM_DIFFERS_NOT_ALLOCATED" as const,
  };
}

export interface RateResult {
  readonly value: string | null;
  readonly reason?: "BUDGET_ZERO" | "BUDGET_UNKNOWN" | "EXPENDITURE_UNKNOWN";
}

/** 공개 지출액 ÷ 예산현액 × 100. 소수 둘째 자리에서 한 번만 반올림(0에서 먼 쪽). 0~100으로 자르지 않는다. */
export function executionRate(expenditure: string | null, budget: string | null, digits = 2): RateResult {
  if (budget === null) return { value: null, reason: "BUDGET_UNKNOWN" };
  if (expenditure === null) return { value: null, reason: "EXPENDITURE_UNKNOWN" };
  const denominator = BigInt(budget);
  if (denominator === ZERO) return { value: null, reason: "BUDGET_ZERO" };
  let scale = ONE;
  for (let index = 0; index < digits; index += 1) scale *= TEN;
  const numerator = BigInt(expenditure) * HUNDRED * scale * TWO;
  let doubled = numerator / denominator;
  if (doubled % TWO !== ZERO) doubled += doubled > ZERO ? ONE : -ONE;
  const scaled = doubled / TWO;
  const negative = scaled < ZERO;
  const absolute = negative ? -scaled : scaled;
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(digits, "0");
  return { value: (negative ? "-" : "") + whole.toString() + (digits ? "." + fraction : "") };
}

export interface AmountTotal {
  readonly total: string;
  readonly included: number;
  readonly excluded: number;
}

/** null(결측)은 0으로 채우지 않고 제외 건수로 센다. */
export function sumWon(values: readonly (string | null)[]): AmountTotal {
  let total = ZERO;
  let included = 0;
  for (const value of values) {
    if (value === null) continue;
    total += BigInt(value);
    included += 1;
  }
  return { total: total.toString(), included, excluded: values.length - included };
}

/** 예산현액과 지출액이 모두 있는 행만 같은 분모·분자로 합산한다. */
export function aggregateExecution(rows: readonly { readonly budget: string | null; readonly expenditure: string | null }[]) {
  const comparable = rows.filter((row) => row.budget !== null && row.expenditure !== null);
  const budget = sumWon(comparable.map((row) => row.budget)).total;
  const expenditure = sumWon(comparable.map((row) => row.expenditure)).total;
  return {
    current_budget_krw: comparable.length ? budget : null,
    public_expenditure_krw: comparable.length ? expenditure : null,
    unspent_difference_krw: comparable.length ? subtractWon(budget, expenditure) : null,
    execution_rate_pct: comparable.length ? executionRate(expenditure, budget) : { value: null, reason: "BUDGET_UNKNOWN" as const },
    included_rows: comparable.length,
    excluded_rows: rows.length - comparable.length,
  };
}

