// 수집 범위의 주기(일)와 그 주기에 맞춘 기준일. 배경 작업과 시험이 함께 쓴다(Workers 전용 모듈에 의존하지 않음).
import type { FiscalScope } from "./collect.ts";

/** 범위 정의의 수집 주기(일). 없으면 매일(1). */
export function scopeCadenceDays(scope: Pick<FiscalScope, "definition">): number {
  const parsed: unknown = JSON.parse(scope.definition);
  const days = parsed && typeof parsed === "object" ? (parsed as { cadenceDays?: unknown }).cadenceDays : undefined;
  return typeof days === "number" && Number.isInteger(days) && days > 1 ? days : 1;
}

/** 주기 범위의 기준일: 매일 범위는 그대로, 주 1회 범위는 그 기준일 이하의 가장 가까운 금요일(한 주 업무 마감일). */
export function cadenceTarget(target: string, cadenceDays: number): string {
  if (cadenceDays <= 1) return target;
  const date = new Date(target + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() - 5 + 7) % 7));
  return date.toISOString().slice(0, 10);
}
