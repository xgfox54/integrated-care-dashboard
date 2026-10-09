export interface PressPeriodSelection {
  readonly period: string;
  readonly from: string;
  readonly to: string;
}

export const PRESS_PERIODS = [
  { value: "", label: "전체 기간" },
  { value: "today", label: "오늘" },
  { value: "7", label: "최근 7일" },
  { value: "30", label: "최근 30일" },
  { value: "90", label: "최근 3개월" },
  { value: "custom", label: "직접 선택" },
  { value: "unknown", label: "게시일 미확인만" },
] as const;

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const PRESET_DAYS: Readonly<Record<string, number>> = { today: 1, "7": 7, "30": 30, "90": 90 };

export function selectPressPeriod(period: string, current: PressPeriodSelection, now = Date.now()): PressPeriodSelection {
  const days = PRESET_DAYS[period];
  if (days) {
    const today = now + KST_OFFSET_MS;
    return { period, from: new Date(today - (days - 1) * DAY_MS).toISOString().slice(0, 10), to: new Date(today).toISOString().slice(0, 10) };
  }
  switch (period) {
    case "custom": return { ...current, period };
    case "unknown": return { period, from: "", to: "" };
    default: return { period: "", from: "", to: "" };
  }
}

export function pressPeriodQuery(selection: PressPeriodSelection): URLSearchParams {
  const params = new URLSearchParams();
  switch (selection.period) {
    case "unknown": params.set("date_unknown", "1"); break;
    default:
      if (selection.from) params.set("from", selection.from);
      if (selection.to) params.set("to", selection.to);
  }
  return params;
}
