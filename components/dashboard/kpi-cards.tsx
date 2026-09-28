"use client";

const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");

export interface KpiSummary {
  total: number;
  sidoCount: number;
  sigunguCount: number;
  categoryCount: number;
  filtered: number;
}

const CARD_ITEMS: { key: keyof KpiSummary; label: string; unit: string }[] = [
  { key: "total", label: "전체 사업", unit: "건" },
  { key: "sidoCount", label: "수록 시·도", unit: "개" },
  { key: "sigunguCount", label: "수록 시·군·구", unit: "개" },
  { key: "categoryCount", label: "사업 분야", unit: "개" },
  { key: "filtered", label: "현재 검색 결과", unit: "건" },
];

/** 제주 디자인 KPI(.jeju-stat). 지금 조건의 결과 수만 Primary로 강조한다. */
export function KpiCards({ summary }: { summary: KpiSummary }) {
  return (
    <section aria-label="핵심 현황" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {CARD_ITEMS.map((item) => {
        const current = item.key === "filtered";
        return (
          <div
            key={item.key}
            className={
              current
                ? "rounded-xl border border-primary bg-(--jeju-primary-tint) px-4 py-3.5"
                : "rounded-xl border border-border bg-card px-4 py-3.5"
            }
          >
            <p className="text-(length:--jeju-text-sm) font-bold text-muted-foreground">{item.label}</p>
            <p
              className={
                current
                  ? "mt-1.5 whitespace-nowrap text-(length:--jeju-kpi-size) leading-[1.1] font-extrabold tabular-nums text-primary"
                  : "mt-1.5 whitespace-nowrap text-(length:--jeju-kpi-size) leading-[1.1] font-extrabold tabular-nums text-(--jeju-text-strong)"
              }
            >
              {NUMBER_FORMAT.format(summary[item.key])}
              <span className="ml-1 text-(length:--jeju-text-base) font-bold text-(--jeju-text-body)">{item.unit}</span>
            </p>
          </div>
        );
      })}
    </section>
  );
}
