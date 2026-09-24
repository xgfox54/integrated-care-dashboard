"use client";

const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR");

export interface KpiSummary {
  total: number;
  sidoCount: number;
  sigunguCount: number;
  categoryCount: number;
  filtered: number;
}

const CARD_ITEMS: {
  key: keyof KpiSummary;
  label: string;
  unit: string;
  accent: string;
  tone: string;
}[] = [
  { key: "total", label: "전체 사업", unit: "건", accent: "var(--care-blue)", tone: "var(--kpi-blue-wash)" },
  { key: "sidoCount", label: "수록 시·도", unit: "개", accent: "var(--care-green)", tone: "var(--kpi-green-wash)" },
  { key: "sigunguCount", label: "수록 시·군·구", unit: "개", accent: "var(--care-orange)", tone: "var(--kpi-orange-wash)" },
  { key: "categoryCount", label: "사업 분야", unit: "개", accent: "var(--care-green)", tone: "var(--kpi-green-wash)" },
  { key: "filtered", label: "현재 검색 결과", unit: "건", accent: "var(--care-blue)", tone: "var(--kpi-blue-wash)" },
];

export function KpiCards({ summary }: { summary: KpiSummary }) {
  return (
    <section aria-label="핵심 현황" className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {CARD_ITEMS.map((item) => (
        <div
          key={item.key}
          className="relative overflow-hidden rounded-xl border border-border/90 bg-card px-4 py-3.5 shadow-sm"
          style={{ backgroundImage: `linear-gradient(135deg, var(--card) 58%, ${item.tone})` }}
        >
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-1"
            style={{ backgroundColor: item.accent }}
          />
          <p className="text-sm font-medium text-muted-foreground">{item.label}</p>
          <p className="mt-1 text-2xl font-extrabold tracking-[-0.02em]" style={{ color: item.accent }}>
            {NUMBER_FORMAT.format(summary[item.key])}
            <span className="ml-1 text-base font-semibold text-foreground">{item.unit}</span>
          </p>
        </div>
      ))}
    </section>
  );
}
